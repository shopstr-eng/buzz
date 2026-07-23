//! End-to-end test: a deleted kind:30620 workflow stops appearing for all clients.
//!
//! # What is tested
//!
//! 1. Author publishes a kind:30620 workflow definition.
//! 2. A second client confirms it appears in a REQ query.
//! 3. Author publishes a kind:5 deletion event referencing both the event-id
//!    (`e` tag) and the NIP-33 coordinate (`a` tag).
//! 4. Both a new REQ from the second client **and** a fresh third connection
//!    confirm the workflow is no longer returned — i.e. the deletion is
//!    visible to everyone, not just the deleting client.
//!
//! # Running
//!
//! Start the relay, then:
//!
//! ```text
//! cargo test --test e2e_workflow_deletion -- --ignored
//! ```
//!
//! Set `RELAY_URL` to override the default `ws://localhost:3000`.

use std::time::Duration;

use buzz_test_client::BuzzTestClient;
use nostr::{Alphabet, EventBuilder, Filter, Keys, Kind, SingleLetterTag, Tag};
use uuid::Uuid;

const KIND_WORKFLOW_DEF: u16 = 30_620;
const KIND_DELETION: u16 = 5;

// ── helpers ────────────────────────────────────────────────────────────────

fn relay_url() -> String {
    std::env::var("RELAY_URL").unwrap_or_else(|_| "ws://localhost:3000".to_string())
}

fn relay_http_url() -> String {
    relay_url()
        .replace("wss://", "https://")
        .replace("ws://", "http://")
        .trim_end_matches('/')
        .to_string()
}

fn sub_id(label: &str) -> String {
    format!("wf-del-{label}-{}", Uuid::new_v4())
}

async fn e2e_db_pool() -> sqlx::Pool<sqlx::Postgres> {
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://buzz:buzz_dev@localhost:5432/buzz".to_string());
    sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(&database_url)
        .await
        .expect("connect to e2e Postgres")
}

async fn ensure_test_community(host: &str) -> Uuid {
    let pool = e2e_db_pool().await;
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO communities (id, host) \
         VALUES ($1, $2) \
         ON CONFLICT (lower(host)) DO NOTHING",
    )
    .bind(id)
    .bind(host)
    .execute(&pool)
    .await
    .unwrap_or_else(|e| panic!("seed community {host}: {e}"));

    sqlx::query_scalar("SELECT id FROM communities WHERE lower(host) = lower($1)")
        .bind(host)
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|e| panic!("lookup community {host}: {e}"))
}

async fn seed_relay_member(host: &str, keys: &Keys, role: &str) {
    let pool = e2e_db_pool().await;
    let community_id = ensure_test_community(host).await;
    sqlx::query(
        "INSERT INTO relay_members (community_id, pubkey, role, added_by) \
         VALUES ($1, $2, $3, NULL) \
         ON CONFLICT (community_id, pubkey) DO UPDATE \
         SET role = $3, updated_at = now()",
    )
    .bind(community_id)
    .bind(keys.public_key().to_hex())
    .bind(role)
    .execute(&pool)
    .await
    .unwrap_or_else(|e| panic!("seed relay member {role}: {e}"));
}

async fn seed_relay_owner(keys: &Keys) {
    seed_relay_member("localhost:3000", keys, "owner").await;
}

async fn create_test_channel(keys: &Keys) -> String {
    let client = reqwest::Client::new();
    let pubkey_hex = keys.public_key().to_hex();
    let channel_uuid = Uuid::new_v4();
    let channel_name = format!("relay-e2e-wf-del-{}", channel_uuid);

    let event = EventBuilder::new(Kind::Custom(9007), "")
        .tags(vec![
            Tag::parse(["h", &channel_uuid.to_string()]).unwrap(),
            Tag::parse(["name", &channel_name]).unwrap(),
            Tag::parse(["channel_type", "stream"]).unwrap(),
            Tag::parse(["visibility", "open"]).unwrap(),
        ])
        .sign_with_keys(keys)
        .unwrap();

    let resp = client
        .post(format!("{}/events", relay_http_url()))
        .header("X-Pubkey", &pubkey_hex)
        .header("Content-Type", "application/json")
        .body(serde_json::to_string(&event).unwrap())
        .send()
        .await
        .expect("submit create-channel event");
    assert!(
        resp.status().is_success(),
        "channel creation event failed: {}",
        resp.status()
    );
    let body: serde_json::Value = resp.json().await.expect("parse event response");
    assert!(
        body["accepted"].as_bool().unwrap_or(false),
        "channel creation not accepted: {}",
        body
    );

    channel_uuid.to_string()
}

