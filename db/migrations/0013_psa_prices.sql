-- PSA graded prices (docs/price/psa.md, Security P-1..P-4): the collector writes them, the site only
-- reads the aggregates. No DELETE for either role (old rows are kept or compacted by the owner).
CREATE TABLE "psa_price" (
	"card_id" text NOT NULL,
	"grade" text NOT NULL,
	"captured_on" date NOT NULL,
	"median" numeric(12, 2) NOT NULL,
	"sales" integer NOT NULL,
	"last_sale_on" date,
	CONSTRAINT "psa_price_card_id_grade_captured_on_pk" PRIMARY KEY("card_id","grade","captured_on"),
	CONSTRAINT "psa_price_grade_check" CHECK (grade in ('psa10', 'psa9', 'psa8')),
	CONSTRAINT "psa_price_values_check" CHECK (median between 0 and 1000000 and sales between 3 and 1000000),
	CONSTRAINT "psa_price_sale_check" CHECK (last_sale_on is null or last_sale_on <= captured_on),
	CONSTRAINT "psa_price_card_id_check" CHECK (length(card_id) between 1 and 40)
);
--> statement-breakpoint
CREATE TABLE "psa_refresh" (
	"card_id" text PRIMARY KEY NOT NULL,
	"refreshed_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	CONSTRAINT "psa_refresh_status_check" CHECK (status in ('ok', 'no_sales', 'not_found', 'error')),
	CONSTRAINT "psa_refresh_card_id_check" CHECK (length(card_id) between 1 and 40)
);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON psa_price TO collector_rw;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON psa_refresh TO collector_rw;--> statement-breakpoint
GRANT SELECT ON psa_price TO app_rw;
