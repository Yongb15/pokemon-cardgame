ALTER TABLE "price_snapshot" DROP CONSTRAINT "price_snapshot_values_check";--> statement-breakpoint
ALTER TABLE "card_edition_link" ADD CONSTRAINT "card_edition_link_card_id_check" CHECK (length(card_id) between 1 and 40);--> statement-breakpoint
ALTER TABLE "card_view_daily" ADD CONSTRAINT "card_view_daily_card_id_check" CHECK (length(card_id) between 1 and 40);--> statement-breakpoint
ALTER TABLE "card_view_daily" ADD CONSTRAINT "card_view_daily_views_check" CHECK (views >= 0);--> statement-breakpoint
ALTER TABLE "daily_counter" ADD CONSTRAINT "daily_counter_value_check" CHECK (value >= 0);--> statement-breakpoint
ALTER TABLE "price_refresh" ADD CONSTRAINT "price_refresh_card_id_check" CHECK (length(card_id) between 1 and 40);--> statement-breakpoint
ALTER TABLE "price_snapshot" ADD CONSTRAINT "price_snapshot_card_id_check" CHECK (length(card_id) between 1 and 40);--> statement-breakpoint
ALTER TABLE "price_snapshot" ADD CONSTRAINT "price_snapshot_values_check" CHECK (market between 0 and 100000 and (low is null or low between 0 and 100000) and (avg30 is null or avg30 between 0 and 100000));--> statement-breakpoint
-- The app needs no temporary tables (Security review)
DO $$ BEGIN EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', current_database()); END $$;
