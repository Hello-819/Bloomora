package com.bloomora.app;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

/**
 * Schedules local notifications with AlarmManager. Scheduled reminders are kept
 * in SharedPreferences so they can be restored after a reboot or app update.
 */
final class Reminders {
    static final String CHANNEL_TIMER = "timer";
    static final String CHANNEL_REMINDERS = "reminders";
    private static final String PREFS = "bloomora_reminders";

    private Reminders() {}

    static void ensureChannels(Context context) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        NotificationChannel timer = new NotificationChannel(CHANNEL_TIMER, "Focus timer", NotificationManager.IMPORTANCE_HIGH);
        timer.setDescription("Alerts when a focus round or break ends");
        manager.createNotificationChannel(timer);
        NotificationChannel reminders = new NotificationChannel(CHANNEL_REMINDERS, "Deadline reminders", NotificationManager.IMPORTANCE_DEFAULT);
        reminders.setDescription("Reminders before coursework, assignments and exams are due");
        manager.createNotificationChannel(reminders);
    }

    static boolean canScheduleExact(Context context) {
        if (Build.VERSION.SDK_INT < 31) return true;
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        return alarms != null && alarms.canScheduleExactAlarms();
    }

    static void schedule(Context context, int id, String group, String title, String body, long atMillis) {
        if (atMillis <= System.currentTimeMillis()) return;
        JSONObject entry = new JSONObject();
        try {
            entry.put("group", group);
            entry.put("title", title);
            entry.put("body", body);
            entry.put("at", atMillis);
        } catch (JSONException ignored) {
            return;
        }
        prefs(context).edit().putString(String.valueOf(id), entry.toString()).apply();
        setAlarm(context, id, group, title, body, atMillis);
    }

    static void cancel(Context context, int id) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms != null) alarms.cancel(pendingIntent(context, id, null, null, null));
        prefs(context).edit().remove(String.valueOf(id)).apply();
    }

    static void cancelGroup(Context context, String group) {
        for (String key : keysInGroup(context, group)) cancel(context, Integer.parseInt(key));
    }

    /** Re-arms every stored reminder that is still in the future. */
    static void restoreAll(Context context) {
        SharedPreferences prefs = prefs(context);
        SharedPreferences.Editor editor = prefs.edit();
        long now = System.currentTimeMillis();
        for (String key : new ArrayList<String>(prefs.getAll().keySet())) {
            try {
                JSONObject entry = new JSONObject(prefs.getString(key, "{}"));
                long at = entry.getLong("at");
                if (at <= now) {
                    editor.remove(key);
                } else {
                    setAlarm(context, Integer.parseInt(key), entry.getString("group"), entry.getString("title"), entry.getString("body"), at);
                }
            } catch (Exception e) {
                editor.remove(key);
            }
        }
        editor.apply();
    }

    static void forget(Context context, int id) {
        prefs(context).edit().remove(String.valueOf(id)).apply();
    }

    private static List<String> keysInGroup(Context context, String group) {
        List<String> keys = new ArrayList<String>();
        SharedPreferences prefs = prefs(context);
        Iterator<String> iterator = prefs.getAll().keySet().iterator();
        while (iterator.hasNext()) {
            String key = iterator.next();
            try {
                if (group.equals(new JSONObject(prefs.getString(key, "{}")).optString("group"))) keys.add(key);
            } catch (JSONException ignored) {
                keys.add(key);
            }
        }
        return keys;
    }

    private static void setAlarm(Context context, int id, String group, String title, String body, long atMillis) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return;
        PendingIntent intent = pendingIntent(context, id, group, title, body);
        if (canScheduleExact(context)) {
            alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMillis, intent);
        } else {
            // Without the exact-alarm permission Android may deliver this a few minutes late.
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMillis, intent);
        }
    }

    private static PendingIntent pendingIntent(Context context, int id, String group, String title, String body) {
        Intent intent = new Intent(context, ReminderReceiver.class);
        intent.setAction("com.bloomora.app.REMINDER." + id);
        if (title != null) {
            intent.putExtra("id", id);
            intent.putExtra("group", group);
            intent.putExtra("title", title);
            intent.putExtra("body", body);
        }
        return PendingIntent.getBroadcast(context, id, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
