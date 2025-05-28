import { db } from './drizzle';
import { gameSessions, gamePlayers, NewGameSession, NewGamePlayer, users, GameSession, GamePlayer, playerRoundHands, NewPlayerRoundHand, User } from './schema';
import { eq, and, sql, desc, count } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core'; // For transaction type
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'; // For transaction type
import type * as schema from './schema'; // For transaction type schema
import type { ExtractTablesWithRelations } from 'drizzle-orm'; // For transaction type schema

// Game Logic Imports
import { Deck, type Card, type Suit } from '../game/deck';
import { ROUND_DISTRIBUTION, getTrumpSuit } from '../game/round'; // Corrected: getTrumpSuit is from round.ts

// Define GAME_THEMES and getRandomGameTheme()
const GAME_THEMES = [
  { name: 'Liverpool Lockdown', image_url: '/images/cities/liverpool_sw.png' },
  { name: 'Strasbourg Showdown', image_url: '/images/cities/strasbourg_sw.png' },
  { name: 'Istanbul Inferno', image_url: '/images/cities/istanbul_sw.png' },
  { name: 'Berlin Brawl', image_url: '/images/cities/berlin_sw.png' },
  { name: 'Lisbon Legends', image_url: '/images/cities/lisbon_sw.png' },
  { name: 'Ghent Gauntlet', image_url: '/images/cities/ghent_sw.png' },
  { name: 'Prague Pummel', image_url: '/images/cities/prague_sw.png' },
  { name: 'Dubrovnik Duel', image_url: '/images/cities/dubrovnik_sw.png' },
  { name: 'Naples Nemesis', image_url: '/images/cities/naples_sw.png' },
  { name: 'Vienna Vortex', image_url: '/images/cities/vienna_sw.png' },
];

function getRandomGameTheme() {
  return GAME_THEMES[Math.floor(Math.random() * GAME_THEMES.length)];
}

// Define a more specific transaction type
type Transaction = PgTransaction<PostgresJsQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>;

/**
 * Creates a new game session.
 * @returns The newly created game session.
 */
export async function createGameSession(): Promise<GameSession> {
  const theme = getRandomGameTheme();
  console.log("[game-queries.ts] Creating game with theme:", theme); // Verify theme and image_url
  const [newSession] = await db
    .insert(gameSessions)
    .values({
      name: theme.name,
      image_url: theme.image_url,
      // Defaults will be used for status, currentRound, createdAt, updatedAt
    })
    .returning();
  return newSession;
}

/**
 * Adds a player to a game session.
 * Validates if the user exists and if the game session can accept more players (max 4).
 * Assigns player order based on the number of players already in the session.
 * If adding the player makes the game full (4 players), it initializes the game.
 *
 * @param gameSessionId The ID of the game session to join.
 * @param userId The ID of the user joining the game.
 * @returns The newly created game player record, or null if the user/session is invalid or game is full before this player.
 */
export async function addPlayerToGameSession(gameSessionId: number, userId: number): Promise<GamePlayer | null> {
  // 1. Verify user exists
  const userExists = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!userExists || userExists.length === 0) {
    console.error(`User with id ${userId} not found.`);
    return null;
  }

  const result = await db.transaction(async (tx: Transaction) => {
    const currentSessionDetails = await tx.select().from(gameSessions).where(eq(gameSessions.id, gameSessionId)).for('update').limit(1);
    if (!currentSessionDetails || currentSessionDetails.length === 0) {
      console.error(`Game session with id ${gameSessionId} not found.`);
      return null; 
    }
    const currentSession = currentSessionDetails[0];

    if (currentSession.status !== 'pending') {
      console.warn(`Game session ${gameSessionId} is not pending, cannot add players.`);
      return null; 
    }

    const playersInSessionBeforeAdd = await tx.select().from(gamePlayers).where(eq(gamePlayers.gameSessionId, gameSessionId)).orderBy(gamePlayers.playerOrder);

    if (playersInSessionBeforeAdd.length >= 4) {
      console.warn(`Game session ${gameSessionId} is full. Cannot add more players.`);
      return null; 
    }

    const playerAlreadyJoined = playersInSessionBeforeAdd.find((p: GamePlayer) => p.userId === userId);
    if (playerAlreadyJoined) {
      console.warn(`User ${userId} is already in game session ${gameSessionId}.`);
      return null; 
    }

    const playerOrder = playersInSessionBeforeAdd.length;
    const newPlayer: NewGamePlayer = { gameSessionId, userId, playerOrder };
    const [addedPlayer] = await tx.insert(gamePlayers).values(newPlayer).returning();

    if (!addedPlayer) {
      console.error("Failed to add player to session.");
      return null; 
    }
    
    const playersInSessionAfterAdd = [...playersInSessionBeforeAdd, addedPlayer].sort((a,b) => a.playerOrder - b.playerOrder);

    if (playersInSessionAfterAdd.length === 4 && currentSession.status === 'pending') {
      const gameStarted = await initializeNewGame(tx as Transaction, gameSessionId, playersInSessionAfterAdd, currentSession);
      if (!gameStarted) {
        console.error(`Failed to initialize game ${gameSessionId}. Rolling back player add.`);
        return null; 
      }
    }
    return addedPlayer; 
  });

  return result;
}

