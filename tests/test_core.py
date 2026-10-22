from __future__ import annotations

import json
import os
import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from app import main
from app.database import Database, user_data_dir, webview_data_dir
from launcher import SaveBeforeClose, server_config, smoke_test


class StorageTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)

    def test_portable_and_development_paths_ignore_other_application_settings(self):
        fake_exe = self.root / 'portable' / 'Square Drills.exe'
        with patch.dict(os.environ, {'CHESS_TOOLS_DATA_DIR': str(self.root / 'suite'),
                                     'LOCALAPPDATA': str(self.root / 'legacy')}):
            with patch('sys.frozen', True, create=True), patch('sys.executable', str(fake_exe)):
                self.assertEqual(user_data_dir(), fake_exe.parent / 'data')
                self.assertEqual(webview_data_dir(), fake_exe.parent / 'data' / 'webview-profile')
                self.assertEqual(Database().path.name, 'square_drills.db')
            with patch('sys.frozen', False, create=True):
                self.assertEqual(user_data_dir(), Path(__file__).resolve().parents[1] / 'data' / 'dev')
            self.assertFalse((self.root / 'suite').exists())
            self.assertFalse((self.root / 'legacy').exists())

    def test_fresh_store_and_reinitialization_preserve_existing_state(self):
        db = Database(self.root / 'square_drills.db')
        db.initialize()
        self.assertIsNone(db.get_module_state('square-drills'))
        self.assertIsNone(db.get_setting('theme'))
        state = {'attempts': 7, 'correct': 5, 'answers': {'white': 'QB3'}, 'locked': True}
        db.set_module_state('square-drills', state)
        db.set_setting('theme', 'dark')
        reopened = Database(db.path)
        reopened.initialize()
        self.assertEqual(reopened.get_module_state('square-drills'), state)
        self.assertEqual(reopened.get_setting('theme'), 'dark')
        with reopened.connect() as connection:
            self.assertEqual(connection.execute('PRAGMA user_version').fetchone()[0], 1)
            self.assertEqual(connection.execute('PRAGMA integrity_check').fetchone()[0], 'ok')

    def test_two_apps_and_portable_folders_never_share_or_import_state(self):
        paths = [self.root / 'Chess Tools' / 'data' / 'chess_tools.db',
                 self.root / 'Square Drills' / 'data' / 'square_drills.db',
                 self.root / 'second-portable' / 'data' / 'square_drills.db']
        stores = [Database(path) for path in paths]
        for store in stores:
            store.initialize()
        stores[0].set_module_state('square-drills', {'attempts': 91})
        stores[0].set_setting('theme', 'dark')
        original_bytes = paths[0].read_bytes()
        stores[1].set_module_state('square-drills', {'attempts': 2})
        stores[1].delete_module_state('square-drills')
        stores[1].initialize()
        self.assertEqual(paths[0].read_bytes(), original_bytes)
        self.assertEqual(stores[0].get_module_state('square-drills'), {'attempts': 91})
        self.assertIsNone(stores[1].get_setting('theme'))
        self.assertIsNone(stores[2].get_module_state('square-drills'))

    def test_future_schema_is_rejected_without_changing_database(self):
        path = self.root / 'future.db'
        with sqlite3.connect(path) as connection:
            connection.execute('CREATE TABLE private_test(value TEXT)')
            connection.execute("INSERT INTO private_test VALUES ('preserve')")
            connection.execute('PRAGMA user_version=99')
        before = path.read_bytes()
        with self.assertRaisesRegex(RuntimeError, 'preserved'):
            Database(path).initialize()
        self.assertEqual(path.read_bytes(), before)

    def test_failed_transaction_rolls_back(self):
        db = Database(self.root / 'rollback.db')
        db.initialize()
        with self.assertRaises(RuntimeError):
            with db.connect() as connection:
                connection.execute("INSERT INTO app_settings VALUES ('theme', '\"dark\"', 'test')")
                raise RuntimeError('interrupted')
        self.assertIsNone(db.get_setting('theme'))


class ApiTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.db = Database(Path(temporary.name) / 'test.db')
        self.db.initialize()
        patcher = patch.object(main, 'database', self.db)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_fresh_defaults_and_clear_only_drill(self):
        self.assertEqual(main.get_theme(), {'theme': 'light'})
        self.assertEqual(main.get_state('square-drills'), {'payload': None})
        main.put_state('square-drills', main.StatePayload(payload={'attempts': 3}))
        main.put_theme(main.ThemeRequest(theme='dark'))
        self.assertEqual(main.delete_state('square-drills'), {'deleted': True})
        self.assertEqual(main.get_theme(), {'theme': 'dark'})
        self.assertEqual(main.get_state('square-drills'), {'payload': None})

    def test_other_module_routes_cannot_read_write_or_delete(self):
        self.db.set_module_state('match-tracker', {'private': 'untouched'})
        for module_id in ('match-tracker', 'score-percentage', 'steps-grade', 'ccd-full', '../square-drills'):
            for action in (lambda: main.get_state(module_id),
                           lambda: main.put_state(module_id, main.StatePayload(payload={})),
                           lambda: main.delete_state(module_id)):
                with self.subTest(module=module_id), self.assertRaises(HTTPException) as raised:
                    action()
                self.assertEqual(raised.exception.status_code, 404)
        self.assertEqual(self.db.get_module_state('match-tracker'), {'private': 'untouched'})


class LauncherTests(unittest.TestCase):
    def test_windowed_logging_and_loopback(self):
        config = server_config(8765)
        self.assertIsNone(config.log_config)
        self.assertFalse(config.access_log)
        self.assertEqual(config.host, '127.0.0.1')

    def test_background_smoke_uses_temporary_storage_and_no_window(self):
        original = main.database
        with patch('webview.create_window') as create_window:
            result = smoke_test()
        self.assertTrue(result['ok'])
        self.assertIs(main.database, original)
        create_window.assert_not_called()

    def test_close_waits_for_callback_without_blocking_native_event(self):
        callback_ready = threading.Event()
        destroyed = threading.Event()
        callbacks = []
        loaded = threading.Event()
        loaded.set()

        def evaluate(script, callback=None):
            if callback:
                callbacks.append(callback)
                callback_ready.set()

        window = SimpleNamespace(events=SimpleNamespace(loaded=loaded), evaluate_js=evaluate, destroy=destroyed.set)
        guard = SaveBeforeClose(window, timeout=2)
        self.assertFalse(guard.request_close())
        self.assertTrue(callback_ready.wait(1))
        self.assertFalse(destroyed.is_set())
        self.assertFalse(guard.request_close())
        self.assertEqual(len(callbacks), 1)
        callbacks[0]({'ok': True})
        self.assertTrue(destroyed.wait(1))
        self.assertIsNone(guard.request_close())

    def test_failed_save_keeps_window_open_and_can_retry(self):
        loaded = threading.Event()
        loaded.set()
        notified = threading.Event()
        destroyed = threading.Event()

        def evaluate(script, callback=None):
            if callback:
                callback({'ok': False})
            else:
                notified.set()

        window = SimpleNamespace(events=SimpleNamespace(loaded=loaded), evaluate_js=evaluate, destroy=destroyed.set)
        guard = SaveBeforeClose(window)
        guard._flush()
        self.assertTrue(notified.is_set())
        self.assertFalse(destroyed.is_set())
        self.assertFalse(guard.allowed)
        self.assertFalse(guard.pending)


if __name__ == '__main__':
    unittest.main()
