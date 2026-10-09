-- INSERT only into the columns the API fills; the rest take their defaults (Security I3-1): a
-- compromised API can't backdate created_at to stretch the 90-day session cap, for example
REVOKE INSERT ON account.users, account.oauth_accounts, account.sessions FROM api_rw;--> statement-breakpoint
GRANT INSERT (nickname) ON account.users TO api_rw;--> statement-breakpoint
GRANT INSERT (provider, subject, user_id) ON account.oauth_accounts TO api_rw;--> statement-breakpoint
GRANT INSERT (token_hash, user_id, expires_at) ON account.sessions TO api_rw;
