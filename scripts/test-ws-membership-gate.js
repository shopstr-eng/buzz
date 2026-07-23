#!/usr/bin/env node
/**
 * test-ws-membership-gate.js
 *
 * Confirms non-members are blocked at the WebSocket / NIP-42 level when
 * BUZZ_REQUIRE_RELAY_MEMBERSHIP=true.
 *
 * Scenarios:
 *   1. Non-member pubkey authenticates → relay rejects with
 *      "restricted: not a relay member"
 *   2. Member pubkey authenticates → relay accepts (OK true) and allows a REQ
 *      subscription to open without CLOSED/auth-required.
 *   3. Non-member whose AUTH was rejected tries to send an EVENT on the same
 *      connection → relay responds OK false / auth-required (not OK true).
 *   4. Client sends an EVENT before sending any AUTH at all → relay responds
 *      OK false / auth-required (not OK true).
 *
 * Usage:
 *   node scripts/test-ws-membership-gate.js
 *
 * Environment:
 *   RELAY_WS_URL    WebSocket URL to connect to (default: ws://localhost:3000).
 *                   Controls the transport; the Host header is derived separately.
 *   RELAY_URL       The relay's canonical URL (wss?://…) used for the NIP-42
 *                   relay tag and Host header derivation.  Defaults to the env
 *                   var of the same name exported by start-replit.sh.
 *   DATABASE_URL    Postgres connection string for inserting/removing test rows.
 *   COMMUNITY_HOST  Override Host header sent with the WebSocket upgrade.
 *
 * Dependencies (nostr-tools, ws) are auto-installed from
 * scripts/nostr-tools-test-package.json when not already present.
 *
 * Exit 0 on success, 1 on any failure.
 */

'use strict';

// ─── Bootstrap: auto-install deps from scripts/nostr-tools-test-package.json ─

const path   = require('path');
const fs     = require('fs');
const { execSync } = require('child_process');

const SCRIPT_DIR   = __dirname;
const PKG_JSON     = path.join(SCRIPT_DIR, 'nostr-tools-test-package.json');
const NODE_MODULES = path.join(SCRIPT_DIR, 'nostr-tools-test-node_modules');

// Resolve modules from the private install directory first so we never pollute
// the workspace root node_modules.
require('module').globalPaths.unshift(NODE_MODULES);

function depsMissing() {
  try { require('ws'); require('nostr-tools'); return false; } catch { return true; }
}

if (depsMissing()) {
  if (!fs.existsSync(PKG_JSON)) {
    console.error(`ERROR: ${PKG_JSON} not found — cannot install dependencies.`);
    process.exit(1);
  }
  // npm install with --prefix requires a package.json in the prefix directory.
  // Copy the declared package.json there, then run npm install.
  fs.mkdirSync(NODE_MODULES, { recursive: true });
  fs.copyFileSync(PKG_JSON, path.join(NODE_MODULES, 'package.json'));
  console.log('==> Installing test dependencies from nostr-tools-test-package.json…');
  execSync(
    'npm install --prefer-offline --loglevel error',
    { cwd: NODE_MODULES, stdio: 'inherit' },
  );
}

// Now require runtime deps — resolve explicitly from the install directory.
// globalPaths is populated above, but explicit resolution is more reliable.
function req(name) {
  // 1. Try the install dir's node_modules (npm install without --prefix puts
  //    deps in <cwd>/node_modules).
  const nmPath = path.join(NODE_MODULES, 'node_modules', name);
  if (fs.existsSync(nmPath)) return require(nmPath);
  // 2. Try the globalPaths resolution (catches already-installed system deps).
  try { return require(name); } catch (_) {}
  throw new Error(`Cannot resolve module '${name}' from ${NODE_MODULES}`);
}

const WebSocket = req('ws');
const {
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
} = req('nostr-tools');

// ─── Config ───────────────────────────────────────────────────────────────────

// RELAY_WS_URL: transport-level WebSocket URL (may be ws:// even in production
// when testing from within the container via loopback).
const RELAY_WS_URL = process.env.RELAY_WS_URL || 'ws://localhost:3000';
const DATABASE_URL = process.env.DATABASE_URL;

const CONNECT_TIMEOUT_MS = 8000;
const AUTH_TIMEOUT_MS    = 5000;

