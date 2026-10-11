-- M8 auction watch (docs/auction/design.md §12, Security W-1..W-5). Unwatch deletes the user's own row;
-- no UPDATE. Watch notifications are computed on read, so the bid path is unchanged.
CREATE TABLE "account"."auction_watches" (
	"user_id" uuid NOT NULL,
	"auction_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "auction_watches_user_id_auction_id_pk" PRIMARY KEY("user_id","auction_id")
);
--> statement-breakpoint
ALTER TABLE "account"."notifications" DROP CONSTRAINT "notifications_kind_check";--> statement-breakpoint
ALTER TABLE "account"."auction_watches" ADD CONSTRAINT "auction_watches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "account"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account"."auction_watches" ADD CONSTRAINT "auction_watches_auction_id_auctions_id_fk" FOREIGN KEY ("auction_id") REFERENCES "account"."auctions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auction_watches_auction_idx" ON "account"."auction_watches" USING btree ("auction_id");--> statement-breakpoint
ALTER TABLE "account"."notifications" ADD CONSTRAINT "notifications_kind_check" CHECK (kind in ('outbid', 'won', 'sold', 'unsold', 'price', 'watch_bid', 'watch_ending'));--> statement-breakpoint
GRANT SELECT, DELETE ON account.auction_watches TO api_rw;--> statement-breakpoint
GRANT INSERT (user_id, auction_id) ON account.auction_watches TO api_rw;