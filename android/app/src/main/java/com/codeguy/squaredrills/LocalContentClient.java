package com.codeguy.squaredrills;

import android.content.res.AssetManager;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.ByteArrayInputStream;
import java.util.Map;
import java.util.HashMap;
import java.util.Collections;

/** HTTPS-shaped local origin, entirely intercepted; never falls back to the network. */
public final class LocalContentClient extends WebViewClient {
    public static final String START_URL = "https://appassets.androidplatform.net/static/index.html";
    private final AssetManager assets;
    public LocalContentClient(AssetManager assets) { this.assets = assets; }
    static boolean isLocal(Uri uri) {
        return "https".equals(uri.getScheme()) && "appassets.androidplatform.net".equals(uri.getHost())
            && uri.getPort() == -1 && uri.getUserInfo() == null;
    }
    @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        return !START_URL.equals(request.getUrl().toString());
    }
    @Override public boolean shouldOverrideUrlLoading(WebView view, String url) { return !START_URL.equals(url); }
    @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        return intercept(request.getUrl());
    }
    WebResourceResponse intercept(Uri uri) {
        String path = uri.getPath();
        if (!isLocal(uri) || path == null || !path.startsWith("/static/") || path.contains("..") || path.contains("\\")) return blocked();
        String mime = path.endsWith(".html") ? "text/html" : path.endsWith(".css") ? "text/css" : path.endsWith(".js") ? "application/javascript" : null;
        if (mime == null) return blocked();
        try {
            Map<String, String> headers = new HashMap<>();
            headers.put("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'");
            headers.put("X-Content-Type-Options", "nosniff");
            return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, assets.open(path.substring(1)));
        } catch (Exception error) { return blocked(); }
    }
    private static WebResourceResponse blocked() {
        return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }
}
