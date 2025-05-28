🔧 Project Overview

Develop an online multiplayer four-player card game using an existing boilerplate based on:

    Next.js (frontend framework)

    React

    PostgreSQL + Drizzle (database and ORM)

    shadcn/ui (UI components)

♻️ Boilerplate Reuse Strategy
✅ Features to Retain:

    User authentication and account management (sign-up, sign-in, profile).

    User dashboard and profile access button (top right corner).

❌ Features to Remove:

    Existing landing page.

🏠 New Landing Page Requirements

    Displayed at / (root route).

    If NOT logged in:

        Show sign-in and sign-up options.

    If logged in:

        Show list of open games with available player slots.

        Allow users to create a new game session.

🧠 Game Engine Implementation

1. Deck and Setup

   Use a 32-card deck (7–10, J, Q, K, A in all suits).

   Each round features a randomly selected trump suit.

Engine Tasks:

    Create a Deck class or utility.

    Add getTrumpSuit() function per round.

2. Rounds and Card Distribution
   Round Count: 17
   Distribution:

const roundDistribution = [1,2,3,4,5,6,7,8,8,8,7,6,5,4,3,2,1];

Engine Tasks:

    Implement game loop iterating through roundDistribution.

    Dynamically deal correct number of cards per round.

    Rotate starting player clockwise each round.

3.  Bidding Phase
    Rules:

        Each player predicts number of tricks they'll win.

        Valid bids: 0 to number of cards in hand.

        Optional rule: prevent total bids from equaling total tricks (Oh Hell rule).

Engine Tasks:

    Add biddingPhase() before trick play.

    Store and validate player bids.

4.  Trick Play and Validation
    Play Rules:

        Follow lead suit if possible.

        If not, play trump if available.

        If neither, play any card.

Winning a Trick:

    If trump cards played: highest trump wins.

    Otherwise: highest card in lead suit wins.

Engine Tasks:

    Validate each play against rules.

    Implement determineTrickWinner() logic.

5.  Scoring System
    Formula:

        Exact prediction: 10 + (3 × tricks won)

        Incorrect prediction: -3 × |prediction - actual|

Engine Tasks:

    Compare predictions vs. actuals post-round.

    Maintain cumulative score in scoreboard.

6. Turn and Player Order Management

   Initial round: starting player selected randomly.

   Subsequent rounds: rotate starting player clockwise.

Engine Tasks:

    Track and rotate player order each round.

7. Game End and Victory

   After 17 rounds, compute final scores.

   Winner: Player with highest cumulative score.

Engine Tasks:

    Implement endGame() logic.

    Announce/display final results and rankings.

Database Requirements

    Extend existing schema to store:

        Game sessions

        Player actions and bids

        Trick outcomes

        Final scores and winners

    Link game history to user accounts for display on the dashboard.

🚀 Implementation Strategy and Steps

The development will proceed in the following phases, focusing on building and testing components incrementally:

1.  **Project Setup and Initial Cleanup:**

    - Remove the existing landing page content.
    - Set up a basic placeholder for the new landing page.
    - Verify user authentication and dashboard access are functional.

