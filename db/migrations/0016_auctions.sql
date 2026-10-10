-- M7 auctions (docs/auction/design.md §2–§4, Security A-1/A-2): api_rw inserts auctions and bids and
-- changes only the moving parts of an auction and a card's owner/listing; no DELETE anywhere. Others'
-- history survives an account deletion (SET NULL, shown as "탈퇴한 사용자").
CREATE TABLE "account"."auctions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid,
	"owned_card_id" uuid,
	"card_id" text NOT NULL,
	"start_price" bigint NOT NULL,
	"min_step" bigint NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"original_ends_at" timestamp with time zone NOT NULL,
	"extensions" integer DEFAULT 0 NOT NULL,
	"top_amount" bigint,
	"top_bidder_id" uuid,
	"bid_count" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"idem_key" text NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "auctions_status_check" CHECK (status in ('open', 'sold', 'unsold', 'cancelled')),
	CONSTRAINT "auctions_card_check" CHECK (card_id ~ '^[A-Za-z0-9_.!?-]{1,40}$'),
	CONSTRAINT "auctions_price_check" CHECK (start_price between 1 and 100000000 and min_step between 1 and 100000000),
	CONSTRAINT "auctions_top_check" CHECK (top_amount is null or top_amount between 1 and 100000000),
	CONSTRAINT "auctions_time_check" CHECK (ends_at > starts_at and original_ends_at > starts_at),
	CONSTRAINT "auctions_extensions_check" CHECK (extensions between 0 and 10),
	CONSTRAINT "auctions_idem_check" CHECK (idem_key ~ '^[A-Za-z0-9_-]{8,64}$')
);
--> statement-breakpoint
CREATE TABLE "account"."bids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auction_id" uuid NOT NULL,
	"bidder_id" uuid,
	"amount" bigint NOT NULL,
	"alias_no" integer NOT NULL,
	"idem_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "bids_amount_check" CHECK (amount between 1 and 100000000),
	CONSTRAINT "bids_alias_check" CHECK (alias_no between 1 and 10000),
	CONSTRAINT "bids_idem_check" CHECK (idem_key ~ '^[A-Za-z0-9_-]{8,64}$')
);
--> statement-breakpoint
ALTER TABLE "account"."owned_cards" ADD COLUMN "auction_id" uuid;--> statement-breakpoint
ALTER TABLE "account"."auctions" ADD CONSTRAINT "auctions_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "account"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account"."auctions" ADD CONSTRAINT "auctions_owned_card_id_owned_cards_id_fk" FOREIGN KEY ("owned_card_id") REFERENCES "account"."owned_cards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account"."auctions" ADD CONSTRAINT "auctions_top_bidder_id_users_id_fk" FOREIGN KEY ("top_bidder_id") REFERENCES "account"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account"."bids" ADD CONSTRAINT "bids_auction_id_auctions_id_fk" FOREIGN KEY ("auction_id") REFERENCES "account"."auctions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account"."bids" ADD CONSTRAINT "bids_bidder_id_users_id_fk" FOREIGN KEY ("bidder_id") REFERENCES "account"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auctions_open_card_idx" ON "account"."auctions" USING btree ("owned_card_id") WHERE status = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "auctions_idem_idx" ON "account"."auctions" USING btree ("seller_id","idem_key");--> statement-breakpoint
CREATE INDEX "auctions_open_ends_idx" ON "account"."auctions" USING btree ("status","ends_at");--> statement-breakpoint
CREATE INDEX "auctions_seller_idx" ON "account"."auctions" USING btree ("seller_id","status");--> statement-breakpoint
CREATE INDEX "auctions_top_idx" ON "account"."auctions" USING btree ("top_bidder_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "bids_idem_idx" ON "account"."bids" USING btree ("auction_id","bidder_id","idem_key");--> statement-breakpoint
CREATE INDEX "bids_auction_idx" ON "account"."bids" USING btree ("auction_id","created_at");--> statement-breakpoint
CREATE INDEX "bids_bidder_idx" ON "account"."bids" USING btree ("bidder_id");--> statement-breakpoint
GRANT SELECT ON account.auctions TO api_rw;--> statement-breakpoint
GRANT INSERT (seller_id, owned_card_id, card_id, start_price, min_step, ends_at, original_ends_at, idem_key) ON account.auctions TO api_rw;--> statement-breakpoint
GRANT UPDATE (status, ends_at, extensions, top_amount, top_bidder_id, bid_count, version, closed_at) ON account.auctions TO api_rw;--> statement-breakpoint
GRANT SELECT ON account.bids TO api_rw;--> statement-breakpoint
GRANT INSERT (auction_id, bidder_id, amount, alias_no, idem_key) ON account.bids TO api_rw;--> statement-breakpoint
GRANT UPDATE (user_id, auction_id) ON account.owned_cards TO api_rw;
