/**
 * Thin wrapper around window.BloomoraNative, the bridge exposed by the Android
 * app (android-native/). Every helper is a no-op or returns false on the web.
 */

interface NativeBridge {
  getInfo(): string;
  saveFile(filename: string, mime: string, content: string, base64: boolean): void;
  setSystemBars(colorHex: string, dark: boolean): void;
  setKeepScreenOn(on: boolean): void;
  haptic(): void;
  exitApp(): void;
  openExternal(url: string): void;
  notificationsAllowed(): boolean;
  requestNotificationPermission(): void;
  canScheduleExactAlarms(): boolean;
  openExactAlarmSettings(): void;
  scheduleReminder(id: number, group: string, title: string, body: string, atMillis: number): void;
  cancelReminder(id: number): void;
  cancelReminderGroup(group: string): void;
  httpRequest(requestId: string, method: string, url: string, headersJson: string, body: string): void;
}

declare global {
  interface Window {
    BloomoraNative?: NativeBridge;
    __bloomoraHttp?: (id: string, status: number, body: string, error: string) => void;
    __bloomoraBack?: () => boolean;
  }
}

function bridge(): NativeBridge | undefined {
  return typeof window === 'undefined' ? undefined : window.BloomoraNative;
}

export function isNativeApp(): boolean {
  return Boolean(bridge());
}

export interface NativeInfo {
  platform: 'android';
  version: string;
  sdk: number;
  notificationsAllowed: boolean;
  exactAlarms: boolean;
}

export function nativeInfo(): NativeInfo | null {
  const native = bridge();
  if (!native) return null;
  try {
    return JSON.parse(native.getInfo()) as NativeInfo;
  } catch {
    return null;
  }
}

/** Opens Android's "Save as" picker. Returns false on the web so callers can fall back. */
export function nativeSaveFile(filename: string, mime: string, content: string): boolean {
  const native = bridge();
  if (!native) return false;
  native.saveFile(filename, mime, content, false);
  return true;
}

const pendingHttp = new Map<string, { resolve: (value: { status: number; body: string }) => void; reject: (error: Error) => void }>();
let httpCounter = 0;

/** Sends an HTTPS request through the native layer (no CORS). */
export function nativeHttp(url: string, init: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; body: string }> {
  const native = bridge();
  if (!native) return Promise.reject(new Error('Native HTTP is only available in the Android app.'));
  window.__bloomoraHttp ??= (id, status, body, error) => {
    const pending = pendingHttp.get(id);
    if (!pending) return;
    pendingHttp.delete(id);
    if (error && !status) pending.reject(new Error(error));
    else pending.resolve({ status, body });
  };
  httpCounter += 1;
  const id = `req_${Date.now()}_${httpCounter}`;
  return new Promise((resolve, reject) => {
    pendingHttp.set(id, { resolve, reject });
    native.httpRequest(id, init.method || 'GET', url, JSON.stringify(init.headers || {}), init.body || '');
  });
}

export function setNativeSystemBars(colorHex: string, dark: boolean) {
  bridge()?.setSystemBars(colorHex, dark);
}

export function setNativeKeepScreenOn(on: boolean) {
  bridge()?.setKeepScreenOn(on);
}

export function nativeHaptic() {
  bridge()?.haptic();
}

export function exitNativeApp() {
  bridge()?.exitApp();
}

export function scheduleNativeReminder(id: number, group: string, title: string, body: string, at: number) {
  bridge()?.scheduleReminder(id, group, title, body, at);
}

export function cancelNativeReminder(id: number) {
  bridge()?.cancelReminder(id);
}

export function cancelNativeReminderGroup(group: string) {
  bridge()?.cancelReminderGroup(group);
}

export function requestNativeNotificationPermission() {
  bridge()?.requestNotificationPermission();
}

export function openNativeExactAlarmSettings() {
  bridge()?.openExactAlarmSettings();
}

/** Stable positive 31-bit id for a reminder key, so rescheduling replaces the same alarm. */
export function reminderId(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (Math.imul(hash, 31) + key.charCodeAt(i)) | 0;
  return (Math.abs(hash) % 2_000_000_000) + 100;
}
