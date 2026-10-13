CREATE TABLE "account"."admin_point_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid,
	"user_id" uuid,
	"amount" integer NOT NULL,
	"reason" text,
	"entry_id" uuid,
	"idem_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "admin_point_grants_amount_check" CHECK (amount between 1 and 100000),
	CONSTRAINT "admin_point_grants_reason_check" CHECK (reason is null or char_length(reason) between 1 and 200),
	CONSTRAINT "admin_point_grants_idem_check" CHECK (idem_key ~ '^[A-Za-z0-9_-]{8,64}$')
);
--> statement-breakpoint
ALTER TABLE "account"."users" ADD COLUMN "member_code" text DEFAULT upper(substr(md5(gen_random_uuid()::text), 1, 8)) NOT NULL;--> statement-breakpoint
ALTER TABLE "account"."admin_point_grants" ADD CONSTRAINT "admin_point_grants_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "account"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account"."admin_point_grants" ADD CONSTRAINT "admin_point_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "account"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account"."admin_point_grants" ADD CONSTRAINT "admin_point_grants_entry_id_point_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "account"."point_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_point_grants_idem_idx" ON "account"."admin_point_grants" USING btree ("admin_id","idem_key");--> statement-breakpoint
CREATE INDEX "admin_point_grants_admin_day_idx" ON "account"."admin_point_grants" USING btree ("admin_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_member_code_idx" ON "account"."users" USING btree ("member_code");--> statement-breakpoint
ALTER TABLE "account"."users" ADD CONSTRAINT "users_member_code_check" CHECK (member_code ~ '^[0-9A-F]{8}$');--> statement-breakpoint
GRANT SELECT ON account.admin_point_grants TO api_rw;--> statement-breakpoint
GRANT INSERT (admin_id, user_id, amount, reason, entry_id, idem_key) ON account.admin_point_grants TO api_rw;--> statement-breakpoint
GRANT UPDATE (reason) ON account.admin_point_grants TO api_rw;
