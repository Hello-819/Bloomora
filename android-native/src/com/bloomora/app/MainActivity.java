package com.bloomora.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.res.AssetManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Hosts the Bloomora web app in a WebView. The built web files ship inside the
 * APK under assets/www and are served from a fixed https origin so IndexedDB,
 * localStorage and secure-context APIs behave exactly as they do on the web.
 */
public class MainActivity extends Activity {
    static final String APP_HOST = "appassets.androidplatform.net";
    static final String START_URL = "https://" + APP_HOST + "/index.html";

    private static final int REQUEST_FILE_CHOOSER = 1001;
    private static final int REQUEST_SAVE_FILE = 1002;
    private static final int REQUEST_NOTIFICATIONS = 1003;

    private FrameLayout root;
    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private byte[] pendingSave;
    private boolean darkBars;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Reminders.ensureChannels(this);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#f6f6f7"));
        webView = new WebView(this);
        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        setUpEdgeToEdge();

        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportZoom(false);
        settings.setUserAgentString(settings.getUserAgentString() + " BloomoraAndroid/" + appVersion());

        webView.addJavascriptInterface(new NativeBridge(this), "BloomoraNative");
        webView.setWebViewClient(new AppWebViewClient());
        webView.setWebChromeClient(new AppChromeClient());

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(START_URL);
        }

        if (Build.VERSION.SDK_INT >= 33) {
            ApiCompat.Api33.onBack(this, new Runnable() {
                @Override
                public void run() {
                    handleBack();
                }
            });
        }
    }

    @Override
    public void onBackPressed() {
        // Only reached below Android 13; newer versions use the callback above.
        handleBack();
    }

    /** Lets the web app close dialogs or go back a page; leaves the app only when it declines. */
    private void handleBack() {
        webView.evaluateJavascript(
                "(function(){try{return window.__bloomoraBack ? window.__bloomoraBack() : false;}catch(e){return false;}})()",
                new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String handled) {
                        if (!"true".equals(handled)) moveTaskToBack(true);
                    }
                });
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.evaluateJavascript("window.dispatchEvent(new Event('bloomora:resume'))", null);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.removeJavascriptInterface("BloomoraNative");
            webView.destroy();
        }
        super.onDestroy();
    }

    // ---------------------------------------------------------------------
    // Window chrome
    // ---------------------------------------------------------------------

    private void setUpEdgeToEdge() {
        if (Build.VERSION.SDK_INT >= 30) ApiCompat.Api30.edgeToEdge(getWindow(), root);
    }

    /** Matches the status and navigation bars to the app's light or dark theme. */
    void setSystemBars(final String colorHex, final boolean dark) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                int color;
                try {
                    color = Color.parseColor(colorHex);
                } catch (IllegalArgumentException e) {
                    color = dark ? Color.parseColor("#0d0e11") : Color.parseColor("#f6f6f7");
                }
                darkBars = dark;
                root.setBackgroundColor(color);
                getWindow().getDecorView().setBackgroundColor(color);
                if (Build.VERSION.SDK_INT < 35) {
                    getWindow().setStatusBarColor(color);
                    getWindow().setNavigationBarColor(color);
                }
                if (Build.VERSION.SDK_INT >= 30) {
                    ApiCompat.Api30.setBarAppearance(getWindow(), dark);
                } else {
                    View decor = getWindow().getDecorView();
                    int flags = decor.getSystemUiVisibility();
                    flags = dark
                            ? flags & ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
                            : flags | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                    if (Build.VERSION.SDK_INT >= 26) {
                        flags = dark
                                ? flags & ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
                                : flags | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                    }
                    decor.setSystemUiVisibility(flags);
                }
            }
        });
    }

    void setKeepScreenOn(final boolean on) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            }
        });
    }

    void haptic() {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                int effect = Build.VERSION.SDK_INT >= 30
                        ? android.view.HapticFeedbackConstants.CONFIRM
                        : android.view.HapticFeedbackConstants.VIRTUAL_KEY;
                webView.performHapticFeedback(effect);
            }
        });
    }

    // ---------------------------------------------------------------------
    // Bridge helpers
    // ---------------------------------------------------------------------

    void runJs(final String script) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (webView != null) webView.evaluateJavascript(script, null);
            }
        });
    }

    String appVersion() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (PackageManager.NameNotFoundException e) {
            return "1";
        }
    }

    boolean notificationsAllowed() {
        if (Build.VERSION.SDK_INT < 33) return true;
        return checkSelfPermission("android.permission.POST_NOTIFICATIONS") == PackageManager.PERMISSION_GRANTED;
    }

    void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < 33 || notificationsAllowed()) return;
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                requestPermissions(new String[] {"android.permission.POST_NOTIFICATIONS"}, REQUEST_NOTIFICATIONS);
            }
        });
    }

    void openExactAlarmSettings() {
        if (Build.VERSION.SDK_INT < 31) return;
        Intent intent = new Intent("android.settings.REQUEST_SCHEDULE_EXACT_ALARM", Uri.parse("package:" + getPackageName()));
        try {
            startActivity(intent);
        } catch (ActivityNotFoundException ignored) {
            // Some devices hide this screen; reminders still fire, just less precisely.
        }
    }

    void openExternal(String url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (ActivityNotFoundException ignored) {
            // Nothing can open this link.
        }
    }

    /** Opens the system "Save as" picker; the bytes are written once the user picks a location. */
    void saveFile(final String filename, final String mime, final byte[] data) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                pendingSave = data;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType(mime == null || mime.isEmpty() ? "application/octet-stream" : mime);
                intent.putExtra(Intent.EXTRA_TITLE, filename);
                try {
                    startActivityForResult(intent, REQUEST_SAVE_FILE);
                } catch (ActivityNotFoundException e) {
                    pendingSave = null;
                    runJs("window.dispatchEvent(new CustomEvent('bloomora:save', {detail: {ok: false}}))");
                }
            }
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_FILE_CHOOSER) {
            if (fileCallback != null) {
                Uri[] result = null;
                if (resultCode == RESULT_OK && data != null) {
                    if (data.getClipData() != null) {
                        result = new Uri[data.getClipData().getItemCount()];
                        for (int i = 0; i < result.length; i++) result[i] = data.getClipData().getItemAt(i).getUri();
                    } else if (data.getData() != null) {
                        result = new Uri[] {data.getData()};
                    }
                }
                fileCallback.onReceiveValue(result);
                fileCallback = null;
            }
        } else if (requestCode == REQUEST_SAVE_FILE) {
            boolean ok = false;
            if (resultCode == RESULT_OK && data != null && data.getData() != null && pendingSave != null) {
                OutputStream out = null;
                try {
                    out = getContentResolver().openOutputStream(data.getData());
                    if (out != null) {
                        out.write(pendingSave);
                        ok = true;
                    }
                } catch (IOException ignored) {
                    ok = false;
                } finally {
                    if (out != null) {
                        try {
                            out.close();
                        } catch (IOException ignored) {
                            // Already written or failed above.
                        }
                    }
                }
            }
            pendingSave = null;
            boolean cancelled = resultCode != RESULT_OK;
            runJs("window.dispatchEvent(new CustomEvent('bloomora:save', {detail: {ok: " + ok + ", cancelled: " + cancelled + "}}))");
        }
    }

    // ---------------------------------------------------------------------
    // WebView clients
    // ---------------------------------------------------------------------

    private static final Map<String, String> MIME_TYPES = new HashMap<String, String>();

    static {
        MIME_TYPES.put("html", "text/html");
        MIME_TYPES.put("js", "text/javascript");
        MIME_TYPES.put("mjs", "text/javascript");
        MIME_TYPES.put("css", "text/css");
        MIME_TYPES.put("json", "application/json");
        MIME_TYPES.put("webmanifest", "application/manifest+json");
        MIME_TYPES.put("svg", "image/svg+xml");
        MIME_TYPES.put("png", "image/png");
        MIME_TYPES.put("jpg", "image/jpeg");
        MIME_TYPES.put("jpeg", "image/jpeg");
        MIME_TYPES.put("webp", "image/webp");
        MIME_TYPES.put("ico", "image/x-icon");
        MIME_TYPES.put("wav", "audio/wav");
        MIME_TYPES.put("mp3", "audio/mpeg");
        MIME_TYPES.put("woff", "font/woff");
        MIME_TYPES.put("woff2", "font/woff2");
        MIME_TYPES.put("txt", "text/plain");
    }

    private WebResourceResponse serveAsset(Uri uri) {
        String path = uri.getPath();
        if (path == null || path.isEmpty() || "/".equals(path)) path = "/index.html";
        AssetManager assets = getAssets();
        InputStream stream;
        try {
            stream = assets.open("www" + path);
        } catch (IOException missing) {
            // Unknown paths fall back to the single-page app shell.
            path = "/index.html";
            try {
                stream = assets.open("www/index.html");
            } catch (IOException e) {
                return null;
            }
        }
        String ext = path.substring(path.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        String mime = MIME_TYPES.containsKey(ext) ? MIME_TYPES.get(ext) : "application/octet-stream";
        boolean text = mime.startsWith("text/") || mime.contains("json") || mime.contains("svg");
        Map<String, String> headers = new HashMap<String, String>();
        headers.put("Cache-Control", path.startsWith("/assets/") ? "max-age=31536000" : "no-cache");
        return new WebResourceResponse(mime, text ? "UTF-8" : null, 200, "OK", headers, stream);
    }

    private class AppWebViewClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (APP_HOST.equals(uri.getHost())) return serveAsset(uri);
            return super.shouldInterceptRequest(view, request);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (APP_HOST.equals(uri.getHost())) return false;
            openExternal(uri.toString());
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            setSystemBars(darkBars ? "#0d0e11" : "#f6f6f7", darkBars);
        }
    }

    private class AppChromeClient extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            // Accept lists like ".md,text/markdown" don't map cleanly to Android MIME
            // filters, so only images are filtered and everything else uses */*.
            boolean imagesOnly = true;
            for (String type : params.getAcceptTypes()) {
                for (String part : type.split(",")) {
                    String clean = part.trim();
                    if (!clean.isEmpty() && !clean.startsWith("image/")) imagesOnly = false;
                }
            }
            Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType(imagesOnly ? "image/*" : "*/*");
            if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            }
            try {
                startActivityForResult(Intent.createChooser(intent, null), REQUEST_FILE_CHOOSER);
                return true;
            } catch (ActivityNotFoundException e) {
                fileCallback = null;
                return false;
            }
        }
    }
}