2.  **Core Game Logic - Foundational Elements (Offline/Simulated):**

    - **Deck Management:**
      - Create `Deck` class/utility: 32-card deck (7-A, all suits).
      - Implement card shuffling.
    - **Round Mechanics (Single Round Simulation):**
      - Implement `getTrumpSuit()` for random trump selection per round.
      - Implement card dealing based on `roundDistribution` (e.g., for the first round, deal 1 card).
      - Simulate a single player's hand.

    **Implementation Details (Step 2):**

    - Created `lib/game/deck.ts`:
      - Defines `SUITS` (HEARTS, DIAMONDS, CLUBS, SPADES) and `RANKS` (7-ACE) constants.
      - Defines `Card` interface (`{ suit: Suit; rank: Rank }`).
      - Exports `Deck` class:
        - Constructor initializes and shuffles a 32-card deck.
        - `shuffle()`: Implements Fisher-Yates shuffle.
        - `dealCard()`: Deals one card.
        - `dealCards(numCards)`: Deals multiple cards.
        - `getCardsCount()`: Returns remaining card count.
        - `reset()`: Reinitializes and shuffles the deck.
    - Created `lib/game/round.ts`:
      - Exports `ROUND_DISTRIBUTION` constant array (`[1,2,3,4,5,6,7,8,8,8,7,6,5,4,3,2,1]`).
      - `getTrumpSuit()`: Randomly selects and returns a `Suit`.
      - `dealCardsForRound(roundNumber: number, deck: Deck)`: Deals cards for a single player based on `ROUND_DISTRIBUTION` for the given 0-indexed `roundNumber`.
    - Added basic assertion-based tests in `lib/game/deck.test.ts` and `lib/game/round.test.ts`.

3.  **Core Game Logic - Trick Play and Bidding (Offline/Simulated) (Completed)**

    - **Bidding Logic (`lib/game/round.ts`):**
      - Added `Player` and `PlayerBid` interfaces.
      - Implemented `getPlayerBid(player, numCardsInHand)`: Simulates a single player's bid. Includes validation (e.g., bid cannot exceed the number of cards). Currently uses a naive AI (bids 1 if has cards, 0 otherwise).
      - Implemented `biddingPhase(players, roundNumber)`: Orchestrates bid collection from all players for a round. Includes a console warning for the "Oh Hell" rule condition (sum of bids equals number of tricks).
    - **Trick Mechanics (`lib/game/trick.ts`):**
      - Defined `PlayedCard` and `Trick` interfaces.
      - Added `RANK_ORDER` constant for card comparisons.
      - Implemented `compareCardsInTrick(cardA, cardB, leadSuit, trumpSuit)`: Determines which of two cards is higher in a trick context, considering trump and lead suit.
      - Implemented `hasSuit(hand, suit)`: Helper to check if a hand contains a card of a given suit.
      - Implemented `isValidPlay(playerHand, cardToPlay, leadSuit, trumpSuit)`: Validates if a card play is legal based on standard trick-taking rules (must follow suit if possible, then must trump if out of lead suit and has trump, otherwise can discard).
      - Implemented `determineTrickWinner(playedCardsInOrder, trumpSuit)`: Determines the winner of a completed trick based on the cards played and the trump suit.
      - Implemented `simulateTrick(players, startingPlayerIndex, trumpSuit)`: Simulates a single 4-player trick.
        - Uses a simple AI for card selection (plays the first valid card found).
        - Updates player hands by removing the played card.
        - Determines and returns the trick winner and the sequence of plays.
    - **Testing (`lib/game/trick.test.ts`):**
      - Created comprehensive tests for `compareCardsInTrick`, `isValidPlay`, and `simulateTrick`.
      - Tests for `simulateTrick` cover various scenarios: simple lead suit win, trump wins, highest trump wins, void in lead suit (forcing trump/discard), etc.
      - Resolved an issue where `tsx` test runner would prematurely halt due to excessive `console.log` output from within `simulateTrick` when running multiple scenarios. The `console.log` calls within `simulateTrick` were commented out to ensure test stability. All assertions passed.

