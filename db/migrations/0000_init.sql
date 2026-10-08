CREATE TABLE "card_edition_link" (
	"card_id" text NOT NULL,
	"edition" text NOT NULL,
	"external_id" text NOT NULL,
	"method" text NOT NULL,
	"confidence" real NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	CONSTRAINT "card_edition_link_card_id_edition_pk" PRIMARY KEY("card_id","edition"),
	CONSTRAINT "card_edition_link_edition_check" CHECK (edition = 'ja'),
	CONSTRAINT "card_edition_link_method_check" CHECK (method in ('auto', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "card_view_daily" (
	"card_id" text NOT NULL,
	"day" date NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "card_view_daily_card_id_day_pk" PRIMARY KEY("card_id","day")
);
--> statement-breakpoint
CREATE TABLE "daily_counter" (
	"name" text NOT NULL,
	"day" date NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "daily_counter_name_day_pk" PRIMARY KEY("name","day")
);
--> statement-breakpoint
CREATE TABLE "fx_rate" (
	"currency" char(3) NOT NULL,
	"rate_date" date NOT NULL,
	"krw_per_unit" numeric(14, 6) NOT NULL,
	"usable" boolean DEFAULT true NOT NULL,
	CONSTRAINT "fx_rate_currency_rate_date_pk" PRIMARY KEY("currency","rate_date"),
	CONSTRAINT "fx_rate_currency_check" CHECK (currency in ('USD', 'EUR', 'JPY')),
	CONSTRAINT "fx_rate_positive_check" CHECK (krw_per_unit > 0)
);
--> statement-breakpoint
CREATE TABLE "price_refresh" (
	"card_id" text PRIMARY KEY NOT NULL,
	"refreshed_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	CONSTRAINT "price_refresh_status_check" CHECK (status in ('pending', 'ok', 'not_found', 'error'))
);
--> statement-breakpoint
CREATE TABLE "price_snapshot" (
	"card_id" text NOT NULL,
	"edition" text NOT NULL,
	"source" text NOT NULL,
	"variant" text NOT NULL,
	"captured_on" date NOT NULL,
	"last_seen_on" date NOT NULL,
	"currency" char(3) NOT NULL,
	"market" numeric(12, 2) NOT NULL,
	"low" numeric(12, 2),
	"avg30" numeric(12, 2),
	"flagged" boolean DEFAULT false NOT NULL,
	CONSTRAINT "price_snapshot_card_id_edition_source_variant_captured_on_pk" PRIMARY KEY("card_id","edition","source","variant","captured_on"),
	CONSTRAINT "price_snapshot_edition_check" CHECK (edition in ('en', 'ja', 'ko')),
	CONSTRAINT "price_snapshot_source_check" CHECK (source in ('tcgplayer', 'cardmarket')),
	CONSTRAINT "price_snapshot_variant_check" CHECK (variant in ('normal', 'holo', 'reverse', 'firstEdition', 'unlimited')),
	CONSTRAINT "price_snapshot_currency_check" CHECK (currency in ('USD', 'EUR', 'JPY')),
	CONSTRAINT "price_snapshot_values_check" CHECK (market >= 0 and market <= 100000 and (low is null or low >= 0)),
	CONSTRAINT "price_snapshot_seen_check" CHECK (last_seen_on >= captured_on)
);
--> statement-breakpoint
CREATE INDEX "price_snapshot_card_idx" ON "price_snapshot" USING btree ("card_id","edition","captured_on");