from __future__ import annotations

import json
import sqlite3
import sys
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator


def user_data_dir() -> Path:
    """Portable data belongs to this executable; development uses its own store.

    Deliberately do not read environment overrides, legacy suite paths, or an
    installed edition's storage. Never migrate another application's data.
    """
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent / "data"
    return Path(__file__).resolve().parent.parent / "data" / "dev"


def webview_data_dir() -> Path:
    return user_data_dir() / "webview-profile"


class Database:
    SCHEMA_VERSION = 1

    def __init__(self, path: Path | None = None) -> None:
        self.path = path if path is not None else user_data_dir() / "square_drills.db"

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        try:
            yield connection
            connection.commit()
        except BaseException:
            connection.rollback()
            raise
        finally:
            connection.close()

    def initialize(self) -> None:
        with self.connect() as connection:
            version = connection.execute("PRAGMA user_version").fetchone()[0]
            if version not in (0, self.SCHEMA_VERSION):
                raise RuntimeError("This database was created by a newer Square Drills version. Its data has been preserved.")
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("BEGIN IMMEDIATE")
            connection.execute("""
                CREATE TABLE IF NOT EXISTS module_state (
                    module_id TEXT PRIMARY KEY,
                    payload TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)
            connection.execute("""
                CREATE TABLE IF NOT EXISTS app_settings (
                    setting_key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)
            connection.execute(f"PRAGMA user_version={self.SCHEMA_VERSION}")

    def get_module_state(self, module_id: str) -> dict[str, Any] | None:
        with self.connect() as connection:
            row = connection.execute("SELECT payload FROM module_state WHERE module_id = ?", (module_id,)).fetchone()
        if not row:
            return None
        try:
            payload = json.loads(row["payload"])
        except (TypeError, json.JSONDecodeError):
            return None
        return payload if isinstance(payload, dict) else None

    def set_module_state(self, module_id: str, payload: dict[str, Any]) -> str:
        updated_at = datetime.now(timezone.utc).isoformat()
        encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        with self.connect() as connection:
            connection.execute("""
                INSERT INTO module_state(module_id, payload, updated_at) VALUES (?, ?, ?)
                ON CONFLICT(module_id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at
            """, (module_id, encoded, updated_at))
        return updated_at

    def delete_module_state(self, module_id: str) -> bool:
        with self.connect() as connection:
            cursor = connection.execute("DELETE FROM module_state WHERE module_id = ?", (module_id,))
        return cursor.rowcount > 0

    def get_setting(self, key: str) -> Any | None:
        with self.connect() as connection:
            row = connection.execute("SELECT value FROM app_settings WHERE setting_key = ?", (key,)).fetchone()
        if not row:
            return None
        try:
            return json.loads(row["value"])
        except json.JSONDecodeError:
            return None

    def set_setting(self, key: str, value: Any) -> None:
        updated_at = datetime.now(timezone.utc).isoformat()
        with self.connect() as connection:
            connection.execute("""
                INSERT INTO app_settings(setting_key, value, updated_at) VALUES (?, ?, ?)
                ON CONFLICT(setting_key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
            """, (key, json.dumps(value, ensure_ascii=False), updated_at))
