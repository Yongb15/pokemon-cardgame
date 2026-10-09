-- The daily all-card price collector (GitHub Actions, docs/price/collect-all.md D-1) has its own
-- role, so a leak on that side is revoked without touching the site's app_rw. The role is made
-- with scripts/db-create-role.mjs before this runs (like api_rw). Only the price tables it writes:
-- no views or budget counters, no account schema, and no DELETE (old-history compaction runs as the
-- owner: a leaked collector can't erase history).
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM collector_rw;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO collector_rw;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON price_snapshot TO collector_rw;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON price_refresh TO collector_rw;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON fx_rate TO collector_rw;--> statement-breakpoint
GRANT SELECT ON card_edition_link TO collector_rw;
