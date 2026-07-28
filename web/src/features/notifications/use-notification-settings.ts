/**
 * Notification + sound settings (web-local, localStorage).
 * Desktop stores these in Tauri config; the web keeps its own copy.
 */

import { useEffect, useState } from "react";

const LS_KEY = "buzz.notifications.v1";

export interface NotificationSettings {
  /** Browser notifications for mentions */
  enabled: boolean;
  /** Play a sound on mention */
  sound: boolean;
}

const DEFAULTS: NotificationSettings = { enabled: true, sound: true };

function load(): NotificationSettings {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<NotificationSettings>) };
  } catch {
    return DEFAULTS;
  }
}

let settings: NotificationSettings = load();
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

export function getNotificationSettings(): NotificationSettings {
  return settings;
}

export function updateNotificationSettings(patch: Partial<NotificationSettings>): void {
  settings = { ...settings, ...patch };
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(settings));
  } catch {
    // quota — non-fatal
  }
  emit();
}

export function useNotificationSettings(): {
  settings: NotificationSettings;
  update: (patch: Partial<NotificationSettings>) => void;
} {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((t) => t + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return { settings, update: updateNotificationSettings };
}
