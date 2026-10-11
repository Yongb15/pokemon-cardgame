-- 7d auction notifications (docs/auction/design.md §7d). api_rw writes rows inside the bid and settlement
-- transactions and marks them read; it can't delete them (they go with the account, ON DELETE cascade).
CREATE TABLE "account"."notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"auction_id" uuid NOT NULL,
	"card_id" text NOT NULL,
	"amount" bigint,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "notifications_kind_check" CHECK (kind in ('outbid', 'won', 'sold', 'unsold')),
	CONSTRAINT "notifications_amount_check" CHECK (amount is null or amount between 1 and 100000000),
	CONSTRAINT "notifications_card_check" CHECK (card_id ~ '^[A-Za-z0-9_.!?-]{1,40}$')
);
--> statement-breakpoint
ALTER TABLE "account"."notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "account"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account"."notifications" ADD CONSTRAINT "notifications_auction_id_auctions_id_fk" FOREIGN KEY ("auction_id") REFERENCES "account"."auctions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_once_idx" ON "account"."notifications" USING btree ("user_id","auction_id","kind");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "account"."notifications" USING btree ("user_id","created_at");--> statement-breakpoint
GRANT SELECT ON account.notifications TO api_rw;--> statement-breakpoint
GRANT INSERT (user_id, kind, auction_id, card_id, amount) ON account.notifications TO api_rw;--> statement-breakpoint
GRANT UPDATE (amount, created_at, read_at) ON account.notifications TO api_rw;