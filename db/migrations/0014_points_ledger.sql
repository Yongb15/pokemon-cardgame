-- M7 points ledger (docs/auction/design.md §2, ADR 0005, Security A-1): the ledger is append-only for
-- api_rw (INSERT + SELECT), the balance row changes only its balance/held/version columns, and no
-- DELETE anywhere (removing an account cascades through the foreign keys as the table owner).
CREATE TABLE "account"."daily_claims" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	CONSTRAINT "daily_claims_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
CREATE TABLE "account"."point_accounts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"balance" bigint DEFAULT 0 NOT NULL,
	"held" bigint DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "point_accounts_balance_check" CHECK (held >= 0 and balance >= held and balance <= 10000000000)
);
--> statement-breakpoint
CREATE TABLE "account"."point_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"kind" text NOT NULL,
	"ref" text,
	"idem_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "point_entries_amount_check" CHECK (amount <> 0 and amount between -100000000 and 100000000),
	CONSTRAINT "point_entries_kind_check" CHECK (kind in ('signup_bonus', 'daily_bonus', 'pack_purchase', 'sale_income', 'sale_fee', 'purchase', 'admin_adjust')),
	CONSTRAINT "point_entries_ref_check" CHECK (ref is null or ref ~ '^[A-Za-z0-9_:-]{1,64}$'),
	CONSTRAINT "point_entries_idem_check" CHECK (idem_key ~ '^[A-Za-z0-9_:-]{1,80}$')
);
--> statement-breakpoint
ALTER TABLE "account"."daily_claims" ADD CONSTRAINT "daily_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "account"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account"."point_accounts" ADD CONSTRAINT "point_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "account"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account"."point_entries" ADD CONSTRAINT "point_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "account"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "point_entries_idem_idx" ON "account"."point_entries" USING btree ("user_id","idem_key");--> statement-breakpoint
CREATE INDEX "point_entries_user_idx" ON "account"."point_entries" USING btree ("user_id","created_at");--> statement-breakpoint
GRANT SELECT ON account.point_entries TO api_rw;--> statement-breakpoint
GRANT INSERT (user_id, amount, kind, ref, idem_key) ON account.point_entries TO api_rw;--> statement-breakpoint
GRANT SELECT ON account.point_accounts TO api_rw;--> statement-breakpoint
GRANT INSERT (user_id) ON account.point_accounts TO api_rw;--> statement-breakpoint
GRANT UPDATE (balance, held, version) ON account.point_accounts TO api_rw;--> statement-breakpoint
GRANT SELECT ON account.daily_claims TO api_rw;--> statement-breakpoint
GRANT INSERT (user_id, day) ON account.daily_claims TO api_rw;
