package com.bloomora.app;

import android.os.Build;
import android.util.Base64;
import android.webkit.JavascriptInterface;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.Charset;
import java.util.Iterator;

/** Methods exposed to the web app as window.BloomoraNative. Called on a background thread. */
public class NativeBridge {
    private static final Charset UTF8 = Charset.forName("UTF-8");
    private final MainActivity activity;

    NativeBridge(MainActivity activity) {
        this.activity = activity;
    }

    @JavascriptInterface
    public String getInfo() {
        JSONObject info = new JSONObject();
        try {
            info.put("platform", "android");
            info.put("version", activity.appVersion());
            info.put("sdk", Build.VERSION.SDK_INT);
            info.put("notificationsAllowed", activity.notificationsAllowed());
            info.put("exactAlarms", Reminders.canScheduleExact(activity));
        } catch (JSONException ignored) {
            // Keys and values are always valid.
        }
        return info.toString();
    }

    @JavascriptInterface
    public void saveFile(String filename, String mime, String content, boolean base64) {
        byte[] data = base64 ? Base64.decode(content, Base64.DEFAULT) : content.getBytes(UTF8);
        activity.saveFile(filename, mime, data);
    }

    @JavascriptInterface
    public void setSystemBars(String colorHex, boolean dark) {
        activity.setSystemBars(colorHex, dark);
    }

    @JavascriptInterface
    public void setKeepScreenOn(boolean on) {
        activity.setKeepScreenOn(on);
    }

    @JavascriptInterface
    public void haptic() {
        activity.haptic();
    }

    @JavascriptInterface
    public void exitApp() {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.moveTaskToBack(true);
            }
        });
    }

    @JavascriptInterface
    public void openExternal(String url) {
        if (url != null && (url.startsWith("https://") || url.startsWith("mailto:"))) activity.openExternal(url);
    }

    @JavascriptInterface
    public boolean notificationsAllowed() {
        return activity.notificationsAllowed();
    }

    @JavascriptInterface
    public void requestNotificationPermission() {
        activity.requestNotificationPermission();
    }

    @JavascriptInterface
    public boolean canScheduleExactAlarms() {
        return Reminders.canScheduleExact(activity);
    }

    @JavascriptInterface
    public void openExactAlarmSettings() {
        activity.openExactAlarmSettings();
    }

    @JavascriptInterface
    public void scheduleReminder(int id, String group, String title, String body, double atMillis) {
        if (!activity.notificationsAllowed()) activity.requestNotificationPermission();
        Reminders.schedule(activity, id, group, title, body, (long) atMillis);
    }

    @JavascriptInterface
    public void cancelReminder(int id) {
        Reminders.cancel(activity, id);
    }

    @JavascriptInterface
    public void cancelReminderGroup(String group) {
        Reminders.cancelGroup(activity, group);
    }

    /**
     * Performs an HTTPS request natively so calls to the Bloomora API work from
     * the app's local origin without CORS. The result is delivered by calling
     * window.__bloomoraHttp(requestId, status, body, error).
     */
    @JavascriptInterface
    public void httpRequest(final String requestId, final String method, final String url, final String headersJson, final String body) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                int status = 0;
                String responseBody = "";
                String error = "";
                HttpURLConnection connection = null;
                try {
                    if (!url.startsWith("https://")) throw new IOException("Only https requests are allowed.");
                    connection = (HttpURLConnection) new URL(url).openConnection();
                    connection.setRequestMethod(method);
                    connection.setConnectTimeout(20000);
                    connection.setReadTimeout(90000);
                    JSONObject headers = new JSONObject(headersJson == null || headersJson.isEmpty() ? "{}" : headersJson);
                    Iterator<String> keys = headers.keys();
                    while (keys.hasNext()) {
                        String key = keys.next();
                        connection.setRequestProperty(key, headers.getString(key));
                    }
                    if (body != null && !"GET".equals(method)) {
                        connection.setDoOutput(true);
                        OutputStream out = connection.getOutputStream();
                        out.write(body.getBytes(UTF8));
                        out.close();
                    }
                    status = connection.getResponseCode();
                    InputStream in = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                    responseBody = in == null ? "" : readAll(in);
                } catch (Exception e) {
                    error = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
                } finally {
                    if (connection != null) connection.disconnect();
                }
                activity.runJs("window.__bloomoraHttp && window.__bloomoraHttp("
                        + JSONObject.quote(requestId) + "," + status + ","
                        + JSONObject.quote(responseBody) + "," + JSONObject.quote(error) + ")");
            }
        }).start();
    }

    private static String readAll(InputStream in) throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int read;
        while ((read = in.read(chunk)) != -1) buffer.write(chunk, 0, read);
        in.close();
        return new String(buffer.toByteArray(), UTF8);
    }
}
