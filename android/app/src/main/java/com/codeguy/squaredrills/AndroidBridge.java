package com.codeguy.squaredrills;

import android.webkit.JavascriptInterface;
import org.json.JSONObject;

/** Only installed on packaged content. No filesystem, network, or arbitrary SQL API. */
public final class AndroidBridge {
    private final AppDatabase database;
    private final Runnable themeChanged;
    public AndroidBridge(AppDatabase database, Runnable themeChanged) {
        this.database = database; this.themeChanged = themeChanged;
    }
    private static void validateModule(String id) {
        if (!"square-drills".equals(id)) throw new IllegalArgumentException("Unknown drill");
    }
    @JavascriptInterface public synchronized String request(String encoded) {
        try {
            if (encoded == null || encoded.length() > 2_000_000) throw new IllegalArgumentException("Invalid request size");
            JSONObject request = new JSONObject(encoded);
            String url = request.getString("url");
            String method = request.optString("method", "GET");
            JSONObject result = new JSONObject();
            if (url.equals("/api/health") && method.equals("GET")) {
                database.getReadableDatabase();
                result.put("status", "ok").put("version", BuildConfig.VERSION_NAME);
            } else if (url.startsWith("/api/state/")) {
                String id = url.substring("/api/state/".length()); validateModule(id);
                switch (method) {
                    case "GET": result.put("payload", database.getState(id)); break;
                    case "PUT": result.put("updated_at", database.putState(id, request.getJSONObject("body").getJSONObject("payload"))); break;
                    case "DELETE": result.put("deleted", database.deleteState(id)); break;
                    default: throw new IllegalArgumentException("Unsupported method");
                }
            } else if (url.equals("/api/settings/theme") && method.equals("GET")) {
                String theme = database.getSetting("theme");
                result.put("theme", "dark".equals(theme) ? "dark" : "light");
            } else if (url.equals("/api/settings/theme") && method.equals("PUT")) {
                String theme = request.getJSONObject("body").getString("theme");
                if (!theme.equals("light") && !theme.equals("dark")) throw new IllegalArgumentException("Invalid theme");
                database.putSetting("theme", theme); themeChanged.run(); result.put("saved", true);
            } else throw new IllegalArgumentException("Unknown local API route");
            return new JSONObject().put("ok", true).put("result", result).toString();
        } catch (Exception error) {
            try {
                String message = error instanceof IllegalArgumentException ? error.getMessage() : "Local data operation failed. Your existing data has not been reset.";
                return new JSONObject().put("ok", false).put("detail", message).toString();
            } catch (Exception ignored) { return "{\"ok\":false,\"detail\":\"Local operation failed\"}"; }
        }
    }
}
