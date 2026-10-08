-- Least-privilege grants for the app role `app_rw` (Security review, docs/price/design.md).
-- The role itself is made by scripts/db-create-app-role.mjs (with SQL, so it doesn't join
-- neon_superuser). Every new table must add its own GRANT in its migration: no default privileges.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM app_rw;--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM PUBLIC;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app_rw;--> statement-breakpoint
-- Price levels: add rows, mark the day a level was seen again, weekly compaction of old history
GRANT SELECT, INSERT, UPDATE, DELETE ON price_snapshot TO app_rw;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON price_refresh TO app_rw;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON fx_rate TO app_rw;--> statement-breakpoint
-- Written by the owner from the qa-checked mapping
GRANT SELECT ON card_edition_link TO app_rw;--> statement-breakpoint
-- 30-day cleanup
GRANT SELECT, INSERT, UPDATE, DELETE ON card_view_daily TO app_rw;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON daily_counter TO app_rw;
