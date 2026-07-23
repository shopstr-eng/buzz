-- Per-code claim registry for single-use invite links.
--
-- Each row records that a specific invite code (identified by the SHA-256 of
-- the raw code string, so the secret itself is never stored at rest) has been
-- redeemed by a particular pubkey. The PRIMARY KEY on (community_id, code_hash)
-- gives the INSERT … ON CONFLICT DO NOTHING check its atomicity guarantee:
-- two concurrent claim attempts for the same code can only insert one row, so
-- the second presenter is always rejected.
--
-- Only single-use codes write rows here. Multi-use codes (the default) skip
-- this table entirely.
CREATE TABLE relay_invites (
    community_id   UUID        NOT NULL,
    -- Lowercase hex SHA-256 of the raw invite code string.
    code_hash      TEXT        NOT NULL CHECK (length(code_hash) = 64),
    -- 64-char hex pubkey of the first pubkey that successfully redeemed this code.
    claimer_pubkey TEXT        NOT NULL,
    claimed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, code_hash)
);
