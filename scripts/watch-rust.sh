#!/usr/bin/env bash
# Watches crates/ for Rust source changes and rebuilds buzz-relay + buzz-admin.
# Runs in the background from start-replit.sh.
# On a successful build it SIGTERMs the running relay (PID stored in
# /tmp/buzz-relay.pid) so the main loop in start-replit.sh restarts it.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Apply the same Rust toolchain workarounds as start-replit.sh:
#  - Unset rustup vars so Nix cargo 1.88 is used directly.
#  - Strip the hermit workspace/bin from PATH (it routes through broken rustc 1.95).
unset RUSTUP_TOOLCHAIN RUSTUP_HOME
export PATH
PATH=$(printf '%s' "$PATH" | tr ':' '\n' | grep -v '/home/runner/workspace/bin' | paste -sd ':')

PID_FILE="/tmp/buzz-relay.pid"
LOG_PREFIX="[rust-watcher]"

# Locate inotifywait: prefer PATH, then scan the nix store.
INOTIFYWAIT=""
if command -v inotifywait >/dev/null 2>&1; then
  INOTIFYWAIT=$(command -v inotifywait)
else
  INOTIFYWAIT=$(find /nix/store -maxdepth 3 -name inotifywait 2>/dev/null \
    | grep 'inotify-tools' | head -1 || true)
fi

# ---------------------------------------------------------------------------
# Build function — rebuilds both relay binaries, then restarts the relay.
# ---------------------------------------------------------------------------
build_relay() {
  echo "${LOG_PREFIX} ==> Rust source change detected — rebuilding buzz-relay and buzz-admin..."
  cd "$REPO_ROOT"
  if cargo build --ignore-rust-version -p buzz-relay -p buzz-admin --release \
      2>&1 | sed "s/^/${LOG_PREFIX} /"; then
    echo "${LOG_PREFIX} ==> Build succeeded."
    if [[ -f "$PID_FILE" ]]; then
      local relay_pid
      relay_pid=$(cat "$PID_FILE" 2>/dev/null || echo "")
      if [[ -n "$relay_pid" ]] && kill -0 "$relay_pid" 2>/dev/null; then
        echo "${LOG_PREFIX} ==> Sending SIGTERM to relay (PID ${relay_pid}) to pick up new binary..."
        kill -TERM "$relay_pid" 2>/dev/null || true
      fi
    fi
  else
    echo "${LOG_PREFIX} ==> Build FAILED — keeping current relay running." >&2
  fi
}

cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# Watch loop — inotifywait (preferred) or polling fallback
# ---------------------------------------------------------------------------
if [[ -n "$INOTIFYWAIT" && -x "$INOTIFYWAIT" ]]; then
  echo "${LOG_PREFIX} ==> Watching crates/ for Rust source changes via inotifywait..."
  while true; do
    # Block until any .rs or .toml file changes under crates/, or Cargo.toml/Cargo.lock
    "$INOTIFYWAIT" -r -q \
      -e close_write -e create -e delete -e moved_to \
      --include '\.(rs|toml|lock)$' \
      crates/ Cargo.toml Cargo.lock 2>/dev/null || true

    # Debounce: wait for the editor to finish flushing (e.g. save storms)
    sleep 3

    # Drain any additional events that arrived during the debounce window
    "$INOTIFYWAIT" -r -q -t 2 \
      -e close_write -e create -e delete -e moved_to \
      --include '\.(rs|toml|lock)$' \
      crates/ Cargo.toml Cargo.lock 2>/dev/null || true

    build_relay
  done
else
  echo "${LOG_PREFIX} ==> inotifywait not found; falling back to 5-second polling..."
  SENTINEL_FILE="/tmp/buzz-rust-watcher-sentinel"
  touch "$SENTINEL_FILE"
  while true; do
    sleep 5
    if find crates/ Cargo.toml Cargo.lock \
        \( -name '*.rs' -o -name '*.toml' -o -name 'Cargo.lock' \) \
        -newer "$SENTINEL_FILE" -print -quit 2>/dev/null | grep -q .; then
      touch "$SENTINEL_FILE"
      build_relay
    fi
  done
fi
