ALTER TABLE "account"."decks" ALTER COLUMN "created_at" SET DEFAULT clock_timestamp();--> statement-breakpoint
ALTER TABLE "account"."decks" ALTER COLUMN "updated_at" SET DEFAULT clock_timestamp();