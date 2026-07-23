import { getStoredNsecHex, signWithStoredNsec } from "./identity";

const PREFIX = "/api/admin/v1";

export class ApiFailure extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

interface NostrEvent {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
  pubkey: string;
  id: string;
  sig: string;
}

interface Nip07Provider {
  signEvent(
    template: Omit<NostrEvent, "pubkey" | "id" | "sig">,
  ): Promise<NostrEvent>;
}

declare const window: Window & { nostr?: Nip07Provider };

/**
 * Build a NIP-98 Authorization header value for the given URL and HTTP method.
 * Uses a NIP-07 browser extension (window.nostr) when available, otherwise
 * falls back to a secret key stored in sessionStorage.
 */
export async function buildNip98Header(
  url: string,
  method: string,
): Promise<string> {
  const template = {
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["u", url],
      ["method", method.toUpperCase()],
    ],
    content: "",
  };

  // Prefer NIP-07 extension.
  if (window.nostr) {
    const event = await window.nostr.signEvent(template);
    return `Nostr ${btoa(JSON.stringify(event))}`;
  }

  // Fall back to stored nsec.
  if (getStoredNsecHex()) {
    const b64 = signWithStoredNsec(template);
    return `Nostr ${b64}`;
  }

  throw new ApiFailure(
    401,
    "No identity found. Sign in with a browser extension or a secret key.",
  );
}

export async function request<T>(path: string): Promise<T> {
  const fullUrl = `${location.origin}${PREFIX}${path}`;
  const authValue = await buildNip98Header(fullUrl, "GET");
  const response = await fetch(`${PREFIX}${path}`, {
    credentials: "same-origin",
    headers: { accept: "application/json", Authorization: authValue },
  });
  if (!response.ok) {
    const envelope = await response.json().catch(() => null);
    throw new ApiFailure(
      response.status,
      envelope?.error?.message ?? `Request failed (${response.status})`,
    );
  }
  return response.json() as Promise<T>;
}

export async function del(path: string): Promise<void> {
  const fullUrl = `${location.origin}${PREFIX}${path}`;
  const authValue = await buildNip98Header(fullUrl, "DELETE");
  const response = await fetch(`${PREFIX}${path}`, {
    method: "DELETE",
    credentials: "same-origin",
    headers: { accept: "application/json", Authorization: authValue },
  });
  if (!response.ok) {
    const envelope = await response.json().catch(() => null);
    throw new ApiFailure(
      response.status,
      envelope?.error?.message ?? `Request failed (${response.status})`,
    );
  }
}

export async function patch(path: string, body: unknown): Promise<void> {
  const fullUrl = `${location.origin}${PREFIX}${path}`;
  const authValue = await buildNip98Header(fullUrl, "PATCH");
  const response = await fetch(`${PREFIX}${path}`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      Authorization: authValue,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const envelope = await response.json().catch(() => null);
    throw new ApiFailure(
      response.status,
      envelope?.error?.message ?? `Request failed (${response.status})`,
    );
  }
}

export async function post<T>(path: string, body: unknown): Promise<T> {
  const fullUrl = `${location.origin}${PREFIX}${path}`;
  const authValue = await buildNip98Header(fullUrl, "POST");
  const response = await fetch(`${PREFIX}${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      Authorization: authValue,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const envelope = await response.json().catch(() => null);
    throw new ApiFailure(
      response.status,
      envelope?.error?.message ?? `Request failed (${response.status})`,
    );
  }
  return response.json() as Promise<T>;
}