4.  **Core Game Logic - Round and Game Scoring (Offline/Simulated) (Completed)**

    - **Player Representation (`lib/game/game.ts`):**
      - Defined `GamePlayer` interface: `{ id: string; hand: Card[]; bid: number; tricksTaken: number; score: number }` to hold per-round and cumulative game data for each player.
    - **Scoring Logic (`lib/game/game.ts`):**
      - Implemented `calculatePlayerScore(bid, tricksTaken)` according to `requirements.md` (Section 5):
        - Exact prediction: `10 + (3 * tricksTaken)`
        - Incorrect prediction: `-3 * Math.abs(bid - tricksTaken)`
      - Tested thoroughly in `lib/game/game.test.ts`.
    - **Round Simulation (`lib/game/game.ts`):**
      - Implemented `simulateRound(deck, players, roundNumber, dealerIndex)`:
        - Resets deck and player round-specific stats (hand, bid, tricksTaken).
        - Deals cards based on `ROUND_DISTRIBUTION` for the current `roundNumber`, starting left of the `dealerIndex`.
        - Determines trump suit using `getTrumpSuit()`.
        - Conducts bidding using `biddingPhase()`, ensuring players bid in order (starting left of dealer) and mapping bids back.
        - Plays all tricks for the round using `simulateTrick()`:
          - Tracks starting player for each trick (winner of previous trick).
          - Updates player hands and tricks taken count.
        - Calculates scores for each player for the round using `calculatePlayerScore()`.
        - Updates players' cumulative scores.
        - Returns a `RoundResult` object with detailed information about the round (trump, bids with actuals, tricks played, scores, etc.).
      - Tested in `lib/game/game.test.ts` for different round configurations, verifying dealing, bidding ranges, trick counts, and score accumulation.
    - **Game Simulation (`lib/game/game.ts`):**
      - Implemented `simulateGame()`:
        - Initializes 4 `GamePlayer` objects and a `Deck`.
        - Selects a random starting dealer.
        - Loops through 17 rounds:
          - Calls `simulateRound()` with the current dealer (rotating dealer each round).
          - Logs a summary of each round's results.
          - Collects all `RoundResult` objects.
        - Determines player(s) with the highest score as winner(s).
        - Logs final scores and winner(s).
        - Returns a `GameResult` object containing all round results, final scores, and winner ID(s).
      - Tested in `lib/game/game.test.ts` to ensure a full game completes, results are structurally sound, scores accumulate correctly, and a winner is declared.

5.  **Database Schema and Integration - Phase 1:**

    - Define PostgreSQL schema extensions using Drizzle for:
      - `GameSessions` (ID, status, current_round, trump_suit)
      - `GamePlayers` (linking users to game sessions, player_order, current_score)
      - `PlayerBids` (per round, per player)
      - `PlayedTricks` (trick_number, lead_suit, winning_card, winning_player)
      - `PlayerCards` (cards in hand, cards played)
    - Write basic CRUD operations for creating a new game session and adding players.

    **Implementation Details (Step 5):**

    - Added new table definitions to `lib/db/schema.ts`:
      - `gameSessions`: Stores overall game state (ID, status, current_round, trump_suit).
      - `gamePlayers`: Links users to game sessions, stores player order and current score.
      - `playerBids`: Records bids made by players for each round.
      - `playedTricks`: Stores information about each trick (ID, game session, round, lead suit, winner).
      - `playedCardsInTricks`: Records each card played within a trick, linking to the trick, player, and card details.
    - Defined relations between these new tables and existing tables (like `users`) in `lib/db/schema.ts`.
    - Added corresponding `*.$inferSelect` and `*.$inferInsert` types for each new table.
    - Created `lib/db/game-queries.ts` to house database operations for game logic:
      - `createGameSession()`: Inserts a new record into `gameSessions` and returns it.
      - `addPlayerToGameSession(gameSessionId, userId)`: Adds a player to a game. Validates user existence, session status ('pending'), and max player count (4). Assigns `playerOrder` sequentially. Handles cases where a player tries to join a full game or a game they are already in.
      - `getGameSessionWithPlayers(gameSessionId)`: Retrieves a game session along with its associated players using Drizzle's relational queries.
    - Generated and applied database migrations using `pnpm db:generate` and `pnpm db:migrate`.
      - Resolved a migration conflict related to an unexpected `ALTER TABLE "teams" DROP COLUMN "club_id";` statement by commenting it out in the generated migration file (`lib/db/migrations/0001_neat_scarlet_spider.sql`).
    - Created `lib/db/test-game-queries.ts` to unit test the CRUD operations. This script:
      - Creates test users.
      - Calls `createGameSession` and `addPlayerToGameSession` for various scenarios (adding 4 players, attempting to add a 5th, adding a non-existent user, re-adding an existing user to a full game, and re-adding an existing user to a non-full game).
      - Uses `getGameSessionWithPlayers` to verify results.
      - All tests passed, confirming the DB operations function as designed.

