package com.codeguy.squaredrills;

import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.FrameLayout;
import org.junit.Before;
import org.junit.After;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35)
public class ShellTest {
    @Before public void setup() { RuntimeEnvironment.getApplication().deleteDatabase(AppDatabase.DATABASE_NAME); }
    @After public void cleanup() { RuntimeEnvironment.getApplication().deleteDatabase(AppDatabase.DATABASE_NAME); }
    private WebView webView(MainActivity activity) {
        FrameLayout content = activity.findViewById(android.R.id.content);
        return (WebView)((FrameLayout)content.getChildAt(0)).getChildAt(0);
    }
    @Test public void shellLoadsBundledEntryWithRestrictedWebSettings() {
        try (ActivityController<MainActivity> controller = Robolectric.buildActivity(MainActivity.class).setup()) {
            WebView webView = webView(controller.get());
            assertEquals(LocalContentClient.START_URL, Shadows.shadowOf(webView).getLastLoadedUrl());
            assertFalse(webView.getSettings().getAllowFileAccess());
            assertFalse(webView.getSettings().getAllowContentAccess());
            assertFalse(webView.getSettings().getAllowFileAccessFromFileURLs());
            assertFalse(webView.getSettings().getAllowUniversalAccessFromFileURLs());
            assertFalse(webView.getSettings().getDomStorageEnabled());
            assertFalse(webView.getSettings().getJavaScriptCanOpenWindowsAutomatically());
            assertEquals(WebSettings.MIXED_CONTENT_NEVER_ALLOW, webView.getSettings().getMixedContentMode());
            assertTrue(webView.getSettings().getJavaScriptEnabled());
            assertNotNull(Shadows.shadowOf(webView).getJavascriptInterface("AndroidStore"));
        }
    }
    @Test public void backgroundAndResumeNotifyTheDrillTimer() {
        try (ActivityController<MainActivity> controller = Robolectric.buildActivity(MainActivity.class).setup()) {
            WebView webView = webView(controller.get());
            controller.pause();
            assertEquals("window.MobileUI && window.MobileUI.pause()", Shadows.shadowOf(webView).getLastEvaluatedJavascript());
            controller.resume();
            assertEquals("window.MobileUI && window.MobileUI.resume()", Shadows.shadowOf(webView).getLastEvaluatedJavascript());
        }
    }
    private int surfaceColor(MainActivity activity) {
        return ((ColorDrawable)((FrameLayout)webView(activity).getParent()).getBackground()).getColor();
    }
    @Test public void nativeSurfaceBehindSystemBarsUsesTheApprovedBackgrounds() {
        // API 35 enforces transparent status bars; the inset root supplies their background.
        try (ActivityController<MainActivity> controller = Robolectric.buildActivity(MainActivity.class).setup()) {
            assertEquals(Color.parseColor("#F2F2F2"), surfaceColor(controller.get()));
        }
        try (AppDatabase db = new AppDatabase(RuntimeEnvironment.getApplication())) { db.putSetting("theme", "dark"); }
        try (ActivityController<MainActivity> controller = Robolectric.buildActivity(MainActivity.class).setup()) {
            assertEquals(Color.parseColor("#202020"), surfaceColor(controller.get()));
        }
    }
}
