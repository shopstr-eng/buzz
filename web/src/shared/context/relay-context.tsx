/**
 * RelayContext — provides the persistent relay connection and identity
 * to the entire app. Wrap the root with <RelayProvider />.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { relayWsUrl } from "@/shared/lib/relay-url";
import { RelayConnection, type ConnectionState } from "@/shared/lib/relay-connection";
import {
  clearIdentity,
  getSignFn,
  hasNip07,
  loadIdentity,
  loginWithNip07,
  loginWithNsec,
  type StoredIdentity,
} from "@/shared/lib/identity";

interface RelayContextValue {
  /** Live WebSocket connection to the relay (null if not yet initialised). */
  connection: RelayConnection | null;
  /** Currently authenticated identity. */
  identity: StoredIdentity | null;
  /** Current WebSocket state. */
  connectionState: ConnectionState;
  /** Log in with NIP-07 extension. */
  loginWithExtension: () => Promise<void>;
  /** Log in with a raw nsec / bech32 secret key. */
  loginWithKey: (nsec: string) => void;
  /** Log out and disconnect. */
  logout: () => void;
}

const RelayContext = createContext<RelayContextValue | null>(null);

export function useRelay(): RelayContextValue {
  const ctx = useContext(RelayContext);
  if (!ctx) throw new Error("useRelay must be used within <RelayProvider>");
  return ctx;
}

export function RelayProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<StoredIdentity | null>(
    () => loadIdentity(),
  );
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("disconnected");
  // Keep connection in both state (triggers re-renders) and ref (stable reference
  // for imperative use in callbacks).
  const [connection, setConnection] = useState<RelayConnection | null>(null);
  const connRef = useRef<RelayConnection | null>(null);

  // Build (or rebuild) the connection whenever the identity changes.
  useEffect(() => {
    // Tear down any existing connection first.
    if (connRef.current) {
      connRef.current.stop();
      connRef.current = null;
      setConnection(null);
    }

    if (!identity) {
      setConnectionState("disconnected");
      return;
    }

    const signFn = getSignFn();
    if (!signFn) {
      // Identity stored but signing key lost (e.g. page reload with nsec).
      // Clear and require re-login.
      clearIdentity();
      setIdentity(null);
      return;
    }

    const conn = new RelayConnection(relayWsUrl(), signFn);
    connRef.current = conn;
    setConnection(conn);

    const unsub = conn.onStateChange(setConnectionState);
    conn.start();

    return () => {
      unsub();
      conn.stop();
      connRef.current = null;
      setConnection(null);
    };
  }, [identity]);

  const loginWithExtension = useCallback(async () => {
    if (!hasNip07()) throw new Error("No NIP-07 browser extension found.");
    const id = await loginWithNip07();
    setIdentity(id);
  }, []);

  const loginWithKey = useCallback((nsec: string) => {
    const id = loginWithNsec(nsec);
    setIdentity(id);
  }, []);

  const logout = useCallback(() => {
    connRef.current?.stop();
    connRef.current = null;
    setConnection(null);
    clearIdentity();
    setIdentity(null);
    setConnectionState("disconnected");
  }, []);

  return (
    <RelayContext.Provider
      value={{
        connection,
        identity,
        connectionState,
        loginWithExtension,
        loginWithKey,
        logout,
      }}
    >
      {children}
    </RelayContext.Provider>
  );
}