// ── workflow filter helper ─────────────────────────────────────────────────

fn workflow_filter(channel: &str) -> Filter {
    Filter::new()
        .kind(Kind::Custom(KIND_WORKFLOW_DEF))
        .custom_tags(
            SingleLetterTag::lowercase(Alphabet::H),
            [channel],
        )
}

// ── test ───────────────────────────────────────────────────────────────────

/// Publish a workflow, delete it, and confirm it is gone for all clients.
///
/// Covers:
/// - The relay honours the NIP-09 kind:5 deletion (both `e` and `a` tags).
/// - A fresh REQ after deletion returns no events for the deleted workflow.
/// - A brand-new connection (simulating a page refresh / reconnect) also sees
///   no events for the deleted workflow.
#[tokio::test]
#[ignore]
async fn test_deleted_workflow_hidden_for_all_clients() {
    let url = relay_url();

    // ── 1. Set up author and channel ──────────────────────────────────────
    let author_keys = Keys::generate();
    seed_relay_owner(&author_keys).await;

    let channel = create_test_channel(&author_keys).await;

    // ── 2. Author publishes a kind:30620 workflow ─────────────────────────
    let workflow_id = Uuid::new_v4().to_string();
    let yaml = format!(
        "name: Deletion test workflow {}\ntrigger:\n  on: message_posted\nsteps:\n  - id: noop\n    action: send_message\n    text: hi\n",
        workflow_id
    );

    let mut author = BuzzTestClient::connect(&url, &author_keys)
        .await
        .expect("author connect");

    let workflow_event = EventBuilder::new(Kind::Custom(KIND_WORKFLOW_DEF), &yaml)
        .tags(vec![
            Tag::parse(["h", &channel]).unwrap(),
            Tag::parse(["d", &workflow_id]).unwrap(),
            Tag::parse(["name", "Deletion test workflow"]).unwrap(),
        ])
        .sign_with_keys(&author_keys)
        .expect("sign workflow event");

    let workflow_event_id = workflow_event.id.to_hex();
    let ok = author.send_event(workflow_event).await.expect("publish workflow");
    assert!(ok.accepted, "relay rejected workflow event: {}", ok.message);

    // ── 3. Second client confirms the workflow is visible ─────────────────
    let observer_keys = Keys::generate();
    seed_relay_member("localhost:3000", &observer_keys, "member").await;

    let mut observer = BuzzTestClient::connect(&url, &observer_keys)
        .await
        .expect("observer connect");

    let sid_before = sub_id("before-delete");
    observer
        .subscribe(&sid_before, vec![workflow_filter(&channel)])
        .await
        .expect("observer subscribe before delete");

    let events_before = observer
        .collect_until_eose(&sid_before, Duration::from_secs(10))
        .await
        .expect("observer EOSE before delete");

    assert!(
        events_before.iter().any(|ev| ev.tags.iter().any(|t| {
            let s = t.as_slice();
            s.len() >= 2 && s[0] == "d" && s[1] == workflow_id
        })),
        "workflow should appear before deletion; got {} events",
        events_before.len()
    );

    observer
        .close_subscription(&sid_before)
        .await
        .expect("close subscription before delete");

    // ── 4. Author sends a NIP-09 kind:5 deletion event ───────────────────
    // The deletion references both the event id (e tag) and the NIP-33
    // replaceable coordinate (a tag) so the relay can mark both the raw event
    // and the replaceable slot as deleted.
    let coordinate = format!(
        "{}:{}:{}",
        KIND_WORKFLOW_DEF,
        author_keys.public_key().to_hex(),
        workflow_id
    );

    let deletion_event = EventBuilder::new(Kind::Custom(KIND_DELETION), "deleted")
        .tags(vec![
            Tag::parse(["e", &workflow_event_id]).unwrap(),
            Tag::parse(["a", &coordinate]).unwrap(),
            Tag::parse(["h", &channel]).unwrap(),
        ])
        .sign_with_keys(&author_keys)
        .expect("sign deletion event");

    let del_ok = author
        .send_event(deletion_event)
        .await
        .expect("publish deletion event");
    assert!(
        del_ok.accepted,
        "relay rejected deletion event: {}",
        del_ok.message
    );

    // Give the relay a moment to apply the deletion side-effects.
    tokio::time::sleep(Duration::from_millis(500)).await;

    // ── 5. Observer re-queries: workflow must not appear ──────────────────
    let sid_after = sub_id("after-delete");
    observer
        .subscribe(&sid_after, vec![workflow_filter(&channel)])
        .await
        .expect("observer subscribe after delete");

    let events_after = observer
        .collect_until_eose(&sid_after, Duration::from_secs(10))
        .await
        .expect("observer EOSE after delete");

    assert!(
        !events_after.iter().any(|ev| ev.tags.iter().any(|t| {
            let s = t.as_slice();
            s.len() >= 2 && s[0] == "d" && s[1] == workflow_id
        })),
        "deleted workflow must not appear for existing observer after deletion; got {} events: {:?}",
        events_after.len(),
        events_after
            .iter()
            .map(|e| e.id.to_hex())
            .collect::<Vec<_>>()
    );

    observer.disconnect().await.expect("disconnect observer");

    // ── 6. Fresh connection (page-refresh / reconnect scenario) ───────────
    // Simulates a second user or a page reload: brand-new WebSocket session.
    let fresh_keys = Keys::generate();
    seed_relay_member("localhost:3000", &fresh_keys, "member").await;

    let mut fresh_client = BuzzTestClient::connect(&url, &fresh_keys)
        .await
        .expect("fresh client connect");

    let sid_fresh = sub_id("fresh-connection");
    fresh_client
        .subscribe(&sid_fresh, vec![workflow_filter(&channel)])
        .await
        .expect("fresh client subscribe");

    let events_fresh = fresh_client
        .collect_until_eose(&sid_fresh, Duration::from_secs(10))
        .await
        .expect("fresh client EOSE");

    assert!(
        !events_fresh.iter().any(|ev| ev.tags.iter().any(|t| {
            let s = t.as_slice();
            s.len() >= 2 && s[0] == "d" && s[1] == workflow_id
        })),
        "deleted workflow must not appear on a fresh connection after deletion; got {} events: {:?}",
        events_fresh.len(),
        events_fresh
            .iter()
            .map(|e| e.id.to_hex())
            .collect::<Vec<_>>()
    );

    fresh_client.disconnect().await.expect("disconnect fresh");
    author.disconnect().await.expect("disconnect author");
}

