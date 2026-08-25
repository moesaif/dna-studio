-- Adds user settings (LLM/image provider preferences and API keys) and cached
-- campaign suggestions.
--
-- Naming: this directory is `20260317b_...`, not `20260317_add_...`, so that it
-- sorts *after* `20260317_init` — the migration that creates the tables it
-- alters. Prisma applies migrations in lexicographic order of the directory
-- name, and "add_settings_suggestions" < "init", so the original name ran this
-- ALTER against tables that did not exist yet. See issue #8.
--
-- A full timestamp prefix such as `20260317120000_` does NOT fix this: digits
-- sort before `_` (0x31 < 0x5F), so it would still land ahead of `20260317_init`.
--
-- IF NOT EXISTS keeps this a no-op on databases that already applied it under
-- the previous directory name.

-- Add user settings (JSON for LLM/image provider preferences, API keys)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "settings" JSONB;

-- Add cached campaign suggestions to Brand
ALTER TABLE "Brand" ADD COLUMN IF NOT EXISTS "suggestions" JSONB;