6.  **Frontend - New Landing Page Implementation:**

    - **Logged Out View (`/`):**
      - Display sign-in and sign-up options.
    - **Logged In View (`/`):**
      - Placeholder for list of open games.
      - "Create New Game" button (initially logs to console or triggers a basic backend action).

    **Implementation Details (Step 6):**

    - Modified `app/page.tsx` (root Server Component) to handle the landing page logic:
      - It fetches the current user's full details using `getUser()` from `@/lib/db/queries` (instead of just `getSession()` which only provides user ID).
      - If the user is **not authenticated** (`user` is null):
        - It displays sign-in and sign-up links (this part was largely existing and correct).
      - If the user is **authenticated** (`user` object is present):
        - It renders a new Client Component: `components/authenticated-landing-content.tsx`.
    - Created `components/authenticated-landing-content.tsx` (Client Component marked with `'use client'`):
      - Takes the `user` object as a prop.
      - Displays a welcome message (e.g., "Welcome back, {user.name}!").
      - Shows a placeholder section for "Open Games".
      - Includes a "Create New Game" button.
      - The `onClick` handler for "Create New Game" is implemented within this Client Component to correctly log user details to the browser's console. This resolved a client-side hydration error that occurred when the button and its `onClick` were directly in the Server Component `app/page.tsx`.

7.  **Backend - Game Session Management API:**

    - API endpoint to create a new game session (persists to DB).
    - API endpoint for players to join an open game session.
    - API endpoint to list open game sessions.

8.  **Integrating Core Game Logic with Backend - Phase 1 (Game Setup):**

    - **Goal:** When a 4th player joins a 'pending' game, automatically initialize the game state, deal cards, and update the database.
    - **Implementation Details:**
      - Modified `addPlayerToGameSession` in `lib/db/game-queries.ts`:
        - Wrapped the core logic in a Drizzle database transaction (`db.transaction`) to ensure atomicity.
        - After successfully adding a player, if the session now has 4 players and its status is 'pending', it calls a new private helper function `initializeNewGame`.
      - Created `initializeNewGame(tx, gameSessionId, players, currentSession)` function within `lib/db/game-queries.ts`:
        - This function operates within the provided database transaction (`tx`).
        - **Updates `game_sessions` table:**
          - Sets `status` to 'active'.
          - Sets `current_round` to 1.
          - Calls `getTrumpSuit()` (from `lib/game/round.ts`) to determine the trump for round 1 and stores it in `trump_suit`.
          - Randomly selects one of the 4 `GamePlayer` records as the dealer for the current round and stores its ID in `current_dealer_id`.
          - Determines the starting player (player to the left of the dealer, based on `player_order`) and stores their `GamePlayer` ID in `current_turn_game_player_id`.
          - Updates `updated_at`.
        - **Initializes Deck and Deals Cards for Round 1:**
          - Creates a new `Deck` instance (from `lib/game/deck.ts`) and shuffles it.
          - Determines the number of cards to deal for round 1 using `ROUND_DISTRIBUTION[0]` (from `lib/game/round.ts`).
          - For each of the 4 `GamePlayer`s:
            - Deals the requisite number of cards using `deck.dealCards()`.
            - Prepares `NewPlayerRoundHand` objects for these cards.
          - Inserts all dealt cards for all players into the `player_round_hands` table (linking to `game_player_id`, `game_session_id`, and `round_number`).
        - Logs success or errors during initialization. If an error occurs, it returns `false`, causing the parent transaction in `addPlayerToGameSession` to roll back.
      - **Schema Changes Implemented (and migrated):**
        - Added `player_round_hands` table: `id`, `game_player_id`, `game_session_id`, `round_number`, `card_suit`, `card_rank`.
        - Added `current_dealer_id` (FK to `game_players.id`) to `game_sessions` table.
        - Added `current_turn_game_player_id` (FK to `game_players.id`) to `game_sessions` table.
        - Updated relations in `schema.ts` for these new tables/fields.
      - **Imports:** Added necessary imports for game logic (`Deck`, `Card`, `Suit`, `ROUND_DISTRIBUTION`, `getTrumpSuit`) and Drizzle types (`Transaction`) into `lib/db/game-queries.ts`.
      - **Type Safety:** Addressed linter errors by correcting import paths, method names (`dealCards`), type annotations (e.g., for `card` in `forEach`, transaction object `tx`), and ensuring return types of `getGameSessionWithPlayers` and `getOpenGameSessions` are explicitly constructed.