/**
 * Initializes a new game when 4 players have joined.
 * Updates game status, sets up round 1 (trump, dealer), deals cards.
 * This function expects to be called within a transaction.
 * 
 * @param tx The Drizzle transaction object.
 * @param gameSessionId The ID of the game session.
 * @param players The array of 4 GamePlayer objects in the session.
 * @param currentSession The current state of the game session.
 * @returns True if initialization was successful, false otherwise.
 */
async function initializeNewGame(
  tx: Transaction, 
  gameSessionId: number, 
  players: GamePlayer[],
  currentSession: GameSession
): Promise<boolean> {
  console.log(`Initializing game ${gameSessionId} for ${players.length} players to start bidding phase.`);
  if (players.length !== 4) {
    console.error("Cannot initialize game: requires exactly 4 players.");
    return false;
  }

  try {
    const roundNumber = 1;
    const initialTrumpSuit = getTrumpSuit();
    const dealerIndex = Math.floor(Math.random() * 4);
    const dealerGamePlayer = players[dealerIndex];
    const dealerId = dealerGamePlayer.id;
    const startingPlayerOrder = (dealerGamePlayer.playerOrder + 1) % 4;
    const startingPlayer = players.find(p => p.playerOrder === startingPlayerOrder);
    if (!startingPlayer) {
      console.error("Could not determine starting player for bidding.");
      return false;
    }
    const currentTurnGamePlayerId = startingPlayer.id;

    await tx.update(gameSessions).set({
        status: 'bidding',
        currentRound: roundNumber,
        trumpSuit: initialTrumpSuit,
        currentDealerId: dealerId,
        currentTurnGamePlayerId: currentTurnGamePlayerId,
        updatedAt: new Date(), 
      }).where(eq(gameSessions.id, gameSessionId));

    console.log(`Game ${gameSessionId} set to BIDDING. Round ${roundNumber}, Trump: ${initialTrumpSuit}, Dealer: GP ID ${dealerId}, First to Bid: GP ID ${currentTurnGamePlayerId}`);

    const deck = new Deck();
    deck.shuffle();
    const cardsToDeal = ROUND_DISTRIBUTION[roundNumber - 1];
    if (!cardsToDeal) {
      console.error(`Invalid round number ${roundNumber} resulted in no cards to deal from ROUND_DISTRIBUTION.`);
      return false;
    }

    const allHands: NewPlayerRoundHand[] = [];
    for (const player of players) {
      const hand = deck.dealCards(cardsToDeal);
      if (hand.length !== cardsToDeal) {
        console.error(`Deck ran out of cards while dealing to player ${player.id}.`);
        return false;
      }
      hand.forEach((card: Card) => { 
        allHands.push({ gamePlayerId: player.id, gameSessionId: gameSessionId, roundNumber: roundNumber, cardSuit: card.suit, cardRank: card.rank });
      });
    }

    if (allHands.length !== players.length * cardsToDeal) {
        console.error("Mismatch in total cards prepared for database insert.");
        return false;
    }
    
    await tx.insert(playerRoundHands).values(allHands);

    return true;
  } catch (error) {
    console.error(`Error during game initialization for session ${gameSessionId}:`, error);
    return false; 
  }
}

