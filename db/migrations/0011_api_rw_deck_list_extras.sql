-- The deck list's cover and rule status (0010): written with the deck, like name and cards
GRANT INSERT (cover_id, problems) ON account.decks TO api_rw;--> statement-breakpoint
GRANT UPDATE (cover_id, problems) ON account.decks TO api_rw;
