-- Migration 0026: add optional model column to channels.
-- Stores the desired LLM model ID for workflow/agent channels (e.g. "claude-sonnet-4").
-- NULL means "use the ACP default" — no behaviour change for existing channels.
ALTER TABLE channels ADD COLUMN IF NOT EXISTS model TEXT;