/**
 * Retrieves a game session by its ID, including its players.
 * @param gameSessionId The ID of the game session.
 * @returns The game session with players, or null if not found.
 */
export async function getGameSessionWithPlayers(gameSessionId: number): Promise<(GameSession & { players: GamePlayer[] }) | null> {
  const sessionResult = await db.query.gameSessions.findFirst({
    where: eq(gameSessions.id, gameSessionId),
    with: {
      gamePlayers: true,
    },
  });

  if (!sessionResult) {
    return null;
  }
  // Ensure the return type matches the promise
  const gameSessionWithPlayers: GameSession & { players: GamePlayer[] } = {
    ...sessionResult,
    players: sessionResult.gamePlayers as GamePlayer[], // Cast if necessary, though `with` should provide typed players
  };
  return gameSessionWithPlayers;
}

/**
 * Retrieves a list of open game sessions for the lobby.
 * Fetches the last 3 pending games, ordered by creation date (newest first).
 * Includes game name, image_url, host name, and current player count.
 */
export async function getOpenGameSessionsForLobby(): Promise<(Pick<GameSession, 'id' | 'name' | 'image_url' | 'createdAt'> & { playerCount: number; hostName: string | null })[]> {
  const result = await db
    .select({
      id: gameSessions.id,
      name: gameSessions.name,
      image_url: gameSessions.image_url,
      createdAt: gameSessions.createdAt,
      playerCount: count(gamePlayers.id),
      hostName: users.name, // Directly select host name
    })
    .from(gameSessions)
    .leftJoin(gamePlayers, eq(gameSessions.id, gamePlayers.gameSessionId))
    .leftJoin(users, and(eq(gamePlayers.userId, users.id), eq(gamePlayers.playerOrder, 0))) // Join users table for the host (playerOrder = 0)
    .where(eq(gameSessions.status, 'pending'))
    .groupBy(gameSessions.id, users.name) // Group by gameSession.id and users.name (for host)
    .orderBy(desc(gameSessions.createdAt))
    .limit(3);

  // The query above might return multiple rows per game session if we don't handle the host correctly in the group by or selection.
  // A more robust way for host, or if host is not necessarily playerOrder 0 (e.g. a creator_id field on gameSessions):
  // 1. Fetch pending sessions
  // 2. For each session, separately query its players to find the host and count players.

  // Simplified approach based on the direct join and groupBy (assuming host is playerOrder 0 and users.name is sufficient)
  // We need to ensure playerCount is accurate if there are games with 0 players yet.
  // The above query structure with leftJoin and count should handle 0 players correctly for playerCount.
  // However, selecting hostName like that might be problematic if a game has 0 players (users.name would be null).
  // Let's refine to ensure correct player count and host retrieval.

  const sessionsWithDetails = await db.query.gameSessions.findMany({
    where: eq(gameSessions.status, 'pending'),
    orderBy: [desc(gameSessions.createdAt)],
    limit: 3,
    with: {
      gamePlayers: {
        with: {
          user: {
            columns: {
              name: true,
            },
          },
        },
        orderBy: (gamePlayers, { asc }) => [asc(gamePlayers.playerOrder)],
      },
    },
  });

  return sessionsWithDetails.map((session) => {
    console.log("[game-queries.ts] Raw session from DB for lobby:", JSON.stringify(session, null, 2)); // Log raw session
    const hostPlayer = session.gamePlayers.find(gp => gp.playerOrder === 0);
    return {
      id: session.id,
      name: session.name,
      image_url: session.image_url,
      createdAt: session.createdAt,
      playerCount: session.gamePlayers.length,
      hostName: hostPlayer?.user?.name ?? 'Waiting for host...',
    };
  });
}

// The old getOpenGameSessions function has been removed as it was replaced by getOpenGameSessionsForLobby 