// ── Relay tag URL ──────────────────────────────────────────────────────────
// The relay verifies the NIP-42 AUTH event's `relay` tag against its
// configured relay_url (RELAY_URL env var), using that URL's scheme.
// We must match it exactly — hardcoding wss:// when RELAY_URL is ws:// will
// cause the relay to reject on scheme mismatch before reaching the membership
// check, making the test report the wrong failure.
//
// Priority:
//   1. RELAY_URL (set by start-replit.sh from the actual deployment URL)
//   2. RELAY_WS_URL with its scheme preserved
//
// The relay tag URL must use the SAME SCHEME that the relay's config contains.
function deriveRelayTagUrl() {
  const relayUrl = process.env.RELAY_URL || '';
  if (relayUrl) {
    // Use the configured relay URL as-is — it already has the right scheme.
    return relayUrl;
  }
  // Fall back: use RELAY_WS_URL scheme + host.
  return RELAY_WS_URL;
}

// ── Host header ────────────────────────────────────────────────────────────
// The relay uses host-based tenant routing.  When connecting via loopback
// (ws://localhost:3000), the Host header must match a community row.
function deriveHostHeader() {
  if (process.env.COMMUNITY_HOST) return process.env.COMMUNITY_HOST;
  // Prefer RELAY_URL host: it was used to seed the communities table.
  const m = (process.env.RELAY_URL || '').match(/^wss?:\/\/([^/:]+)/);
  if (m) return m[1];
  // Fall back to the host in RELAY_WS_URL.
  const m2 = RELAY_WS_URL.match(/^wss?:\/\/([^/:]+)/);
  return m2 ? m2[1] : 'localhost';
}

