// Native shell glue (Capacitor). Every function is a no-op in a plain browser so the web build,
// the Android/iOS apps and the desktop app share one code path.
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';

export const isNativeApp = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform();

export async function setupNativeShell(theme = 'light') {
  if (!isNativeApp) return;
  try {
    await StatusBar.setStyle({ style: theme === 'dark' ? Style.Dark : Style.Light });
    if (platform === 'android') await StatusBar.setBackgroundColor({ color: theme === 'dark' ? '#0F1519' : '#F5F6F4' });
  } catch {
    /* plugin unavailable */
  }
  try {
    await SplashScreen.hide({ fadeOutDuration: 200 });
  } catch {
    /* nothing to hide */
  }
}

/** Android back button: `handler` returns true when it handled the press; otherwise the app goes to the background. */
export function onHardwareBack(handler) {
  if (!isNativeApp) return () => {};
  const registration = CapacitorApp.addListener('backButton', () => {
    if (!handler()) CapacitorApp.minimizeApp();
  });
  return () => {
    registration.then((r) => r.remove()).catch(() => {});
  };
}