9.  **Frontend - Game Lobby/Waiting Room UI:**

    - **Goal:** Create a lobby page where players wait for a game to start, then navigate them to the actual game page upon game start.
    - **Implementation:**
      - Created `app/game/[gameId]/lobby/page.tsx` as a Client Component.
        - Fetches game lobby information (game details, list of players with names) using the `getGameLobbyInfoAction` server action.
        - Displays game status, current players, and waits for 4 players.
        - Implements polling (`setInterval`) to refresh lobby data periodically when the game status is 'pending'.
        - Uses `useEffect` to monitor the game status. When the status changes to 'active' (indicating the 4th player has joined and the backend has initialized the game), it automatically navigates the user to `/game/[gameId]` using `next/navigation`'s `useRouter`.
      - **Notifications:**
        - Integrated `sonner` for toast notifications (replacing the previously attempted `shadcn/ui toast`).
        - Added `SonnerToaster` to `app/layout.tsx`.
        - The lobby page uses `toast.success()` for game start notifications and `toast.error()` for displaying errors during lobby data fetching.
      - **Server Action Call Fix:**
        - Resolved a client-side TypeScript error ("Expected 2 arguments, but got 1") when programmatically calling server actions wrapped with the custom `validatedActionWithUser` HOC. The fix involved passing `null` as the first argument (for `prevState`) and a manually constructed `FormData` object as the second argument to align with the HOC's expected signature: `(prevState: ActionState, formData: FormData)`.
      - **Navigation from Landing Page:**
        - Updated `components/authenticated-landing-content.tsx`:
          - After successfully creating a new game, users are now automatically navigated to `/game/[newGameSessionId]/lobby`.
          - After successfully joining an existing game, users are now automatically navigated to `/game/[gameSessionId]/lobby`.
    - **Testing:**
      - Manually tested the flow:
        - Creating a game successfully navigates to the lobby.
        - Joining a game successfully navigates to the lobby.
        - Multiple users joining the same lobby are displayed correctly.
        - When the 4th player joins, all players in the lobby are automatically navigated to the (currently 404) game page (e.g., `/game/[gameId]`).
        - Sonner toasts appear for game start and error conditions.

