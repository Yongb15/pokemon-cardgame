-- Least-privilege grants for the API server's role `api_rw` (docs/auth/design.md, Security review).
-- The role itself is made with SQL by scripts/db-create-role.mjs before this migration runs.
-- Nobody but the owner and api_rw may enter the account schema (app_rw included).
REVOKE ALL ON SCHEMA account FROM PUBLIC;--> statement-breakpoint
GRANT USAGE ON SCHEMA account TO api_rw;--> statement-breakpoint
-- Users: created at first sign-in, nickname changed later, deleted on account removal
GRANT SELECT, INSERT, DELETE ON account.users TO api_rw;--> statement-breakpoint
GRANT UPDATE (nickname) ON account.users TO api_rw;--> statement-breakpoint
-- Sign-in methods are only ever added (removal goes through the user's cascade)
GRANT SELECT, INSERT ON account.oauth_accounts TO api_rw;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON account.sessions TO api_rw;--> statement-breakpoint
GRANT UPDATE (expires_at, last_seen_at) ON account.sessions TO api_rw;--> statement-breakpoint
-- api_rw reads nothing in public; on the dev branch only, the dev_marker table, so the preview-only
-- test login can refuse to start against production (Security, test login condition 1)
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM api_rw;--> statement-breakpoint
DO $$ BEGIN
  IF to_regclass('public.dev_marker') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT ON public.dev_marker TO api_rw';
  END IF;
END $$;
