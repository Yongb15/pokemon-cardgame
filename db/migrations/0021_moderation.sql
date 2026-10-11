-- M8 reports and moderation (docs/auction/moderation.md, Security AD-1..AD-4). admins: owner SQL only, api_rw
-- reads. Reports: no DELETE (they go with the reporter's account); notes are cleared after resolution + 90 days.
-- admin_actions: append-only.
CREATE TABLE "account"."admin_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid,
	"auction_id" uuid NOT NULL,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "admin_actions_action_check" CHECK (action in ('dismiss', 'remove')),
	CONSTRAINT "admin_actions_reason_check" CHECK (char_length(reason) between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "account"."admins" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account"."auction_reports" (
	"user_id" uuid NOT NULL,
	"auction_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "auction_reports_user_id_auction_id_pk" PRIMARY KEY("user_id","auction_id"),
	CONSTRAINT "auction_reports_reason_check" CHECK (reason in ('price_manipulation', 'rmt', 'wrong_item', 'other')),
	CONSTRAINT "auction_reports_status_check" CHECK (status in ('open', 'dismissed', 'actioned') and (status = 'open') = (resolved_at is null)),
	CONSTRAINT "auction_reports_note_check" CHECK (note is null or char_length(note) between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "account"."notifications" DROP CONSTRAINT "notifications_kind_check";--> statement-breakpoint
ALTER TABLE "account"."admin_actions" ADD CONSTRAINT "admin_actions_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "account"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account"."admin_actions" ADD CONSTRAINT "admin_actions_auction_id_auctions_id_fk" FOREIGN KEY ("auction_id") REFERENCES "account"."auctions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account"."admins" ADD CONSTRAINT "admins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "account"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account"."auction_reports" ADD CONSTRAINT "auction_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "account"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account"."auction_reports" ADD CONSTRAINT "auction_reports_auction_id_auctions_id_fk" FOREIGN KEY ("auction_id") REFERENCES "account"."auctions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_actions_auction_idx" ON "account"."admin_actions" USING btree ("auction_id","created_at");--> statement-breakpoint
CREATE INDEX "auction_reports_open_idx" ON "account"."auction_reports" USING btree ("auction_id") WHERE status = 'open';--> statement-breakpoint
ALTER TABLE "account"."notifications" ADD CONSTRAINT "notifications_kind_check" CHECK (kind in ('outbid', 'won', 'sold', 'unsold', 'price', 'watch_bid', 'watch_ending', 'removed'));--> statement-breakpoint
GRANT SELECT ON account.admins TO api_rw;--> statement-breakpoint
GRANT SELECT ON account.auction_reports TO api_rw;--> statement-breakpoint
GRANT INSERT (user_id, auction_id, reason, note) ON account.auction_reports TO api_rw;--> statement-breakpoint
GRANT UPDATE (status, resolved_at, note) ON account.auction_reports TO api_rw;--> statement-breakpoint
GRANT SELECT ON account.admin_actions TO api_rw;--> statement-breakpoint
GRANT INSERT (admin_id, auction_id, action, reason) ON account.admin_actions TO api_rw;