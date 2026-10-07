package com.bloomora.app;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.os.Build;

/** Posts the notification for a reminder scheduled by {@link Reminders}. */
public class ReminderReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        int id = intent.getIntExtra("id", 0);
        String group = intent.getStringExtra("group");
        String title = intent.getStringExtra("title");
        String body = intent.getStringExtra("body");
        Reminders.forget(context, id);
        if (title == null) return;

        Reminders.ensureChannels(context);
        String channel = "timer".equals(group) ? Reminders.CHANNEL_TIMER : Reminders.CHANNEL_REMINDERS;

        Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent content = PendingIntent.getActivity(context, id, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(context, channel)
                : new Notification.Builder(context);
        builder.setSmallIcon(R.drawable.ic_stat_bloomora)
                .setColor(Color.parseColor("#4f46e5"))
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setContentIntent(content)
                .setAutoCancel(true)
                .setCategory("timer".equals(group) ? Notification.CATEGORY_ALARM : Notification.CATEGORY_REMINDER);
        if (Build.VERSION.SDK_INT < 26) {
            builder.setPriority("timer".equals(group) ? Notification.PRIORITY_HIGH : Notification.PRIORITY_DEFAULT);
            builder.setDefaults(Notification.DEFAULT_ALL);
        }

        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.notify(id, builder.build());
    }
}