/// A fresh REQ for all workflows in a channel that had one deleted shows
/// that the deleted workflow's event id is absent from results.
///
/// This is a tighter variant of the main test that checks the relay correctly
/// filters on event id (via the `e` tag deletion) even when an `a`-tag-only
/// path would otherwise return the event.
#[tokio::test]
#[ignore]
async fn test_deleted_workflow_absent_by_event_id() {
    let url = relay_url();

    let author_keys = Keys::generate();
    seed_relay_owner(&author_keys).await;

    let channel = create_test_channel(&author_keys).await;

    // Publish two workflows so we can confirm only the deleted one disappears.
    let workflow_id_del = Uuid::new_v4().to_string();
    let workflow_id_keep = Uuid::new_v4().to_string();

    let mut author = BuzzTestClient::connect(&url, &author_keys)
        .await
        .expect("author connect");

    for (wf_id, name) in [
        (workflow_id_del.as_str(), "To be deleted"),
        (workflow_id_keep.as_str(), "Should survive"),
    ] {
        let yaml = format!("name: {name}\ntrigger:\n  on: message_posted\nsteps:\n  - id: noop\n    action: send_message\n    text: ok\n");
        let ev = EventBuilder::new(Kind::Custom(KIND_WORKFLOW_DEF), &yaml)
            .tags(vec![
                Tag::parse(["h", &channel]).unwrap(),
                Tag::parse(["d", wf_id]).unwrap(),
                Tag::parse(["name", name]).unwrap(),
            ])
            .sign_with_keys(&author_keys)
            .expect("sign workflow");
        let ok = author.send_event(ev).await.expect("publish workflow");
        assert!(ok.accepted, "relay rejected workflow '{name}': {}", ok.message);
    }

    // Subscribe and capture the to-be-deleted workflow's event id.
    let observer_keys = Keys::generate();
    seed_relay_member("localhost:3000", &observer_keys, "member").await;
    let mut observer = BuzzTestClient::connect(&url, &observer_keys)
        .await
        .expect("observer connect");

    let sid_snap = sub_id("two-wf-snap");
    observer
        .subscribe(&sid_snap, vec![workflow_filter(&channel)])
        .await
        .expect("subscribe snapshot");

    let snapshot = observer
        .collect_until_eose(&sid_snap, Duration::from_secs(10))
        .await
        .expect("EOSE snapshot");

    assert_eq!(
        snapshot.len(),
        2,
        "expected 2 workflows before deletion, got {}",
        snapshot.len()
    );

    let del_event_id = snapshot
        .iter()
        .find(|ev| {
            ev.tags.iter().any(|t| {
                let s = t.as_slice();
                s.len() >= 2 && s[0] == "d" && s[1] == workflow_id_del
            })
        })
        .map(|ev| ev.id.to_hex())
        .expect("deleted workflow not found in snapshot");

    observer
        .close_subscription(&sid_snap)
        .await
        .expect("close snapshot sub");

    // Delete the first workflow.
    let coordinate = format!(
        "{}:{}:{}",
        KIND_WORKFLOW_DEF,
        author_keys.public_key().to_hex(),
        workflow_id_del
    );
    let deletion_event = EventBuilder::new(Kind::Custom(KIND_DELETION), "deleted")
        .tags(vec![
            Tag::parse(["e", &del_event_id]).unwrap(),
            Tag::parse(["a", &coordinate]).unwrap(),
            Tag::parse(["h", &channel]).unwrap(),
        ])
        .sign_with_keys(&author_keys)
        .expect("sign deletion");

    let del_ok = author.send_event(deletion_event).await.expect("publish deletion");
    assert!(del_ok.accepted, "relay rejected deletion: {}", del_ok.message);

    tokio::time::sleep(Duration::from_millis(500)).await;

    // Re-query: only the surviving workflow should appear.
    let sid_after = sub_id("post-delete");
    observer
        .subscribe(&sid_after, vec![workflow_filter(&channel)])
        .await
        .expect("subscribe after delete");

    let remaining = observer
        .collect_until_eose(&sid_after, Duration::from_secs(10))
        .await
        .expect("EOSE after delete");

    assert_eq!(
        remaining.len(),
        1,
        "expected exactly 1 workflow after deletion, got {}: {:?}",
        remaining.len(),
        remaining.iter().map(|e| e.id.to_hex()).collect::<Vec<_>>()
    );

    let survivor_d_tag = remaining[0]
        .tags
        .iter()
        .find(|t| {
            let s = t.as_slice();
            s.len() >= 2 && s[0] == "d"
        })
        .map(|t| t.as_slice()[1].clone());

    assert_eq!(
        survivor_d_tag.as_deref(),
        Some(workflow_id_keep.as_str()),
        "the surviving workflow should be the one we did not delete"
    );

    assert!(
        !remaining
            .iter()
            .any(|ev| ev.id.to_hex() == del_event_id),
        "the deleted workflow event id must not appear after deletion"
    );

    observer.disconnect().await.expect("disconnect observer");
    author.disconnect().await.expect("disconnect author");
}
