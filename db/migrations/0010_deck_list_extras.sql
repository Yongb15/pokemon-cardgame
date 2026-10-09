ALTER TABLE "account"."decks" ADD COLUMN "cover_id" text;--> statement-breakpoint
ALTER TABLE "account"."decks" ADD COLUMN "problems" integer;--> statement-breakpoint
ALTER TABLE "account"."decks" ADD CONSTRAINT "decks_cover_check" CHECK (cover_id is null or cover_id ~ '^[A-Za-z0-9_.!?-]{1,40}$');--> statement-breakpoint
ALTER TABLE "account"."decks" ADD CONSTRAINT "decks_problems_check" CHECK (problems is null or problems between 0 and 999);