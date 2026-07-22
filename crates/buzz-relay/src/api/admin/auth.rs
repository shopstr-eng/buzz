use axum::http::{header, HeaderMap};
use base64::Engine as _;

use super::error::ApiError;
use crate::state::AppState;

pub(crate) fn is_admin_host(state: &AppState, headers: &HeaderMap) -> bool {
    let Some(config) = state.config.admin.as_ref() else {
        return false;
    };
    headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|host| host == config.host)
}

pub fn authorize(state: &AppState, headers: &HeaderMap) -> Result<(), ApiError> {
    // Host-based admin mode: Host header must match BUZZ_ADMIN_HOST.
    if let Some(config) = state.config.admin.as_ref() {
        if !is_admin_host(state, headers) {
            return Err(ApiError::forbidden());
        }
        if headers.get(header::ORIGIN).is_some_and(|origin| {
            origin
                .to_str()
                .map_or(true, |origin| !origin_matches_host(origin, &config.host))
        }) {
            return Err(ApiError::forbidden());
        }
        return Ok(());
    }

    // Path-based admin mode: admin SPA is served at /admin/ on the main domain.
    // Requires a NIP-98 (kind:27235) Authorization header signed by the relay
    // owner's private key. The browser extension (window.nostr) signs the request;
    // we verify the Schnorr signature and confirm pubkey == RELAY_OWNER_PUBKEY.
    // This is cryptographic identity proof — only the holder of the relay owner's
    // private key can produce a valid signature.
    if state.config.admin_path_web_dir.is_some() {
        let owner_pubkey = match state.config.relay_owner_pubkey.as_deref() {
            Some(pk) => pk,
            None => {
                tracing::warn!(
                    "path-based admin: RELAY_OWNER_PUBKEY not set — admin API disabled"
                );
                return Err(ApiError::not_found());
            }
        };

        // Extract `Authorization: Nostr <base64>` header.
        let token = headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.strip_prefix("Nostr "))
            .ok_or_else(ApiError::forbidden)?;

        verify_nip98_owner(token, owner_pubkey).map_err(|_| ApiError::forbidden())?;
        return Ok(());
    }

    Err(ApiError::not_found())
}

/// Verify a NIP-98 kind:27235 event token and confirm the pubkey matches `owner_pubkey`.
///
/// This checks:
/// - Base64 decodes to valid event JSON
/// - `kind == 27235`
/// - Valid Schnorr signature (cryptographic identity proof)
/// - `created_at` within ±60 seconds of now (replay window)
/// - `pubkey` equals `owner_pubkey`
///
/// URL/method tags are not re-checked here because `authorize()` does not have
/// access to the request URL. Signature verification already proves the caller
/// signed *some* recent kind:27235 event with the owner key.
fn verify_nip98_owner(base64_token: &str, owner_pubkey: &str) -> Result<(), ()> {
    // Decode base64 → event JSON.
    let bytes = base64::prelude::BASE64_STANDARD
        .decode(base64_token)
        .map_err(|_| ())?;
    let event_json = String::from_utf8(bytes).map_err(|_| ())?;

    // Parse as a Nostr event.
    let event: nostr::Event = serde_json::from_str(&event_json).map_err(|_| ())?;

    // Must be kind 27235 (NIP-98 HTTP Auth).
    if event.kind != nostr::Kind::HttpAuth {
        return Err(());
    }

    // Verify Schnorr signature (also verifies event ID hash).
    buzz_core::verify_event(&event).map_err(|_| ())?;

    // Check created_at within ±60 seconds of now.
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    if now.abs_diff(event.created_at.as_secs()) > 60 {
        return Err(());
    }

    // Confirm the signing pubkey is the relay owner.
    if event.pubkey.to_hex() != owner_pubkey {
        return Err(());
    }

    Ok(())
}

fn origin_matches_host(origin: &str, host: &str) -> bool {
    origin
        .strip_prefix("https://")
        .or_else(|| origin.strip_prefix("http://"))
        == Some(host)
}

#[cfg(test)]
mod tests {
    use super::origin_matches_host;

    #[test]
    fn browser_origin_must_match_admin_host() {
        assert!(origin_matches_host(
            "https://admin.example.com",
            "admin.example.com"
        ));
        assert!(origin_matches_host(
            "http://admin.localhost:3000",
            "admin.localhost:3000"
        ));
        assert!(!origin_matches_host(
            "https://attacker.example",
            "admin.example.com"
        ));
        assert!(!origin_matches_host("null", "admin.example.com"));
    }
}