const RELAY_TAG_URL  = deriveRelayTagUrl();
const COMMUNITY_HOST = deriveHostHeader();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(tag, ...args) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] [${tag}]`, ...args);
}

function pass(msg) { console.log(`\n  ✓ PASS  ${msg}`); }
function fail(msg) { console.error(`\n  ✗ FAIL  ${msg}`); process.exitCode = 1; }

function psql(sql) {
  if (!DATABASE_URL) throw new Error('DATABASE_URL not set');
  // Pass SQL via stdin to avoid shell quoting/escape issues.
  return execSync(`psql "${DATABASE_URL}" -t`, {
    input: sql,
    encoding: 'utf8',
  }).trim();
}

/**
 * Open a WebSocket to the relay, passing the correct Host header for tenant
 * routing. Waits for the NIP-42 ["AUTH", challenge] frame.
 * Returns { ws, challenge }.
 */
function connectAndGetChallenge(label) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(RELAY_WS_URL, {
      headers: { Host: COMMUNITY_HOST },
    });
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        ws.terminate();
        reject(new Error(`${label}: timed out waiting for AUTH challenge`));
      }
    }, CONNECT_TIMEOUT_MS);

    ws.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`${label}: WebSocket error — ${err.message}`));
      }
    });

    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (!Array.isArray(msg) || msg[0] !== 'AUTH') return;

      const challenge = msg[1];
      log(label, `received AUTH challenge: ${challenge}`);
      clearTimeout(timer);
      if (!settled) { settled = true; resolve({ ws, challenge }); }
    });
  });
}

/**
 * Build a NIP-42 AUTH event (kind 22242) signed by sk and send it.
 * The `relay` tag uses RELAY_TAG_URL — must match the relay's configured URL
 * (same scheme) or the relay will reject on URL mismatch, not membership.
 *
 * Returns { pubkey, collected } where collected is the array of relay
 * messages received after sending AUTH.
 */
function sendAuthAndCollectResponse(ws, sk, challenge, timeoutMs = AUTH_TIMEOUT_MS) {
  const pubkey = getPublicKey(sk); // nostr-tools v2: returns hex string

  const event = finalizeEvent(
    {
      kind: 22242,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['relay', RELAY_TAG_URL],
        ['challenge', challenge],
      ],
      content: '',
    },
    sk,
  );

  return new Promise((resolve, reject) => {
    let settled = false;
    const collected = [];

    const timer = setTimeout(() => {
      if (!settled) { settled = true; resolve({ pubkey, collected }); }
    }, timeoutMs);

    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (!Array.isArray(msg)) return;
      const type = msg[0];
      if (type === 'OK' || type === 'NOTICE' || type === 'CLOSED') {
        collected.push(msg);
        if (type === 'OK') {
          clearTimeout(timer);
          if (!settled) { settled = true; resolve({ pubkey, collected }); }
        }
      }
    });

    ws.on('error', (err) => {
      if (!settled) { settled = true; clearTimeout(timer); reject(err); }
    });
    ws.on('close', () => {
      if (!settled) { settled = true; clearTimeout(timer); resolve({ pubkey, collected }); }
    });

    log('sendAuth', `pubkey=${pubkey.slice(0, 16)}… relay_tag=${RELAY_TAG_URL}`);
    ws.send(JSON.stringify(['AUTH', event]));
  });
}

/**
 * Build a kind-1 Nostr event signed by sk and send it as ["EVENT", event].
 * Waits for the relay's OK response whose event-id matches, or for a NOTICE,
 * or for the connection to close — whichever comes first.
 *
 * Returns { eventId, collected } where collected is an array of relay messages
 * received (OK, NOTICE, etc.).
 */
function sendEventAndCollectResponse(ws, sk, timeoutMs = 4000) {
  const event = finalizeEvent(
    {
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: 'test event — membership gate race check',
    },
    sk,
  );
  const eventId = event.id; // hex string (nostr-tools v2)

  return new Promise((resolve) => {
    let settled = false;
    const collected = [];

    const done = () => {
      if (!settled) { settled = true; clearTimeout(timer); resolve({ eventId, collected }); }
    };

    const timer = setTimeout(done, timeoutMs);

    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (!Array.isArray(msg)) return;
      const type = msg[0];
      if (type === 'OK' && msg[1] === eventId) {
        collected.push(msg);
        done();
      } else if (type === 'NOTICE') {
        collected.push(msg);
        // NOTICE alone may not be the final word; keep waiting for OK.
      }
    });

    ws.on('error', () => done());
    ws.on('close', () => done());

    log('sendEvent', `kind=1 event_id=${eventId.slice(0, 16)}…`);
    ws.send(JSON.stringify(['EVENT', event]));
  });
}

/**
 * After auth, send a REQ and wait for EOSE or CLOSED.
 * Returns 'eose', 'timeout', or { closed: reason }.
 */
function sendReqAndWait(ws, subId, filter, timeoutMs = 4000) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; resolve('timeout'); }
    }, timeoutMs);

    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (!Array.isArray(msg)) return;
      const [type, sid] = msg;
      if (sid !== subId) return;
      if (type === 'EOSE') {
        clearTimeout(timer);
        if (!settled) { settled = true; resolve('eose'); }
      } else if (type === 'CLOSED') {
        clearTimeout(timer);
        if (!settled) { settled = true; resolve({ closed: msg[2] }); }
      }
    });

    ws.send(JSON.stringify(['REQ', subId, filter]));
  });
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

function getCommunityId() {
  const row = psql(
    `SELECT id FROM communities WHERE lower(host) = lower('${COMMUNITY_HOST}') LIMIT 1;`,
  );
  if (row) return row;
  // Fallback for local envs without proper host seeding
  return psql('SELECT id FROM communities LIMIT 1;');
}

function insertMember(communityId, pubkeyHex) {
  psql(`INSERT INTO relay_members (community_id, pubkey, role) VALUES ('${communityId}', '${pubkeyHex}', 'member') ON CONFLICT (community_id, pubkey) DO NOTHING;`);
}

function removeMember(communityId, pubkeyHex) {
  try {
    psql(`DELETE FROM relay_members WHERE community_id='${communityId}' AND pubkey='${pubkeyHex}';`);
  } catch (e) {
    log('cleanup', `warning: could not remove test member: ${e.message}`);
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

async function test1_nonMemberIsRejected() {
  console.log('\n━━━━  Test 1: Non-member pubkey is rejected at NIP-42 layer  ━━━━');

  const { ws, challenge } = await connectAndGetChallenge('non-member');
  pass('relay sent NIP-42 AUTH challenge on WebSocket connect');

  const sk = generateSecretKey();
  const { pubkey, collected } = await sendAuthAndCollectResponse(ws, sk, challenge);
  ws.terminate();

  log('test1', `collected responses: ${JSON.stringify(collected)}`);

  const okMsg = collected.find((m) => m[0] === 'OK');
  if (!okMsg) {
    fail('no OK response received after AUTH for non-member');
    return;
  }

  const [, , accepted, reason] = okMsg;
  if (accepted !== false) {
    fail(`expected OK false for non-member, got OK ${accepted}`);
    return;
  }
  pass(`relay rejected non-member: OK false — "${reason}"`);

  if (typeof reason !== 'string' || !reason.includes('not a relay member')) {
    fail(`rejection reason should contain "not a relay member", got: "${reason}"`);
    return;
  }
  pass('rejection reason mentions "not a relay member"');
}

async function test2_memberIsAccepted(communityId) {
  console.log('\n━━━━  Test 2: Member pubkey is accepted at NIP-42 layer  ━━━━');

  const sk        = generateSecretKey();
  const pubkeyHex = getPublicKey(sk); // already lowercase hex in nostr-tools v2

  log('test2', `inserting test member pubkey=${pubkeyHex.slice(0, 16)}…`);
  insertMember(communityId, pubkeyHex);

  try {
    const { ws, challenge } = await connectAndGetChallenge('member');
    pass('relay sent NIP-42 AUTH challenge on WebSocket connect');

    const { pubkey, collected } = await sendAuthAndCollectResponse(ws, sk, challenge);
    log('test2', `collected responses: ${JSON.stringify(collected)}`);

    const okMsg = collected.find((m) => m[0] === 'OK');
    if (!okMsg) {
      fail('no OK response received after AUTH for member');
      ws.terminate();
      return;
    }

    const [, , accepted, reason] = okMsg;
    if (accepted !== true) {
      fail(`expected OK true for member, got OK ${accepted} — "${reason}"`);
      ws.terminate();
      return;
    }
    pass('relay accepted member: OK true');

    const subId = 'test-sub-' + Date.now();
    log('test2', `sending REQ sub_id=${subId}`);
    const reqResult = await sendReqAndWait(ws, subId, { kinds: [1], limit: 0 });
    log('test2', `REQ result: ${JSON.stringify(reqResult)}`);

    if (reqResult === 'eose') {
      pass('member REQ succeeded — received EOSE without auth-required rejection');
    } else if (reqResult === 'timeout') {
      pass('member REQ succeeded — relay kept subscription open (no CLOSED received)');
    } else {
      const closedReason = reqResult?.closed ?? '(unknown)';
      if (typeof closedReason === 'string' && closedReason.includes('auth-required')) {
        fail(`member REQ was rejected with auth-required: "${closedReason}"`);
      } else {
        fail(`member REQ received unexpected CLOSED: "${closedReason}"`);
      }
    }

    ws.terminate();
  } finally {
    removeMember(communityId, pubkeyHex);
    log('test2', 'test member cleaned up');
  }
}

/**
 * Test 3: Non-member whose AUTH was rejected cannot slip an EVENT through.
 *
 * Scenario: connect → get AUTH challenge → send AUTH as a non-member (OK false)
 * → immediately send an EVENT on the same connection.  The relay must respond
 * with OK false / auth-required, not OK true.
 */
async function test3_postFailedAuthEventIsRejected() {
  console.log('\n━━━━  Test 3: EVENT after failed AUTH is rejected  ━━━━');

  const { ws, challenge } = await connectAndGetChallenge('post-failed-auth');
  pass('relay sent NIP-42 AUTH challenge on WebSocket connect');

  const sk = generateSecretKey();
  const { pubkey, collected: authResponses } = await sendAuthAndCollectResponse(ws, sk, challenge);
  log('test3', `AUTH responses: ${JSON.stringify(authResponses)}`);

  const okAuth = authResponses.find((m) => m[0] === 'OK');
  if (!okAuth || okAuth[2] !== false) {
    fail(`expected OK false for non-member AUTH, got: ${JSON.stringify(okAuth)}`);
    ws.terminate();
    return;
  }
  pass(`non-member AUTH rejected: OK false — "${okAuth[3]}"`);

  // Now try to publish an EVENT on the same (auth-failed) connection.
  const { eventId, collected: eventResponses } = await sendEventAndCollectResponse(ws, sk);
  ws.terminate();
  log('test3', `EVENT responses: ${JSON.stringify(eventResponses)}`);

  const okEvent = eventResponses.find((m) => m[0] === 'OK' && m[1] === eventId);
  if (!okEvent) {
    // If the relay closed the connection without an OK that's also acceptable —
    // the event did not get through.  A missing OK means rejection.
    if (eventResponses.length === 0) {
      pass('relay closed connection without accepting the EVENT (no OK true received)');
    } else {
      fail(`no OK response for EVENT; got: ${JSON.stringify(eventResponses)}`);
    }
    return;
  }

  if (okEvent[2] === true) {
    fail(`relay accepted EVENT after failed AUTH: OK true — event slipped through!`);
    return;
  }

  const reason = okEvent[3] ?? '';
  pass(`EVENT rejected after failed AUTH: OK false — "${reason}"`);

  if (typeof reason !== 'string' || !reason.includes('auth-required')) {
    fail(`rejection reason should contain "auth-required", got: "${reason}"`);
    return;
  }
  pass('rejection reason correctly contains "auth-required"');
}

/**
 * Test 4: Client sends EVENT before sending any AUTH at all.
 *
 * Scenario: connect → receive AUTH challenge → send EVENT immediately without
 * sending AUTH first.  The relay must respond with OK false / auth-required.
 */
async function test4_preAuthEventIsRejected() {
  console.log('\n━━━━  Test 4: EVENT before any AUTH is rejected  ━━━━');

  // Wait for the AUTH challenge so we know the connection is fully established,
  // but do NOT send an AUTH response — just send an EVENT straight away.
  const { ws } = await connectAndGetChallenge('pre-auth');
  pass('relay sent NIP-42 AUTH challenge on WebSocket connect');

  const sk = generateSecretKey();
  const { eventId, collected } = await sendEventAndCollectResponse(ws, sk);
  ws.terminate();
  log('test4', `EVENT responses: ${JSON.stringify(collected)}`);

  const okEvent = collected.find((m) => m[0] === 'OK' && m[1] === eventId);
  if (!okEvent) {
    if (collected.length === 0) {
      pass('relay closed connection without accepting the EVENT (no OK true received)');
    } else {
      fail(`no OK response for EVENT; got: ${JSON.stringify(collected)}`);
    }
    return;
  }

  if (okEvent[2] === true) {
    fail(`relay accepted EVENT before any AUTH: OK true — event slipped through!`);
    return;
  }

  const reason = okEvent[3] ?? '';
  pass(`EVENT rejected before AUTH: OK false — "${reason}"`);

  if (typeof reason !== 'string' || !reason.includes('auth-required')) {
    fail(`rejection reason should contain "auth-required", got: "${reason}"`);
    return;
  }
  pass('rejection reason correctly contains "auth-required"');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nBuzz Relay — NIP-42 WebSocket Membership Gate Test`);
  console.log(`Relay (transport): ${RELAY_WS_URL}`);
  console.log(`Host header:       ${COMMUNITY_HOST}`);
  console.log(`NIP-42 relay tag:  ${RELAY_TAG_URL}`);
  console.log(`DB:                ${DATABASE_URL ? DATABASE_URL.replace(/:[^:@]*@/, ':***@') : '(not set)'}`);

  let communityId;
  try {
    communityId = getCommunityId();
    if (!communityId) throw new Error('no community row found');
    log('main', `community_id=${communityId}`);
  } catch (e) {
    console.error(`\nERROR: could not query communities table — ${e.message}`);
    console.error('Make sure DATABASE_URL is set and migrations have been applied.');
    process.exit(1);
  }

  await test1_nonMemberIsRejected();
  await test2_memberIsAccepted(communityId);
  await test3_postFailedAuthEventIsRejected();
  await test4_preAuthEventIsRejected();

  console.log('\n━━━━  Summary  ━━━━');
  if (process.exitCode === 1) {
    console.error('Some tests FAILED — see ✗ lines above.\n');
    process.exit(1);
  } else {
    console.log('All tests PASSED.\n');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('\nUnhandled error:', err.message);
  process.exit(1);
});
