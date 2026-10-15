-- Admin point grant notifications (docs/auction/admin-points.md §7, Security N-1/N-2): a 'grant' row has no
-- auction and no card, only the amount. No privilege change: api_rw already inserts these columns.
ALTER TABLE "account"."notifications" DROP CONSTRAINT "notifications_kind_check";--> statement-breakpoint
ALTER TABLE "account"."notifications" DROP CONSTRAINT "notifications_auction_check";--> statement-breakpoint
ALTER TABLE "account"."notifications" ALTER COLUMN "card_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "account"."notifications" ADD CONSTRAINT "notifications_grant_check" CHECK ((kind = 'grant') = (card_id is null) and (kind <> 'grant' or amount is not null));--> statement-breakpoint
ALTER TABLE "account"."notifications" ADD CONSTRAINT "notifications_kind_check" CHECK (kind in ('outbid', 'won', 'sold', 'unsold', 'price', 'watch_bid', 'watch_ending', 'removed', 'grant'));--> statement-breakpoint
ALTER TABLE "account"."notifications" ADD CONSTRAINT "notifications_auction_check" CHECK ((kind in ('price', 'grant')) = (auction_id is null));