-- M8 price alerts (docs/price/alerts.md, Security PA-2). Alerts are the user's own settings: api_rw may
-- delete them (hard delete, Security Q2). A price notification has no auction and keeps its target.
CREATE TABLE "account"."alert_checks" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account"."price_alerts" (
	"user_id" uuid NOT NULL,
	"card_id" text NOT NULL,
	"target_krw" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"triggered_at" timestamp with time zone,
	CONSTRAINT "price_alerts_user_id_card_id_pk" PRIMARY KEY("user_id","card_id"),
	CONSTRAINT "price_alerts_card_check" CHECK (card_id ~ '^[A-Za-z0-9_.!?-]{1,40}$'),
	CONSTRAINT "price_alerts_target_check" CHECK (target_krw between 100 and 100000000 and target_krw % 100 = 0)
);
--> statement-breakpoint
ALTER TABLE "account"."notifications" DROP CONSTRAINT "notifications_kind_check";--> statement-breakpoint
ALTER TABLE "account"."notifications" ALTER COLUMN "auction_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "account"."notifications" ADD COLUMN "target" integer;--> statement-breakpoint
ALTER TABLE "account"."alert_checks" ADD CONSTRAINT "alert_checks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "account"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account"."price_alerts" ADD CONSTRAINT "price_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "account"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_price_once_idx" ON "account"."notifications" USING btree ("user_id","card_id") WHERE kind = 'price';--> statement-breakpoint
ALTER TABLE "account"."notifications" ADD CONSTRAINT "notifications_auction_check" CHECK ((kind = 'price') = (auction_id is null));--> statement-breakpoint
ALTER TABLE "account"."notifications" ADD CONSTRAINT "notifications_target_check" CHECK ((kind = 'price') = (target is not null) and (target is null or target between 100 and 100000000));--> statement-breakpoint
ALTER TABLE "account"."notifications" ADD CONSTRAINT "notifications_kind_check" CHECK (kind in ('outbid', 'won', 'sold', 'unsold', 'price'));--> statement-breakpoint
GRANT SELECT, DELETE ON account.price_alerts TO api_rw;--> statement-breakpoint
GRANT INSERT (user_id, card_id, target_krw, active, triggered_at) ON account.price_alerts TO api_rw;--> statement-breakpoint
GRANT UPDATE (target_krw, active, triggered_at) ON account.price_alerts TO api_rw;--> statement-breakpoint
GRANT SELECT ON account.alert_checks TO api_rw;--> statement-breakpoint
GRANT INSERT (user_id, checked_at) ON account.alert_checks TO api_rw;--> statement-breakpoint
GRANT UPDATE (checked_at) ON account.alert_checks TO api_rw;--> statement-breakpoint
GRANT INSERT (target) ON account.notifications TO api_rw;--> statement-breakpoint
GRANT UPDATE (target) ON account.notifications TO api_rw;