-- Clear all game-related data
-- This relies on ON DELETE CASCADE constraints from game_sessions to other tables.
-- Tables affected should include:
-- game_sessions
-- game_players
-- player_bids
-- player_round_hands
-- played_tricks
-- played_cards_in_tricks
-- player_round_score_changes

-- WARNING: This operation is destructive and will permanently delete data.
-- Ensure you have backups or are certain before running this on your database.

BEGIN; -- Start a transaction

-- Delete all records from game_sessions.
-- Due to CASCADE constraints, related records in other tables should also be deleted.
DELETE FROM game_sessions;

-- You can add COUNT(*) queries here if you want to see the row counts before committing.
-- Example:
-- SELECT COUNT(*) FROM game_sessions;
-- SELECT COUNT(*) FROM game_players;
-- ...

COMMIT; -- Commit the transaction if you are sure

-- Alternatively, if you want to check counts first or are unsure,
-- you can run the DELETE statement without a transaction or use ROLLBACK
-- after checking counts if you don't want to proceed. 