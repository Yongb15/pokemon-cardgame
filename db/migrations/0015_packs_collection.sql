-- M7 card packs and the collection (docs/auction/packs.md, Security 7b): api_rw inserts and reads,
-- nothing else yet (owned_cards UPDATE(user_id, auction_id) arrives with auctions in 7c), no DELETE.
CREATE TABLE "account"."owned_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"card_id" text NOT NULL,
	"source" text NOT NULL,
	"pack_id" uuid,
	"acquired_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "owned_cards_card_check" CHECK (card_id ~ '^[A-Za-z0-9_.!?-]{1,40}$'),
	CONSTRAINT "owned_cards_source_check" CHECK (source in ('pack', 'auction', 'test'))
);
--> statement-breakpoint
CREATE TABLE "account"."pack_openings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"set_id" text NOT NULL,
	"cost" bigint NOT NULL,
	"cards" text[] NOT NULL,
	"seeded" boolean DEFAULT false NOT NULL,
	"idem_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "pack_openings_set_check" CHECK (set_id ~ '^[a-z0-9]{1,20}$'),
	CONSTRAINT "pack_openings_cost_check" CHECK (cost between 1 and 100000000),
	CONSTRAINT "pack_openings_cards_check" CHECK (cardinality(cards) = 5),
	CONSTRAINT "pack_openings_idem_check" CHECK (idem_key ~ '^[A-Za-z0-9_-]{8,64}$')
);
--> statement-breakpoint
ALTER TABLE "account"."owned_cards" ADD CONSTRAINT "owned_cards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "account"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account"."owned_cards" ADD CONSTRAINT "owned_cards_pack_id_pack_openings_id_fk" FOREIGN KEY ("pack_id") REFERENCES "account"."pack_openings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account"."pack_openings" ADD CONSTRAINT "pack_openings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "account"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "owned_cards_user_idx" ON "account"."owned_cards" USING btree ("user_id","acquired_at");--> statement-breakpoint
CREATE INDEX "owned_cards_pack_idx" ON "account"."owned_cards" USING btree ("pack_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pack_openings_idem_idx" ON "account"."pack_openings" USING btree ("user_id","idem_key");--> statement-breakpoint
CREATE INDEX "pack_openings_user_idx" ON "account"."pack_openings" USING btree ("user_id","created_at");--> statement-breakpoint
GRANT SELECT ON account.pack_openings TO api_rw;--> statement-breakpoint
GRANT INSERT (user_id, set_id, cost, cards, seeded, idem_key) ON account.pack_openings TO api_rw;--> statement-breakpoint
GRANT SELECT ON account.owned_cards TO api_rw;--> statement-breakpoint
GRANT INSERT (user_id, card_id, source, pack_id) ON account.owned_cards TO api_rw;
