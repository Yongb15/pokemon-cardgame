-- Database backstops for the auction rules (Security, 0016 review): a listed card points at a real
-- auction, no self-bids, anti-sniping bounded to 10 × 2 minutes, closed auctions have closed_at, sold ones a price.
ALTER TABLE "account"."owned_cards" ADD CONSTRAINT "owned_cards_auction_id_auctions_id_fk" FOREIGN KEY ("auction_id") REFERENCES "account"."auctions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account"."auctions" ADD CONSTRAINT "auctions_self_bid_check" CHECK (top_bidder_id is null or seller_id is null or top_bidder_id <> seller_id);--> statement-breakpoint
ALTER TABLE "account"."auctions" ADD CONSTRAINT "auctions_extension_bound_check" CHECK (ends_at <= original_ends_at + interval '20 minutes');--> statement-breakpoint
ALTER TABLE "account"."auctions" ADD CONSTRAINT "auctions_closed_check" CHECK ((status = 'open') = (closed_at is null) and bid_count >= 0);--> statement-breakpoint
ALTER TABLE "account"."auctions" ADD CONSTRAINT "auctions_sold_check" CHECK (status <> 'sold' or top_amount is not null);