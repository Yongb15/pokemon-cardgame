-- v1.16.0: 10-pack opening, duplicate exchange and crafting (docs/auction/exchange.md, Security X-1..X-5).
-- api_rw still can't DELETE owned_cards: exchange goes through one SECURITY DEFINER function owned by a NOLOGIN
-- role that can only read/delete owned_cards and read auctions. EXECUTE is revoked from PUBLIC, granted to api_rw.
ALTER TABLE "account"."owned_cards" DROP CONSTRAINT "owned_cards_source_check";--> statement-breakpoint
ALTER TABLE "account"."point_entries" DROP CONSTRAINT "point_entries_kind_check";--> statement-breakpoint
DROP INDEX "account"."pack_openings_idem_idx";--> statement-breakpoint
ALTER TABLE "account"."pack_openings" ADD COLUMN "bundle_idx" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "pack_openings_idem_idx" ON "account"."pack_openings" USING btree ("user_id","idem_key","bundle_idx");--> statement-breakpoint
ALTER TABLE "account"."owned_cards" ADD CONSTRAINT "owned_cards_source_check" CHECK (source in ('pack', 'auction', 'test', 'craft'));--> statement-breakpoint
ALTER TABLE "account"."pack_openings" ADD CONSTRAINT "pack_openings_bundle_check" CHECK (bundle_idx between 0 and 9);--> statement-breakpoint
ALTER TABLE "account"."point_entries" ADD CONSTRAINT "point_entries_kind_check" CHECK (kind in ('signup_bonus', 'daily_bonus', 'pack_purchase', 'sale_income', 'sale_fee', 'purchase', 'admin_adjust', 'card_exchange', 'card_craft'));--> statement-breakpoint
GRANT INSERT (bundle_idx) ON account.pack_openings TO api_rw;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'card_exchanger') THEN
    CREATE ROLE card_exchanger NOLOGIN;
  END IF;
END $$;--> statement-breakpoint
GRANT USAGE ON SCHEMA account TO card_exchanger;--> statement-breakpoint
GRANT SELECT, DELETE ON account.owned_cards TO card_exchanger;--> statement-breakpoint
GRANT SELECT ON account.auctions TO card_exchanger;--> statement-breakpoint
CREATE FUNCTION account.exchange_cards(p_user uuid, p_card text, p_n integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  v_deleted integer;
  v_left integer;
BEGIN
  -- Checked here too, so every caller gets the same rules (Security X-3)
  IF p_user IS NULL OR p_card IS NULL OR p_card !~ '^[A-Za-z0-9_.!?-]{1,40}$' OR p_n IS NULL OR p_n < 1 OR p_n > 50 THEN
    RAISE EXCEPTION 'exchange_cards: bad arguments' USING ERRCODE = '22023';
  END IF;
  -- The oldest eligible copies, deleted by id. The DELETE locks each row and re-checks the conditions on it, so
  -- a copy listed meanwhile is skipped (no row-lock grant needed: the owner role has SELECT and DELETE only)
  WITH picked AS (
    SELECT o.id FROM account.owned_cards o
    WHERE o.user_id = p_user AND o.card_id = p_card AND o.source <> 'test' AND o.auction_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM account.auctions a WHERE a.owned_card_id = o.id AND a.status = 'open')
    ORDER BY o.acquired_at, o.id
    LIMIT p_n
  ), gone AS (
    DELETE FROM account.owned_cards o USING picked
    WHERE o.id = picked.id AND o.auction_id IS NULL AND o.source <> 'test'
      AND NOT EXISTS (SELECT 1 FROM account.auctions a WHERE a.owned_card_id = o.id AND a.status = 'open')
    RETURNING o.id
  )
  SELECT count(*) INTO v_deleted FROM gone;
  -- What stays must be a copy the user can use: not listed, not a test copy (Security I-x1)
  SELECT count(*) INTO v_left FROM account.owned_cards o
  WHERE o.user_id = p_user AND o.card_id = p_card AND o.source <> 'test' AND o.auction_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM account.auctions a WHERE a.owned_card_id = o.id AND a.status = 'open');
  -- Exactly n went and at least one usable copy stays, or nothing happens (the caller's transaction rolls back)
  IF v_deleted < p_n OR v_left < 1 THEN
    RAISE EXCEPTION 'exchange_cards: not enough copies' USING ERRCODE = 'P0001';
  END IF;
  RETURN v_deleted;
END
$fn$;--> statement-breakpoint
REVOKE ALL ON FUNCTION account.exchange_cards(uuid, text, integer) FROM PUBLIC;--> statement-breakpoint
GRANT card_exchanger TO CURRENT_USER;--> statement-breakpoint
GRANT CREATE ON SCHEMA account TO card_exchanger;--> statement-breakpoint
ALTER FUNCTION account.exchange_cards(uuid, text, integer) OWNER TO card_exchanger;--> statement-breakpoint
REVOKE CREATE ON SCHEMA account FROM card_exchanger;--> statement-breakpoint
REVOKE ALL ON FUNCTION account.exchange_cards(uuid, text, integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION account.exchange_cards(uuid, text, integer) TO api_rw;
