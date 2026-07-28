/**
 * Message alerts: browser Notification + sound when a new message p-tags the
 * current user (mentions) OR lands in one of their DM channels. Live-only
 * subscriptions (since: now), mounted ONCE in the sidebar. Respects the
 * settings from use-notification-settings. A shared dedupe set prevents a
 * p-tagging DM message from alerting twice.
 */

import { useEffect, useRef } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useRelay } from "@/shared/context/relay-context";
import { KIND_STREAM_MSG, KIND_STREAM_MSG_V2 } from "../channels/types";
import { getNotificationSettings } from "./use-notification-settings";
import type { NostrEvent } from "@/shared/lib/relay-connection";

let pingAudio: HTMLAudioElement | null = null;

function playPing(): void {
  try {
    pingAudio ??= new Audio("/sounds/ping.mp3");
    pingAudio.currentTime = 0;
    void pingAudio.play().catch(() => {});
  } catch {
    // audio unavailable — non-fatal
  }
}

function notify(title: string, body: string, onClick?: () => void): void {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, { body: body.slice(0, 120), icon: "/favicon.ico" });
    if (onClick) {
      n.onclick = () => {
        window.focus();
        onClick();
      };
    }
  } catch {
    // some browsers require a service worker — ignore
  }
}

/**
 * Mount once (sidebar). Subscribes to live mentions of the current user,
 * plus live messages in their DM channels when `dmGroupIdsJoined`
 * (comma-separated, sorted — keeps the effect stable across re-renders) is
 * non-empty.
 */
export function useNotificationAlerts(dmGroupIdsJoined = ""): void {
  const { connection, connectionState, identity } = useRelay();
  const myPubkey = identity?.pubkey;
  const { location } = useRouterState();
  const navigate = useNavigate();

  // Track the current path WITHOUT re-subscribing on every route change:
  // the subscription must stay stable so live mentions aren't dropped in
  // the teardown/recreate window.
  const pathnameRef = useRef(location.pathname);
  useEffect(() => {
    pathnameRef.current = location.pathname;
  }, [location.pathname]);

  useEffect(() => {
    if (!connection || connectionState !== "ready" || !myPubkey) return;

    const since = Math.floor(Date.now() / 1000);
    const alerted = new Set<string>();

    function maybeAlert(ev: NostrEvent, source: "mention" | "dm"): void {
      if (ev.pubkey === myPubkey || alerted.has(ev.id)) return;

      // Skip when the user is already looking at this channel and the tab is visible.
      const groupId = ev.tags.find((t) => t[0] === "h")?.[1];
      const viewingChannel =
        !document.hidden && pathnameRef.current === `/channels/${groupId}`;
      if (viewingChannel) return;

      alerted.add(ev.id);
      const { enabled, sound } = getNotificationSettings();
      if (sound) playPing();
      if (enabled) {
        const sender = `${ev.pubkey.slice(0, 4)}…${ev.pubkey.slice(-4)}`;
        notify(
          source === "mention" ? `${sender} mentioned you` : `New message from ${sender}`,
          ev.content,
          () => {
            if (groupId) {
              void navigate({ to: "/channels/$groupId", params: { groupId } });
            }
          },
        );
      }
    }

    const unsubs = [
      connection.subscribe(
        { kinds: [KIND_STREAM_MSG, KIND_STREAM_MSG_V2], "#p": [myPubkey], since },
        (ev: NostrEvent) => maybeAlert(ev, "mention"),
      ),
    ];

    const dmIds = dmGroupIdsJoined.split(",").filter(Boolean);
    if (dmIds.length > 0) {
      unsubs.push(
        connection.subscribe(
          { kinds: [KIND_STREAM_MSG, KIND_STREAM_MSG_V2], "#h": dmIds, since },
          (ev: NostrEvent) => maybeAlert(ev, "dm"),
        ),
      );
    }

    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [connection, connectionState, myPubkey, navigate, dmGroupIdsJoined]);
}
