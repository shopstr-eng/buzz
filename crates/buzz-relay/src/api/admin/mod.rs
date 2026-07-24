//! Private, read-only deployment moderation API.

mod auth;
mod error;

use std::sync::Arc;

use auth::authorize;
use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    middleware::{self, Next},
    response::Response,
    routing::{delete, get, patch, post},
    Json, Router,
};
use nostr::{EventBuilder, Keys, Kind};
use chrono::{DateTime, Utc};
use error::ApiError;
use serde::{Deserialize, Serialize};
use tower_http::limit::RequestBodyLimitLayer;
use uuid::Uuid;

pub(crate) fn is_admin_host(state: &crate::state::AppState, headers: &HeaderMap) -> bool {
    auth::is_admin_host(state, headers)
}

/// Build the deployment-admin routes.
pub fn router(state: Arc<crate::state::AppState>) -> Router {
    Router::new()
        .route("/reports", get(reports))
        .route("/reports/{id}", get(report_detail))
        .route("/feedback", get(feedback))
        .route("/feedback/{id}", get(feedback_detail))
        .route(
            "/feedback/{id}/attachments/{sha256}",
            get(feedback_attachment),
        )
        // Invite management: admin-host-gated invite minting (no NIP-98 required).
        .route("/invites", post(mint_invite_admin))
        // Member management: list, update role, and remove relay members.
        .route("/members", get(list_members))
        .route("/members/{pubkey}", patch(update_member).delete(remove_member))
        // Agent profile: sign kind:0 + kind:10100 with the ACP private key.
        .route("/agents/sign-profile", post(sign_agent_profile))
        .layer(middleware::from_fn(security_headers))
        .layer(RequestBodyLimitLayer::new(4096))
        .with_state(state)
}

async fn security_headers(request: axum::extract::Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    headers.insert("x-frame-options", HeaderValue::from_static("DENY"));
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("default-src 'none'; frame-ancestors 'none'"),
    );
    response
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReportQuery {
    community_id: Option<Uuid>,
    status: Option<String>,
    report_type: Option<String>,
    target_kind: Option<String>,
    before: Option<DateTime<Utc>>,
    after: Option<DateTime<Utc>>,
    limit: Option<i64>,
}

fn limit(value: Option<i64>) -> Result<i64, ApiError> {
    match value.unwrap_or(50) {
        value @ 1..=200 => Ok(value),
        _ => Err(ApiError::bad_request(
            "invalid_limit",
            "limit must be between 1 and 200",
        )),
    }
}

fn validate(value: Option<&str>, allowed: &[&str], code: &'static str) -> Result<(), ApiError> {
    if value.is_some_and(|value| !allowed.contains(&value)) {
        Err(ApiError::bad_request(code, "filter is invalid"))
    } else {
        Ok(())
    }
}

async fn reports(
    State(state): State<Arc<crate::state::AppState>>,
    headers: HeaderMap,
    Query(query): Query<ReportQuery>,
) -> Result<Json<Vec<buzz_db::admin_moderation::AdminReport>>, ApiError> {
    authorize(&state, &headers)?;
    validate(
        query.status.as_deref(),
        &["open", "resolved", "dismissed", "escalated"],
        "invalid_status",
    )?;
    validate(
        query.target_kind.as_deref(),
        &["event", "pubkey", "blob"],
        "invalid_target_kind",
    )?;
    let items = state
        .db
        .admin_list_reports(
            query.community_id,
            query.status.as_deref(),
            query.report_type.as_deref(),
            query.target_kind.as_deref(),
            query.after,
            query.before,
            None,
            limit(query.limit)?,
        )
        .await?;
    Ok(Json(items))
}

