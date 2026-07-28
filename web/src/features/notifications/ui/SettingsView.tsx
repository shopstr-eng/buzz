/**
 * Settings screen: notification + sound preferences.
 */

import { Bell, BellOff, Volume2, VolumeX } from "lucide-react";
import { useNotificationSettings } from "../use-notification-settings";

function Toggle({
  checked,
  onChange,
  label,
  description,
  icon,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-black/10 px-4 py-3 dark:border-white/10">
      <span className="text-black/40 dark:text-white/40">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-black dark:text-white">{label}</p>
        <p className="text-xs text-black/50 dark:text-white/50">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? "bg-violet-600" : "bg-black/20 dark:bg-white/20"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-4.5 left-0.5" : "translate-x-0.5"
          }`}
          style={checked ? { transform: "translateX(18px)" } : undefined}
        />
      </button>
    </div>
  );
}

export function SettingsView() {
  const { settings, update } = useNotificationSettings();
  const permission =
    typeof Notification === "undefined" ? "unsupported" : Notification.permission;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b border-black/10 px-4 py-3 dark:border-white/10">
        <h1 className="text-sm font-semibold text-black dark:text-white">Settings</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-black/40 dark:text-white/40">
          Notifications
        </h2>
        <div className="space-y-2">
          <Toggle
            checked={settings.enabled}
            onChange={(v) => update({ enabled: v })}
            label="Mention notifications"
            description="Browser notification when someone @-mentions you"
            icon={settings.enabled ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
          />
          <Toggle
            checked={settings.sound}
            onChange={(v) => update({ sound: v })}
            label="Notification sound"
            description="Play a ping when a mention arrives"
            icon={settings.sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          />
        </div>

        {settings.enabled && permission !== "unsupported" && (
          <div className="mt-3 rounded-lg border border-black/10 px-4 py-3 dark:border-white/10">
            <p className="text-xs text-black/60 dark:text-white/60">
              Browser permission:{" "}
              <span className="font-medium">
                {permission === "granted"
                  ? "granted"
                  : permission === "denied"
                    ? "denied (enable it in your browser's site settings)"
                    : "not requested"}
              </span>
            </p>
            {permission === "default" && (
              <button
                type="button"
                onClick={() => void Notification.requestPermission()}
                className="mt-2 rounded-lg bg-black px-3 py-1.5 text-xs font-medium text-white hover:opacity-80 dark:bg-white dark:text-black"
              >
                Allow notifications
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
