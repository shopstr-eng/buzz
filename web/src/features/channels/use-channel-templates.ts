/**
 * Channel templates (web-local, localStorage): saved channel configurations
 * applied in the create-channel flow. Desktop stores these via Tauri
 * `channel-templates` commands; the web keeps its own copy (no relay format).
 */

import { useEffect, useState } from "react";
import type { ChannelType } from "./types";

const LS_KEY = "buzz.channelTemplates.v1";

export interface ChannelTemplate {
  id: string;
  name: string;
  about: string;
  channelType: ChannelType;
  isPrivate: boolean;
  model?: string;
}

function load(): ChannelTemplate[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChannelTemplate[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

let templates: ChannelTemplate[] = load();
const listeners = new Set<() => void>();

function persist(): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(templates));
  } catch {
    // quota — non-fatal
  }
  for (const fn of listeners) fn();
}

export function saveChannelTemplate(
  input: Omit<ChannelTemplate, "id">,
): void {
  templates = [...templates, { ...input, id: crypto.randomUUID() }];
  persist();
}

export function deleteChannelTemplate(id: string): void {
  templates = templates.filter((t) => t.id !== id);
  persist();
}

export function useChannelTemplates(): {
  templates: ChannelTemplate[];
  save: typeof saveChannelTemplate;
  remove: typeof deleteChannelTemplate;
} {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((t) => t + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return { templates, save: saveChannelTemplate, remove: deleteChannelTemplate };
}
