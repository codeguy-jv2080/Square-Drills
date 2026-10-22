package com.codeguy.squaredrills;

import android.content.Context;
import android.database.sqlite.SQLiteDatabase;
import android.net.Uri;
import android.webkit.WebResourceResponse;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35)
public class StorageTest {
    private Context context;
    private AppDatabase db;
    private AndroidBridge bridge;
    @Before public void setup() {
        context = RuntimeEnvironment.getApplication();
        context.deleteDatabase(AppDatabase.DATABASE_NAME);
        db = new AppDatabase(context);
        bridge = new AndroidBridge(db, () -> {});
    }
    @After public void cleanup() {
        db.close();
        context.deleteDatabase(AppDatabase.DATABASE_NAME);
        context.deleteDatabase("chess_tools.db"); // Robolectric's isolated test directory only.
    }
    private JSONObject call(String url, String method, JSONObject body) throws Exception {
        JSONObject request = new JSONObject().put("url", url).put("method", method).put("body", body);
        return new JSONObject(bridge.request(request.toString()));
    }
    @Test public void freshDatabaseIsEmptyAndThemeDefaultsToLight() throws Exception {
        assertEquals("com.codeguy.squaredrills", context.getPackageName());
        assertEquals("square_drills.db", db.getDatabaseName());
        assertEquals(JSONObject.NULL, call("/api/state/square-drills", "GET", new JSONObject()).getJSONObject("result").get("payload"));
        assertEquals("light", call("/api/settings/theme", "GET", new JSONObject()).getJSONObject("result").getString("theme"));
        assertNull(db.getSetting("theme"));
        assertEquals(1, db.getReadableDatabase().getVersion());
    }
    @Test public void unfinishedStateAndThemeSurviveReopen() throws Exception {
        JSONObject state = new JSONObject().put("remember", true).put("attempts", 5)
            .put("current", "e4").put("submitted", false)
            .put("answers", new JSONObject().put("color", "white").put("white", "K"));
        assertTrue(call("/api/state/square-drills", "PUT", new JSONObject().put("payload", state)).getBoolean("ok"));
        assertTrue(call("/api/settings/theme", "PUT", new JSONObject().put("theme", "dark")).getBoolean("ok"));
        db.close(); db = new AppDatabase(context); bridge = new AndroidBridge(db, () -> {});
        JSONObject restored = call("/api/state/square-drills", "GET", new JSONObject()).getJSONObject("result").getJSONObject("payload");
        assertEquals(5, restored.getInt("attempts"));
        assertEquals("e4", restored.getString("current"));
        assertFalse(restored.getBoolean("submitted"));
        assertEquals("K", restored.getJSONObject("answers").getString("white"));
        assertEquals("dark", db.getSetting("theme"));
    }
    @Test public void clearSavedDeletesOnlyDrillStateAndPreservesTheme() throws Exception {
        db.putState("square-drills", new JSONObject().put("attempts", 5));
        db.putSetting("theme", "dark");
        assertTrue(call("/api/state/square-drills", "DELETE", new JSONObject()).getBoolean("ok"));
        assertEquals(JSONObject.NULL, db.getState("square-drills"));
        assertEquals("dark", db.getSetting("theme"));
    }
    @Test public void suiteAndRetiredRoutesCannotBeAccessed() throws Exception {
        for (String id : new String[]{"match-tracker", "score-percentage", "steps-grade", "ccd-full", "ccd-inverted", "../chess_tools.db"}) {
            for (String method : new String[]{"GET", "PUT", "DELETE"}) {
                assertFalse(call("/api/state/" + id, method, new JSONObject().put("payload", new JSONObject())).getBoolean("ok"));
            }
        }
        assertFalse(call("/api/settings/last-module", "GET", new JSONObject()).getBoolean("ok"));
        assertFalse(call("/api/settings/last-module/square-drills", "PUT", new JSONObject()).getBoolean("ok"));
        assertFalse(call("/api/state/square-drills", "POST", new JSONObject()).getBoolean("ok"));
    }
    @Test public void existingSuiteNamedDatabaseIsNotImportedOrChanged() throws Exception {
        try (SQLiteDatabase suite = context.openOrCreateDatabase("chess_tools.db", 0, null)) {
            suite.execSQL("CREATE TABLE marker (value TEXT NOT NULL)");
            suite.execSQL("INSERT INTO marker VALUES ('preserve-source')");
            assertEquals(JSONObject.NULL, db.getState("square-drills"));
            db.putState("square-drills", new JSONObject().put("attempts", 3));
            db.putSetting("theme", "dark");
            try (android.database.Cursor row = suite.rawQuery("SELECT value FROM marker", null)) {
                assertTrue(row.moveToFirst()); assertEquals("preserve-source", row.getString(0));
            }
            assertNotEquals(suite.getPath(), db.getReadableDatabase().getPath());
        }
    }
    @Test public void invalidSavesAndUnknownMigrationPreserveState() throws Exception {
        db.putState("square-drills", new JSONObject().put("attempts", 9));
        assertFalse(call("/api/state/square-drills", "PUT", new JSONObject().put("payload", "not an object")).getBoolean("ok"));
        assertFalse(new JSONObject(bridge.request("invalid-json")).getBoolean("ok"));
        assertFalse(new JSONObject(bridge.request(null)).getBoolean("ok"));
        assertFalse(new JSONObject(bridge.request(" ".repeat(2_000_001))).getBoolean("ok"));
        try { db.onUpgrade(db.getWritableDatabase(), 1, 2); fail("Unknown migration must fail"); }
        catch (IllegalStateException expected) { assertTrue(expected.getMessage().contains("No safe migration")); }
        assertEquals(9, ((JSONObject)db.getState("square-drills")).getInt("attempts"));
    }
    @Test public void themeChangesAreValidatedAndNotifyTheShell() throws Exception {
        AtomicInteger changes = new AtomicInteger();
        bridge = new AndroidBridge(db, changes::incrementAndGet);
        assertTrue(call("/api/settings/theme", "PUT", new JSONObject().put("theme", "dark")).getBoolean("ok"));
        assertFalse(call("/api/settings/theme", "PUT", new JSONObject().put("theme", "invalid")).getBoolean("ok"));
        assertEquals(1, changes.get()); assertEquals("dark", db.getSetting("theme"));
    }
    @Test public void bundledAssetsLoadAndExternalRequestsFailClosed() throws Exception {
        LocalContentClient client = new LocalContentClient(context.getAssets());
        WebResourceResponse response = client.intercept(Uri.parse(LocalContentClient.START_URL));
        assertEquals(200, response.getStatusCode());
        String html = new String(response.getData().readAllBytes(), StandardCharsets.UTF_8);
        assertTrue(html.contains("module-square-drills"));
        for (String omitted : new String[]{"module-match-tracker", "module-score-percentage", "module-steps-grade", "module-ccd-full", "module-ccd-inverted"}) assertFalse(html.contains(omitted));
        assertTrue(html.contains("/static/js/modules/square-drills.js"));
        java.util.regex.Matcher references = java.util.regex.Pattern.compile("(?:src|href)=\"(/static/[^\"]+)\"").matcher(html);
        int referenceCount = 0;
        while (references.find()) {
            assertEquals(200, client.intercept(Uri.parse("https://appassets.androidplatform.net" + references.group(1))).getStatusCode());
            referenceCount++;
        }
        assertTrue(referenceCount > 0);
        assertTrue(response.getResponseHeaders().get("Content-Security-Policy").contains("connect-src 'none'"));
        for (String blocked : new String[]{"https://example.com/static/index.html", "file:///static/index.html", "https://appassets.androidplatform.net/static/../private.db", "https://appassets.androidplatform.net/static/missing.js", "https://appassets.androidplatform.net:443/static/index.html", "https://user@appassets.androidplatform.net/static/index.html"}) {
            assertEquals(blocked, 403, client.intercept(Uri.parse(blocked)).getStatusCode());
        }
        assertFalse(client.shouldOverrideUrlLoading(null, LocalContentClient.START_URL));
        assertTrue(client.shouldOverrideUrlLoading(null, "https://example.com"));
    }
    @Test public void packagedPolicyHasNoPermissionsOrCloudBackup() throws Exception {
        android.content.pm.PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), android.content.pm.PackageManager.GET_PERMISSIONS);
        assertTrue(info.requestedPermissions == null || info.requestedPermissions.length == 0);
        assertEquals(0, info.applicationInfo.flags & android.content.pm.ApplicationInfo.FLAG_ALLOW_BACKUP);
        assertEquals(0, info.applicationInfo.flags & android.content.pm.ApplicationInfo.FLAG_USES_CLEARTEXT_TRAFFIC);
        JSONObject health = call("/api/health", "GET", new JSONObject()).getJSONObject("result");
        assertEquals("ok", health.getString("status")); assertEquals(BuildConfig.VERSION_NAME, health.getString("version"));
    }
}
