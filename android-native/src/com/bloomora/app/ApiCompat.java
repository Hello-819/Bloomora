package com.bloomora.app;

import android.app.Activity;
import android.graphics.Insets;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

/**
 * Calls into APIs newer than the app's minimum SDK. Kept in separate classes
 * so older Android versions never have to load them.
 */
final class ApiCompat {
    private ApiCompat() {}

    /** Android 11+: draw behind the system bars and pad the content by their size. */
    static final class Api30 {
        private Api30() {}

        static void edgeToEdge(Window window, View root) {
            window.setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
                @Override
                public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                    Insets bars = insets.getInsets(
                            WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                    v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                    return WindowInsets.CONSUMED;
                }
            });
        }

        static void setBarAppearance(Window window, boolean dark) {
            WindowInsetsController controller = window.getInsetsController();
            if (controller == null) return;
            int light = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                    | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            controller.setSystemBarsAppearance(dark ? 0 : light, light);
        }
    }

    /** Android 13+: back gestures arrive through OnBackInvokedDispatcher. */
    static final class Api33 {
        private Api33() {}

        static void onBack(Activity activity, final Runnable handler) {
            activity.getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                    new OnBackInvokedCallback() {
                        @Override
                        public void onBackInvoked() {
                            handler.run();
                        }
                    });
        }
    }
}