async fn report_detail(
    State(state): State<Arc<crate::state::AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<buzz_db::admin_moderation::AdminReport>, ApiError> {
    authorize(&state, &headers)?;
    state
        .db
        .admin_get_report(id)
        .await?
        .map(Json)
        .ok_or_else(ApiError::not_found)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FeedbackSummary {
    id: Uuid,
    community_id: Uuid,
    community_host: String,
    submitter_pubkey: String,
    category: Option<String>,
    body_summary: String,
    received_at: DateTime<Utc>,
}

async fn feedback(
    State(state): State<Arc<crate::state::AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<FeedbackSummary>>, ApiError> {
    authorize(&state, &headers)?;
    let items = state
        .db
        .admin_list_feedback(100)
        .await?
        .into_iter()
        .map(|item| {
            let body_summary = summarize_body(&item.body, &item.tags);
            FeedbackSummary {
                id: item.id,
                community_id: item.community_id,
                community_host: item.community_host,
                submitter_pubkey: item.submitter_pubkey,
                category: item.category,
                body_summary,
                received_at: item.received_at,
            }
        })
        .collect();
    Ok(Json(items))
}

async fn feedback_detail(
    State(state): State<Arc<crate::state::AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<buzz_db::admin_moderation::AdminFeedback>, ApiError> {
    authorize(&state, &headers)?;
    state
        .db
        .admin_get_feedback(id)
        .await?
        .map(Json)
        .ok_or_else(ApiError::not_found)
}

async fn feedback_attachment(
    State(state): State<Arc<crate::state::AppState>>,
    headers: HeaderMap,
    Path((id, sha256)): Path<(Uuid, String)>,
) -> Result<Response, ApiError> {
    authorize(&state, &headers)?;
    if !is_sha256(&sha256) {
        return Err(ApiError::not_found());
    }

    let feedback = state
        .db
        .admin_get_feedback(id)
        .await?
        .ok_or_else(ApiError::not_found)?;
    if !feedback_references_hash(&feedback.tags, &feedback.community_host, &sha256) {
        return Err(ApiError::not_found());
    }

    // Resolve the tenant from server-owned feedback provenance, then assert the
    // resolved row still agrees with the feedback FK. Client input never names
    // a community, host, object key, extension, or upstream URL.
    let tenant = crate::tenant::bind_community(&state.db, &feedback.community_host)
        .await
        .map_err(|_| ApiError::not_found())?;
    if tenant.community().as_uuid() != &feedback.community_id {
        tracing::warn!(
            feedback_id = %feedback.id,
            feedback_community_id = %feedback.community_id,
            resolved_community_id = %tenant.community(),
            "admin feedback attachment tenant provenance mismatch"
        );
        return Err(ApiError::not_found());
    }

    let response = crate::api::media::serve_blob_for_tenant(&state, &tenant, &sha256, &headers)
        .await
        .map_err(|error| match error {
            buzz_media::MediaError::NotFound => ApiError::not_found(),
            _ => ApiError::internal(),
        })?;
    tracing::info!(
        feedback_id = %feedback.id,
        community_id = %feedback.community_id,
        attachment_sha256 = %sha256,
        "admin feedback attachment read"
    );
    Ok(response)
}

fn feedback_references_hash(tags: &serde_json::Value, community_host: &str, sha256: &str) -> bool {
    tags.as_array()
        .into_iter()
        .flatten()
        .filter_map(|tag| tag.as_array())
        .filter(|tag| tag.first().and_then(|value| value.as_str()) == Some("imeta"))
        .any(|tag| {
            let fields = tag
                .iter()
                .skip(1)
                .filter_map(|value| value.as_str()?.split_once(' '))
                .collect::<std::collections::HashMap<_, _>>();
            fields.get("x") == Some(&sha256)
                && fields
                    .get("url")
                    .is_some_and(|url| attachment_url_matches(url, community_host, sha256))
        })
}

fn attachment_url_matches(url: &str, community_host: &str, sha256: &str) -> bool {
    let parsed = if url.starts_with('/') {
        url::Url::parse(&format!("https://{community_host}{url}"))
    } else {
        url::Url::parse(url)
    };
    let Ok(url) = parsed else {
        return false;
    };
    let authority = url.port().map_or_else(
        || url.host_str().unwrap_or_default().to_string(),
        |port| format!("{}:{port}", url.host_str().unwrap_or_default()),
    );
    let Some(media_name) = url.path().strip_prefix("/media/") else {
        return false;
    };
    let Some((url_hash, extension)) = media_name.split_once('.') else {
        return false;
    };
    matches!(url.scheme(), "http" | "https")
        && buzz_core::tenant::normalize_host(&authority)
            == buzz_core::tenant::normalize_host(community_host)
        && url_hash == sha256
        && crate::api::media::is_safe_ext(extension)
        && url.query().is_none()
        && url.fragment().is_none()
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .chars()
            .all(|character| matches!(character, '0'..='9' | 'a'..='f'))
}

fn summarize_body(body: &str, tags: &serde_json::Value) -> String {
    const MAX_CHARS: usize = 240;
    let attachment_urls = tags
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|tag| tag.as_array())
        .filter(|tag| tag.first().and_then(|value| value.as_str()) == Some("imeta"))
        .flat_map(|tag| tag.iter().skip(1))
        .filter_map(|value| value.as_str()?.strip_prefix("url "))
        .collect::<std::collections::HashSet<_>>();
    let body = body
        .lines()
        .filter(|line| {
            let line = line.trim();
            let url = line
                .strip_suffix(')')
                .and_then(|line| line.rsplit_once("]("))
                .and_then(|(label, url)| {
                    (label.starts_with('[') || label.starts_with("![")).then_some(url)
                });
            url.is_none_or(|url| !attachment_urls.contains(url))
        })
        .collect::<Vec<_>>()
        .join("\n");
    let mut chars = body.trim().chars();
    let mut summary = chars.by_ref().take(MAX_CHARS).collect::<String>();
    if chars.next().is_some() {
        summary.push('…');
    }
    summary
}

// ---------------------------------------------------------------------------
// Member management — admin-host gated, no NIP-98 required.
// ---------------------------------------------------------------------------

/// A relay member record returned by the admin API.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MemberResponse {
    pubkey: String,
    role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    added_by: Option<String>,
    created_at: DateTime<Utc>,
}

/// `GET /api/admin/v1/members` — list all relay members for this deployment.
async fn list_members(
    State(state): State<Arc<crate::state::AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<MemberResponse>>, ApiError> {
    authorize(&state, &headers)?;

    let tenant = crate::tenant::bind_deployment_community(&state.db, &state.config.relay_url)
        .await
        .map_err(|_| ApiError::service_unavailable("community_not_found", "no community found"))?;

    let members = state
        .db
        .list_relay_members(tenant.community())
        .await?
        .into_iter()
        .map(|m| MemberResponse {
            pubkey: m.pubkey,
            role: m.role,
            added_by: m.added_by,
            created_at: m.created_at,
        })
        .collect();

    Ok(Json(members))
}

/// Request body for `PATCH /api/admin/v1/members/:pubkey`.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UpdateMemberRequest {
    role: String,
}

/// `PATCH /api/admin/v1/members/:pubkey` — change a relay member's role.
///
/// Only `"admin"` and `"member"` are accepted; `"owner"` is a protected role
/// managed via ownership-transfer flows. Returns 204 on success, 400 for an
/// invalid role or pubkey, 404 if the pubkey is not a member, and 409 if the
/// pubkey belongs to the relay owner.
async fn update_member(
    State(state): State<Arc<crate::state::AppState>>,
    headers: HeaderMap,
    Path(pubkey): Path<String>,
    Json(body): Json<UpdateMemberRequest>,
) -> Result<StatusCode, ApiError> {
    authorize(&state, &headers)?;

    if !is_hex_pubkey(&pubkey) {
        return Err(ApiError::bad_request(
            "invalid_pubkey",
            "pubkey must be a 64-char hex string",
        ));
    }

    if !matches!(body.role.as_str(), "admin" | "member") {
        return Err(ApiError::bad_request(
            "invalid_role",
            "role must be \"admin\" or \"member\"",
        ));
    }

    let tenant = crate::tenant::bind_deployment_community(&state.db, &state.config.relay_url)
        .await
        .map_err(|_| ApiError::service_unavailable("community_not_found", "no community found"))?;

    let updated = state
        .db
        .update_relay_member_role(tenant.community(), &pubkey, &body.role)
        .await?;

    if !updated {
        // `update_relay_member_role` excludes the owner row via `role <> 'owner'`.
        // Distinguish not-found from owner so callers get the right error.
        let member = state
            .db
            .get_relay_member(tenant.community(), &pubkey)
            .await?;
        return match member {
            Some(_) => Err(ApiError::conflict(
                "is_owner",
                "the relay owner's role cannot be changed",
            )),
            None => Err(ApiError::not_found()),
        };
    }

    tracing::info!(pubkey = %pubkey, role = %body.role, "relay member role updated via admin panel");

    // Best-effort NIP-43 membership list update; log but don't fail the request.
    if let Err(e) =
        crate::handlers::side_effects::publish_nip43_membership_list(&tenant, &state).await
    {
        tracing::warn!(error = %e, "failed to publish NIP-43 membership list after role update");
    }

    Ok(StatusCode::NO_CONTENT)
}

/// `DELETE /api/admin/v1/members/:pubkey` — remove a relay member.
///
/// Returns 204 on success, 404 if the pubkey is not a member, and 409 if the
/// pubkey belongs to the relay owner (who cannot be removed).
async fn remove_member(
    State(state): State<Arc<crate::state::AppState>>,
    headers: HeaderMap,
    Path(pubkey): Path<String>,
) -> Result<StatusCode, ApiError> {
    authorize(&state, &headers)?;

    if !is_hex_pubkey(&pubkey) {
        return Err(ApiError::bad_request("invalid_pubkey", "pubkey must be a 64-char hex string"));
    }

    let tenant = crate::tenant::bind_deployment_community(&state.db, &state.config.relay_url)
        .await
        .map_err(|_| ApiError::service_unavailable("community_not_found", "no community found"))?;

    let result = state
        .db
        .remove_relay_member(tenant.community(), &pubkey)
        .await?;

    match result {
        buzz_db::relay_members::RemoveResult::Removed => {
            tracing::info!(pubkey = %pubkey, "relay member removed via admin panel");

            // Best-effort NIP-43 events; log but don't fail the request.
            if let Err(e) =
                crate::handlers::side_effects::publish_nip43_member_removed(&tenant, &state, &pubkey).await
            {
                tracing::warn!(error = %e, "failed to publish NIP-43 member-removed event");
            }
            if let Err(e) =
                crate::handlers::side_effects::publish_nip43_membership_list(&tenant, &state).await
            {
                tracing::warn!(error = %e, "failed to publish NIP-43 membership list");
            }

            Ok(StatusCode::NO_CONTENT)
        }
        buzz_db::relay_members::RemoveResult::IsOwner => Err(ApiError::conflict(
            "is_owner",
            "the relay owner cannot be removed",
        )),
        buzz_db::relay_members::RemoveResult::NotFound => Err(ApiError::not_found()),
        buzz_db::relay_members::RemoveResult::RoleMismatch => Err(ApiError::not_found()),
    }
}

fn is_hex_pubkey(value: &str) -> bool {
    value.len() == 64
        && value
            .chars()
            .all(|c| matches!(c, '0'..='9' | 'a'..='f'))
}

// ---------------------------------------------------------------------------
// Invite minting — admin-host gated, no NIP-98 required.
// ---------------------------------------------------------------------------

/// Optional body for `POST /api/admin/v1/invites`.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AdminMintInviteRequest {
    /// Lifetime in seconds. Clamped to the token module's maximum; defaults to
    /// 72 h.
    #[serde(default)]
    ttl_secs: Option<u64>,
    /// When `true`, the minted code can only be redeemed by the first claimer.
    #[serde(default)]
    single_use: bool,
}

/// `POST /api/admin/v1/invites` — mint an invite link from the admin panel.
///
/// Gated by the admin host check (the same guard used by every other admin
/// endpoint), so no NIP-98 keypair is required from the browser. The relay
/// derives the community from `RELAY_URL` — this is intentionally
/// single-community: a deployment that owns one workspace.
async fn mint_invite_admin(
    State(state): State<Arc<crate::state::AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    // Verify the request comes from the admin host.
    authorize(&state, &headers).map_err(|e| {
        (
            e.status,
            Json(serde_json::json!({"error": {"code": e.code, "message": e.message}})),
        )
    })?;

    // Resolve the community from RELAY_URL (single-community deployment).
    let relay_host = crate::tenant::relay_url_authority(&state.config.relay_url);
    let tenant = crate::tenant::bind_deployment_community(&state.db, &state.config.relay_url)
        .await
        .map_err(|_| {
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({
                    "error": {
                        "code": "community_not_found",
                        "message": format!(
                            "no community is seeded for host '{}'; run the setup script first",
                            relay_host
                        )
                    }
                })),
            )
        })?;

    let request: AdminMintInviteRequest = if body.is_empty() {
        AdminMintInviteRequest::default()
    } else {
        serde_json::from_slice(&body).map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": {"code": "bad_request", "message": e.to_string()}})),
            )
        })?
    };

    let key = crate::invite_token::derive_invite_key(&state.relay_keypair);
    let ttl = request
        .ttl_secs
        .unwrap_or(crate::invite_token::DEFAULT_INVITE_TTL_SECS);
    let (code, expires_at) =
        crate::invite_token::mint_invite(&key, tenant.community(), ttl, request.single_use);

    let scheme = if state.config.relay_url.trim_start().starts_with("wss://") {
        "https"
    } else {
        "http"
    };

    tracing::info!(
        community = %tenant.community(),
        expires_at,
        single_use = request.single_use,
        "relay invite minted via admin panel"
    );

    Ok(Json(serde_json::json!({
        "code": code,
        "expires_at": expires_at,
        "url": format!("{scheme}://{}/invite/{}", tenant.host(), code),
    })))
}

