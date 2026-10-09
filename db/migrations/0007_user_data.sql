CREATE TABLE "account"."decks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_id" text,
	"name" text NOT NULL,
	"format" text NOT NULL,
	"cards" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decks_name_check" CHECK (char_length(name) between 1 and 50),
	CONSTRAINT "decks_format_check" CHECK (format in ('standard', 'expanded', 'unlimited')),
	CONSTRAINT "decks_cards_check" CHECK (jsonb_typeof(cards) = 'array' and jsonb_array_length(cards) <= 60),
	CONSTRAINT "decks_source_check" CHECK (source_id is null or source_id ~ '^[A-Za-z0-9_-]{1,64}$'),
	CONSTRAINT "decks_version_check" CHECK (version >= 1)
);
--> statement-breakpoint
CREATE TABLE "account"."favorites" (
	"user_id" uuid NOT NULL,
	"card_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "favorites_user_id_card_id_pk" PRIMARY KEY("user_id","card_id"),
	CONSTRAINT "favorites_card_check" CHECK (card_id ~ '^[A-Za-z0-9_.!?-]{1,40}$')
);
--> statement-breakpoint
ALTER TABLE "account"."decks" ADD CONSTRAINT "decks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "account"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account"."favorites" ADD CONSTRAINT "favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "account"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decks_user_idx" ON "account"."decks" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "decks_user_source_idx" ON "account"."decks" USING btree ("user_id","source_id");--> statement-breakpoint
CREATE INDEX "favorites_user_idx" ON "account"."favorites" USING btree ("user_id","created_at");