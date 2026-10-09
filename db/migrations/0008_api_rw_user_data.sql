-- api_rw on the user-data tables (M6 step 5), least privilege like 0005/0006:
-- inserts name their columns (id, version and the timestamps take their defaults), updates only
-- what a save changes, and nothing else in the schema widens.
GRANT SELECT, DELETE ON account.decks TO api_rw;--> statement-breakpoint
GRANT INSERT (user_id, source_id, name, format, cards) ON account.decks TO api_rw;--> statement-breakpoint
GRANT UPDATE (name, format, cards, version, updated_at) ON account.decks TO api_rw;--> statement-breakpoint
GRANT SELECT, DELETE ON account.favorites TO api_rw;--> statement-breakpoint
GRANT INSERT (user_id, card_id) ON account.favorites TO api_rw;