// ── Agent profile signing ────────────────────────────────────────────────────

#[derive(Deserialize)]
struct SignAgentProfileRequest {
    name: Option<String>,
    picture: Option<String>,
    about: Option<String>,
}

#[derive(Serialize)]
struct SignAgentProfileResponse {
    pubkey: String,
    kind0: serde_json::Value,
    kind10100: serde_json::Value,
}

/// Sign kind:0 (user metadata) and kind:10100 (agent profile) with the ACP
/// private key so the admin UI can publish them via the relay WebSocket.
///
/// Reads `BUZZ_ACP_PRIVATE_KEY` from the environment, which is exported by
/// the startup script. Returns signed event JSON; the client is responsible
/// for publishing them via `["EVENT", ...]`.
async fn sign_agent_profile(
    State(state): State<Arc<crate::state::AppState>>,
    headers: HeaderMap,
    Json(body): Json<SignAgentProfileRequest>,
) -> Result<Json<SignAgentProfileResponse>, ApiError> {
    authorize(&state, &headers)?;

    let acp_key_hex = std::env::var("BUZZ_ACP_PRIVATE_KEY")
        .map_err(|_| ApiError::bad_request("acp_key_missing", "BUZZ_ACP_PRIVATE_KEY not configured"))?;

    let keys = Keys::parse(&acp_key_hex)
        .map_err(|_| ApiError::bad_request("acp_key_invalid", "ACP private key is not valid"))?;
    let pubkey_hex = keys.public_key().to_hex();

    let name = body.name.as_deref().unwrap_or("Buzz AI");
    let picture = body.picture.as_deref().unwrap_or("");
    let about = body.about.as_deref().unwrap_or("AI agent powered by Buzz relay");

    let kind0 = EventBuilder::new(
        Kind::Metadata,
        serde_json::json!({ "name": name, "picture": picture, "about": about }).to_string(),
    )
    .sign_with_keys(&keys)
    .map_err(|_| ApiError::internal())?;

    let kind10100 = EventBuilder::new(
        Kind::Custom(10100),
        serde_json::json!({
            "channel_add_policy": "owner_only",
            "name": name,
            "about": about,
        })
        .to_string(),
    )
    .sign_with_keys(&keys)
    .map_err(|_| ApiError::internal())?;

    Ok(Json(SignAgentProfileResponse {
        pubkey: pubkey_hex,
        kind0: serde_json::to_value(&kind0).unwrap_or_default(),
        kind10100: serde_json::to_value(&kind10100).unwrap_or_default(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use tower::ServiceExt;

    async fn test_state() -> Arc<crate::state::AppState> {
        let mut config = crate::config::Config::from_env().expect("default config loads");
        config.require_relay_membership = false;
        config.redis_url = "redis://127.0.0.1:1".to_string();
        config.admin = Some(crate::config::AdminConfig {
            host: "admin.example".to_string(),
            web_dir: None,
        });
        let pool = sqlx::PgPool::connect_lazy(&config.database_url).expect("lazy pg pool");
        let db = buzz_db::Db::from_pool(pool.clone());
        let redis_pool = deadpool_redis::Config::from_url(&config.redis_url)
            .create_pool(Some(deadpool_redis::Runtime::Tokio1))
            .expect("redis pool");
        let pubsub = Arc::new(
            buzz_pubsub::PubSubManager::new(&config.redis_url, redis_pool.clone())
                .await
                .expect("pubsub manager"),
        );
        let audit = buzz_audit::AuditService::new(pool.clone());
        let auth = buzz_auth::AuthService::new(config.auth.clone());
        let search = buzz_search::SearchService::new(pool.clone());
        let workflow_engine = Arc::new(buzz_workflow::WorkflowEngine::new(
            db.clone(),
            buzz_workflow::WorkflowConfig::default(),
        ));
        let media_storage = buzz_media::MediaStorage::new(&config.media).expect("media storage");
        let (state, _audit_shutdown) = crate::state::AppState::new(
            config,
            db,
            redis_pool,
            audit,
            pubsub,
            auth,
            search,
            workflow_engine,
            nostr::Keys::generate(),
            media_storage,
        );
        Arc::new(state)
    }

    const HASH: &str = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

    #[tokio::test]
    async fn feedback_attachment_requires_admin_host_before_database_access() {
        let response = router(test_state().await)
            .oneshot(
                Request::builder()
                    .uri(format!("/feedback/{}/attachments/{HASH}", Uuid::nil()))
                    .header(header::HOST, "community.example")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), axum::http::StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn feedback_attachment_rejects_unknown_feedback() {
        let response = router(test_state().await)
            .oneshot(
                Request::builder()
                    .uri(format!("/feedback/{}/attachments/{HASH}", Uuid::nil()))
                    .header(header::HOST, "admin.example")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), axum::http::StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn feedback_attachment_rejects_write_methods() {
        let state = test_state().await;
        for method in ["POST", "PUT", "PATCH", "DELETE"] {
            let response = router(state.clone())
                .oneshot(
                    Request::builder()
                        .method(method)
                        .uri(format!("/feedback/{}/attachments/{HASH}", Uuid::nil()))
                        .header(header::HOST, "admin.example")
                        .body(Body::empty())
                        .expect("request"),
                )
                .await
                .expect("response");
            assert_eq!(
                response.status(),
                axum::http::StatusCode::METHOD_NOT_ALLOWED,
                "{method}"
            );
        }
    }

    #[test]
    fn report_filters_reject_unknown_values() {
        assert!(validate(Some("open"), &["open"], "invalid_status").is_ok());
        assert!(validate(Some("unknown"), &["open"], "invalid_status").is_err());
    }

    #[test]
    fn feedback_summary_is_unicode_safe_and_marks_truncation() {
        let body = "🐝".repeat(241);
        let summary = summarize_body(&body, &serde_json::Value::Null);
        assert_eq!(summary.chars().count(), 241);
        assert!(summary.ends_with('…'));
    }

    #[test]
    fn feedback_summary_omits_imeta_attachment_lines() {
        let url = "http://localhost:3000/media/abc.png";
        let tags = serde_json::json!([["imeta", format!("url {url}"), "m image/png"]]);
        assert_eq!(
            summarize_body(&format!("Useful context.\n![image]({url})"), &tags),
            "Useful context."
        );
    }

    fn attachment_tags(host: &str, x: &str, url_hash: &str) -> serde_json::Value {
        serde_json::json!([[
            "imeta",
            format!("url https://{host}/media/{url_hash}.png"),
            "m image/png",
            format!("x {x}"),
            "size 100"
        ]])
    }

    #[test]
    fn feedback_attachment_requires_matching_imeta_hash_and_source_host() {
        let tags = attachment_tags("community.example", HASH, HASH);
        assert!(feedback_references_hash(&tags, "community.example", HASH));

        let unreferenced = "f".repeat(64);
        assert!(!feedback_references_hash(
            &tags,
            "community.example",
            &unreferenced
        ));
        assert!(!feedback_references_hash(
            &tags,
            "other-community.example",
            HASH
        ));
    }

    #[test]
    fn feedback_attachment_rejects_cross_field_and_path_substitution() {
        let other_hash = "f".repeat(64);
        assert!(!feedback_references_hash(
            &attachment_tags("community.example", HASH, &other_hash),
            "community.example",
            HASH
        ));

        for url in [
            format!("https://community.example/media/{HASH}.png?token=leak"),
            format!("https://community.example/media/{HASH}.thumb.jpg"),
            format!("https://community.example/media/{HASH}.png/extra"),
            format!("https://evil.example/media/{HASH}.png"),
        ] {
            assert!(!attachment_url_matches(&url, "community.example", HASH));
        }
    }

    #[test]
    fn feedback_attachment_accepts_valid_relative_source_url() {
        assert!(attachment_url_matches(
            &format!("/media/{HASH}.png"),
            "community.example",
            HASH
        ));
    }

    #[test]
    fn feedback_attachment_hash_is_exact_lowercase_sha256() {
        assert!(is_sha256(HASH));
        assert!(!is_sha256(&HASH.to_uppercase()));
        assert!(!is_sha256(&HASH[..63]));
        assert!(!is_sha256(&format!("{HASH}.png")));
    }
}
