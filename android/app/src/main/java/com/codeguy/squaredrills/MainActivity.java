package com.codeguy.squaredrills;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JsResult;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.FrameLayout;

public final class MainActivity extends Activity {
    private WebView webView;
    private FrameLayout root;
    private AppDatabase database;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        database = new AppDatabase(this);
        root = new FrameLayout(this);
        webView = new WebView(this);
        root.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return insets;
            });
            root.requestApplyInsets();
        }
        WebSettings settings = webView.getSettings();
        // Required by the bundled tools; LocalContentClient blocks every other origin.
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        webView.setWebViewClient(new LocalContentClient(getAssets()));
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setTitle("Square Drills").setMessage(message)
                    .setPositiveButton("Confirm", (dialog, which) -> result.confirm())
                    .setNegativeButton("Cancel", (dialog, which) -> result.cancel())
                    .setOnCancelListener(dialog -> result.cancel()).show();
                return true;
            }
        });
        webView.addJavascriptInterface(new AndroidBridge(database, () -> runOnUiThread(this::applySystemTheme)), "AndroidStore");
        applySystemTheme();
        webView.loadUrl(LocalContentClient.START_URL);
    }
    private void applySystemTheme() {
        boolean dark = "dark".equals(database.getSetting("theme"));
        int background = Color.parseColor(dark ? "#202020" : "#F2F2F2");
        root.setBackgroundColor(background); webView.setBackgroundColor(background);
        getWindow().setStatusBarColor(background); getWindow().setNavigationBarColor(background);
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                controller.setSystemBarsAppearance(dark ? 0 : mask, mask);
            }
        } else getWindow().getDecorView().setSystemUiVisibility(dark ? 0 : View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
    }
    @Override protected void onPause() {
        webView.evaluateJavascript("window.MobileUI && window.MobileUI.pause()", null);
        super.onPause();
    }
    @Override protected void onResume() {
        super.onResume();
        if (webView != null) webView.evaluateJavascript("window.MobileUI && window.MobileUI.resume()", null);
    }
    @Override protected void onDestroy() {
        webView.removeJavascriptInterface("AndroidStore");
        root.removeView(webView); webView.destroy(); database.close();
        super.onDestroy();
    }
}
