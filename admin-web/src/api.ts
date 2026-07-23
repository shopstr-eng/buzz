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
 * Requires a NIP-07 browser extension (window.nostr).
 */
export async function buildNip98Header(
  url: string,
  method: string,
): Promise<string> {
  if (!window.nostr) {
    throw new ApiFailure(
      401,
      "No Nostr browser extension detected. Install one (e.g. Alby or nos2x) to access the admin panel.",
    );
  }
  const event = await window.nostr.signEvent({
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["u", url],
      ["method", method.toUpperCase()],
    ],
    content: "",
  });
  return `Nostr ${btoa(JSON.stringify(event))}`;
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
