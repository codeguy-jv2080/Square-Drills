package com.codeguy.squaredrills;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import java.time.Instant;
import org.json.JSONObject;

/** Separate Android-private data; never opens the desktop database. */
public final class AppDatabase extends SQLiteOpenHelper {
    public static final String DATABASE_NAME = "square_drills.db";
    public static final int SCHEMA_VERSION = 1;
    public AppDatabase(Context context) { super(context, DATABASE_NAME, null, SCHEMA_VERSION); }

    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE module_state (module_id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL)");
        db.execSQL("CREATE TABLE app_settings (setting_key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)");
    }
    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        // Add explicit, transactional migrations when a second schema is introduced.
        // Refuse unknown upgrades instead of dropping or recreating user tables.
        throw new IllegalStateException("No safe migration from schema " + oldVersion + " to " + newVersion);
    }
    public synchronized Object getState(String id) throws Exception {
        try (Cursor row = getReadableDatabase().rawQuery("SELECT payload FROM module_state WHERE module_id=?", new String[]{id})) {
            return row.moveToFirst() ? new JSONObject(row.getString(0)) : JSONObject.NULL;
        }
    }
    public synchronized String putState(String id, JSONObject payload) {
        String now = Instant.now().toString();
        ContentValues row = new ContentValues();
        row.put("module_id", id); row.put("payload", payload.toString()); row.put("updated_at", now);
        if (getWritableDatabase().insertWithOnConflict("module_state", null, row, SQLiteDatabase.CONFLICT_REPLACE) < 0)
            throw new IllegalStateException("State could not be saved");
        return now;
    }
    public synchronized boolean deleteState(String id) {
        return getWritableDatabase().delete("module_state", "module_id=?", new String[]{id}) > 0;
    }
    public synchronized String getSetting(String key) {
        try (Cursor row = getReadableDatabase().rawQuery("SELECT value FROM app_settings WHERE setting_key=?", new String[]{key})) {
            return row.moveToFirst() ? row.getString(0) : null;
        }
    }
    public synchronized void putSetting(String key, String value) {
        ContentValues row = new ContentValues();
        row.put("setting_key", key); row.put("value", value); row.put("updated_at", Instant.now().toString());
        if (getWritableDatabase().insertWithOnConflict("app_settings", null, row, SQLiteDatabase.CONFLICT_REPLACE) < 0)
            throw new IllegalStateException("Setting could not be saved");
    }
}