10. **Frontend - Main Game Page UI - Phase 1 (Display Only):**

    - **Goal:** Create the main game page (`app/game/[gameId]/page.tsx`) to display the current game state.
    - **Implementation:**
      - Created `app/game/[gameId]/page.tsx` as a Client Component.
      - \*\*Server Action (`getGameStateAction` in `app/game/actions.ts`):
        - Fetches detailed game state for a given `gameId` and authenticates the user.
        - Retrieves core game session data (status, current round, trump suit, dealer ID, turn player ID).
        - Fetches all `gamePlayers` associated with the session, including their `user` details (ID, name, email) and `playerOrder`, `currentScore`.
        - For the currently authenticated user, fetches their cards for the current round from `playerRoundHands`.
        - Fetches bids for all players in the current game for the current round from `playerBids`. (Note: Current implementation filters bids from all round bids; optimization to add `game_session_id` to `playerBids` or use a join is pending).
        - Returns a `gameState` object containing all the above, with the current player's hand included only for them.
      - \*\*Client-Side (`app/game/[gameId]/page.tsx`):
        - Defines client-side interfaces (`Card`, `PlayerInGame`, `GameStateForClient`) to match the data structure from `getGameStateAction`.
        - On mount, calls `getGameStateAction` to fetch initial game state.
        - Displays key game information: Game ID, status, current round, trump suit, current dealer's name, current turn player's name.
        - Indicates if it's the current user's turn.
        - Lists all players, showing for each: name, email, current score, and bid for the current round (initially null/waiting).
        - For the currently authenticated user, displays their hand of cards (e.g., "JACKS" for Jack of Spades, or "7H" for 7 of Hearts, etc.).
        - Implements basic polling using `setInterval` and `useEffect` to periodically call `getGameStateAction` and refresh the displayed state if the game status is 'active'.
        - Handles loading and error states, displaying appropriate messages and toast notifications (using Sonner).
        - Includes buttons for manual refresh and navigation back to the landing page.
    - **Testing:**
      - Verified that after 4 players join a lobby, they are redirected to the game page.
      - Confirmed the game page loads and displays initial game state correctly (round 1, correct trump, dealer, turn, player list with emails and scores, and the current user's single card for round 1).
      - Resolved a `PostgresError: sorry, too many clients already` by restarting Postgres and the dev server.
      - Resolved a Drizzle query error (`TypeError: Cannot read properties of undefined (reading 'referencedTable')`) by correcting the relation name from `players` to `gamePlayers` in `getGameStateAction`.
      - Resolved a display issue for emails with a hard browser refresh.

11. **Real-time Communication Setup (e.g., WebSockets with Socket.IO) (Completed):**

    - Establish WebSocket connection using **Socket.IO** between client and server for a game session.

    **Implementation Details (Step 11):**

    - **Server-Side (`server.ts`):**
      - Integrated Socket.IO with the Next.js custom server.
      - Handles `connection`, `disconnect`, `joinGameRoom`, and `submitBid` events.
      - `joinGameRoom`: Allows clients to join a room specific to their `gameId`.
      - `submitBid`:
        - Receives `gameId`, `gamePlayerId`, and `bidAmount` from the client.
        - Validates the bid (e.g., user is the current turn player, bid is valid for the round).
        - Stores the bid in the `player_bids` table using `db.insert().values(...)`.
        - Determines the next player to bid based on `playerOrder`.
        - Updates `current_turn_game_player_id` in the `game_sessions` table.
        - If all players have bid, updates the game status (e.g., to 'active_play' - to be implemented) or proceeds to the next phase.
        - Fetches the updated game state using a new function `getGameDataForBroadcast(gameId)`.
        - Broadcasts the new `gameStateUpdate` to all clients in the game room.
        - Emits `bidSuccess` to the submitting client or `actionError` on failure.
      - `getGameDataForBroadcast(gameId)` (in `server.ts`, calls DB queries):
        - Fetches game session details, all players with their user info, and current bids for the round.
        - **Crucially, this function was updated to fetch and include hand information for ALL players in the broadcasted `gameStateUpdate` to simplify client-side state management.** (This was a significant change to address UI inconsistencies).
        - Player names are derived (e.g., "Player 1") if not set in the user profile.
    - **Client-Side (`contexts/SocketContext.tsx` and `app/game/[gameId]/page.tsx`):**
      - `SocketContext`: Provides a shared Socket.IO client instance.
      - `app/game/[gameId]/page.tsx` (`GamePage`):
        - Establishes connection and joins the game room on mount using `socket.emit('joinGameRoom')`.
        - Listens for `gameStateUpdate`, `actionError`, and `bidSuccess` events.
        - `handleGameStateUpdate`: Updates the local `gameState` with the broadcasted data, triggering UI refresh.

12. **Real-time Card Play - UI and Server Logic (Completed)**

    - **Server-Side (`server.ts` - `playCard` event handler):**

      - **Card Play Reception & Initial Validation:**
        - Receives `gameId`, `gamePlayerId`, and `card` object from client.
        - Validates game session existence, `'active_play'` status, and if it's the player's turn.
        - Fetches the player's current hand (unplayed cards only) from `playerRoundHands`.
      - **Advanced Play Validation (using `lib/game/trick.ts`):**
        - Maps DB hand and played card to `OfflineCard` types.
        - Determines `leadSuitForTrick` by checking cards already played in the current trick from `playedCardsInTricks`.
        - Retrieves `currentTrumpSuit` from `gameSessions`.
        - Calls `isValidPlay(hand, cardToPlay, leadSuit, trumpSuit)` to enforce game rules (follow suit, must play trump if out of lead and has trump).
        - Returns an error to the client if the play is invalid.
      - **Recording Played Card:**
        - Updates the played card's record in `playerRoundHands` to `isPlayed: true`.
        - Finds or creates an entry in `playedTricks` for the current trick.
          - If it's the first card of the trick, sets `playedTricks.leadSuit`.
        - Inserts the played card into `playedCardsInTricks` with its `playSequenceInTrick`.
        - Updates `gameSessions.currentTrickLeadSuit` if it's the first card of the trick.
      - **Trick Completion Logic:**
        - Checks if all players have played for the current trick.
        - If trick is over:
          - Determines trick winner using `determineTrickWinner()` from `lib/game/trick.ts` (maps DB cards to `OfflinePlayedCard[]`, handles `trumpSuit` and `leadSuit`).
          - Updates `playedTricks.winningGamePlayerId`.
          - Increments `gamePlayers.currentRoundTricksTaken` for the winner.
          - Sets the next turn (`gameSessions.currentTurnGamePlayerId`) to the trick winner.
          - Increments `gameSessions.currentTrickNumberInRound`.
          - Resets `gameSessions.currentTrickLeadSuit` to `null`.
      - **Turn Advancement (Mid-Trick):**
        - If trick is not over, advances `gameSessions.currentTurnGamePlayerId` to the next player in order.
      - **Round Completion & Next Round Preparation (integrated with `playCard`):**
        - Detects end of a round based on `currentTrickNumberInRound` and `ROUND_DISTRIBUTION`.
        - **Scoring:**
          - For each player, fetches their bid for the round from `playerBids`.
          - Calculates score using `calculatePlayerScore()` from `lib/game/game.ts`.
          - Updates `gamePlayers.currentScore`.
          - Resets `gamePlayers.currentRoundTricksTaken` to 0.
        - **Next Round Setup (if not game over):**
          - Increments `gameSessions.currentRound`.
          - Resets `gameSessions.currentTrickNumberInRound` to 1.
          - Sets `gameSessions.status` to `'bidding'`.
          - Determines and sets `gameSessions.trumpSuit` for the _new_ round using `determineTrumpForNewRound()` (from `lib/game/round.ts`).
          - Rotates dealer (`gameSessions.currentDealerId`).
          - Sets `gameSessions.currentTurnGamePlayerId` to the player left of the new dealer.
          - Calls `dealCardsForRound()` helper function:
            - Deletes old hands for the completed round from `playerRoundHands`.
            - Creates/shuffles a deck, deals cards for the new round based on `ROUND_DISTRIBUTION`.
            - Inserts new cards into `playerRoundHands` with `isPlayed: false`.
        - **Game Over Logic:**
          - If all rounds (`ROUND_DISTRIBUTION.length`) are completed:
            - Sets `gameSessions.status` to `'finished'`.
            - Determines game winner by finding the player with the highest `currentScore` (tie-broken by `playerOrder`).
            - Updates `gameSessions.winnerGamePlayerId`.
      - **Broadcasting Updates:**
        - After bid submission, card play, or game state change, calls `getGameDataForBroadcast()`.
        - `getGameDataForBroadcast()`:
          - Fetches comprehensive game state (session details, players with emails/orders/scores/bids).
          - Fetches current player hands (excluding cards with `isPlayed: true`).
          - Fetches cards played in the current trick (`playedCardsInTricks`) and includes them as `currentTrickPlays` (with player name, card, sequence).
          - Emits `'gameStateUpdate'` via Socket.IO to the game room.
      - **Refactorings:**
        - Leveraged offline logic: `calculatePlayerScore`, `determineTrickWinner`, `isValidPlay`.
        - Introduced `dealCardsForRound` helper.

    - **Client-Side (`app/game/[gameId]/page.tsx`):**

      - **Displaying Player Hand:**
        - Renders cards from `meAsPlayer.hand`.
        - Cards are `Button` components.
        - Click handler `handlePlayCard` emits `'playCard'` socket event with `gameId`, `gamePlayerId`, and `card` details.
        - Buttons are disabled if not player's turn or game not in `'active_play'`.
        - Hand display correctly updates to remove played cards (due to server filtering `isPlayed: true` cards).
      - **Displaying Current Trick:**
        - Added `currentTrickPlays` to `GameStateForClient` interface.
        - Renders cards from `gameState.currentTrickPlays`, showing player name and card.
        - Updates dynamically as cards are played in the trick.
      - **Turn Indication:** Clearly indicates whose turn it is.
      - **Error Handling:** Displays errors received from server (e.g., invalid play).
      - **State Synchronization:**
        - Receives `gameStateUpdate` from server socket.
        - Updates local `gameState` state, triggering UI re-renders.
        - Includes logic for identifying the current user (`clientSideUserId`) from `requestingUserId` provided by server actions.

    - **Debugging & Refinements:**
      - Addressed linter errors related to types and imports during refactoring.
      - Implemented detailed logging on both client and server for diagnosing issues with trump suit determination, hand visibility, and play validation, which helped resolve intermittent player-specific UI bugs. Log levels were subsequently reduced.
      - Investigated and resolved an issue where the game would not show the round summary or progress to the next round. This was due to `roundSummaryData` being empty because `playerRoundScoreChanges` records were not being created when a round ended. Fixed by ensuring `playerRoundScoreChanges` are inserted within the `playCard` transaction at the end of each round.
      - Confirmed via logging that the server-side logic for determining round completion (`if (gameSessionUpdateData.currentTrickNumberInRound! > numTricksExpectedThisRound)`) and for advancing to the next round via `proceedToNextRound` event (incrementing `currentRound`, resetting `currentTrickNumberInRound` to 1) is functioning as expected.

13. **Database Integration - Phase 2 (Full Game State):**

    - Persist all player actions, bids, trick outcomes, and scores to the database as they happen or at round/game end. (Largely complete through previous steps).
    - Ensure game state can be resumed if needed (advanced). (Current DB-centric design is a strong foundation; further testing needed).
    - **To Do for Step 13:**
      - **Enhance `playerRoundScoreChanges` Table:**
        - Add a `tricks_taken` (integer) column to store the number of tricks the player actually won that round.
        - Update Drizzle schema, generate and apply migration.
        - Modify the `playCard` handler in `server.ts` to populate this new `tricks_taken` field when inserting into `playerRoundScoreChanges`.
      - **Investigate and fix client-side `SyntaxError: Unexpected end of JSON input` error** occurring on game pages (e.g., `/game/34`). This likely involves checking server action responses (especially error paths) and how the client handles them. (Moved from general debugging to a specific task).

14. **User Dashboard Enhancements:**

    - Display user's game history (linked from game sessions in DB).
    - Show past scores and rankings.

15. **Refinement, Testing, and UI Polish:**
    - Thorough end-to-end testing of multiplayer gameplay.
    - Improve UI/UX based on playtesting.
    - Handle disconnections, errors, and edge cases.
    - Ensure responsive design.

This structured approach should allow for continuous testing and integration, making the development process more manageable.
