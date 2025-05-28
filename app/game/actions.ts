'use server';

import { z } from 'zod';
import { db } from '@/lib/db/drizzle';
import { gameSessions, users, playerRoundHands, playerBids, gamePlayers, type GameSession, type User, type GamePlayer as DbGamePlayer } from '@/lib/db/schema';
import { createGameSession, addPlayerToGameSession, getGameSessionWithPlayers, getOpenGameSessionsForLobby } from '@/lib/db/game-queries';
import { validatedActionWithUser } from '@/lib/auth/middleware';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { eq, and, asc, desc } from 'drizzle-orm';

// No schema needed for just creating a game, user context is enough
export const createNewGameAction = validatedActionWithUser(
  z.object({}), // Empty schema, as no input is taken from the client directly for this action
  async (_data, _formData, user) => {
    if (!user) {
      // This case should ideally be handled by validatedActionWithUser already which throws an error
      return { error: 'Gebruiker niet gevonden of niet geauthenticeerd.' };
    }

    try {
      const newGameSession = await createGameSession();
      if (!newGameSession || !newGameSession.id) {
        return { error: 'Aanmaken nieuwe spelsessie in DB mislukt.' };
      }

      // Automatically add the creator as the first player
      const gamePlayer = await addPlayerToGameSession(newGameSession.id, user.id);
      if (!gamePlayer) {
        // TODO: Handle potential rollback or cleanup if adding player fails after session creation
        return { error: 'Spelsessie aangemaakt, maar toevoegen maker als speler mislukt.' };
      }

      return { success: "Spel succesvol aangemaakt!", gameSessionId: newGameSession.id };

    } catch (error) {
      console.error('Error in createNewGameAction:', error);
      return { error: 'Onverwachte fout bij aanmaken van het spel.' };
    }
  }
);

// Define the type for the game object returned by getOpenGameSessionsForLobby
interface OpenGameForLobby {
  id: number;
  name: string | null;
  image_url: string | null;
  createdAt: Date; // This is a Date before toISOString()
  playerCount: number;
  hostName: string | null;
}

export async function listOpenGamesAction() {
  try {
    // Call the new query function
    const openGames: OpenGameForLobby[] = await getOpenGameSessionsForLobby(); 
    
    const serializableOpenGames = openGames.map(game => ({
      id: game.id,
      name: game.name,
      imageUrl: game.image_url,
      hostName: game.hostName,
      playerCount: game.playerCount,
      createdAt: game.createdAt.toISOString(),
    }));

    return { success: true, games: serializableOpenGames };
  } catch (error) {
    console.error('Error in listOpenGamesAction:', error);
    return { error: 'Ophalen open spellen mislukt.', games: [] };
  }
}

// Implemented join game logic
const joinGameSchema = z.object({
  gameSessionId: z.coerce.number().int().positive(),
});

export const joinGameAction = validatedActionWithUser(
  joinGameSchema,
  async (data, _formData, user) => {
    if (!user) {
      // This should be caught by validatedActionWithUser, but as a fallback:
      return { error: 'Gebruiker niet gevonden of niet geauthenticeerd.' };
    }
    
    const { gameSessionId } = data;

    try {
      const gamePlayer = await addPlayerToGameSession(gameSessionId, user.id);

      if (gamePlayer) {
        // Player successfully added or was already in the game (and game wasn't full)
        //console.log(`User ${user.id} successfully joined/was in game ${gameSessionId}. Player ID: ${gamePlayer.id}`);
        // revalidatePath('/'); // To refresh the list of open games on the landing page
        return { success: `Succesvol deelgenomen aan spel ${gameSessionId}!`, gameSessionId: gameSessionId };
      } else {
        // addPlayerToGameSession returns null if user cannot be added.
        // We need to determine the reason. The function addPlayerToGameSession itself logs reasons like "game full" or "user not found".
        // For the client, a generic message or more specific state might be needed if addPlayerToGameSession is refactored to return reasons.
        // For now, we assume the console logs in addPlayerToGameSession provide debug info.
        return { error: `Deelnemen aan spel ${gameSessionId} mislukt. Het is mogelijk vol, niet gevonden, of je bent al deelnemer.` };
      }
    } catch (error) {
      console.error(`Error in joinGameAction for game ${gameSessionId} and user ${user.id}:`, error);
      return { error: 'Onverwachte fout bij poging tot deelnemen aan het spel.' };
    }
  }
);

const getGameLobbyInfoSchema = z.object({
  gameId: z.coerce.number().int().positive(),
});

export const getGameLobbyInfoAction = validatedActionWithUser(
  getGameLobbyInfoSchema,
  async (data, _formData, user) => {
    if (!user) {
      return { error: 'Gebruiker niet geauthenticeerd.' };
    }

    const { gameId } = data;

    try {
      const gameDetails = await getGameSessionWithPlayers(gameId);

      if (!gameDetails) {
        return { error: `Spelsessie met ID ${gameId} niet gevonden.` };
      }

      const playersWithNames = await Promise.all(gameDetails.players.map(async (player: DbGamePlayer) => {
        const playerUser = await db.query.users.findFirst({ where: eq(users.id, player.userId), columns: { name: true } });
        return {
          ...player,
          userName: playerUser?.name || `Speler ${player.playerOrder + 1}`
        };
      }));


      return {
        success: true,
        gameLobbyInfo: {
          id: gameDetails.id,
          name: gameDetails.name,
          status: gameDetails.status,
          currentRound: gameDetails.currentRound,
          trumpSuit: gameDetails.trumpSuit,
          createdAt: gameDetails.createdAt.toISOString(),
          updatedAt: gameDetails.updatedAt.toISOString(),
          currentDealerId: gameDetails.currentDealerId,
          currentTurnGamePlayerId: gameDetails.currentTurnGamePlayerId,
          players: playersWithNames, 
        },
      };
    } catch (error) {
      console.error(`Error in getGameLobbyInfoAction for game ${gameId}:`, error);
      return { error: 'Onverwachte fout bij ophalen spellobby-informatie.' };
    }
  }
);

const getGameStateSchema = z.object({
  gameId: z.coerce.number().int().positive(),
});

// Define more specific types for the API response
interface Card {
  suit: string; // Consider using Suit enum/type from game logic if available and serializable
  rank: string; // Consider using Rank enum/type
}

interface PlayerInGame {
  id: number; // gamePlayerId
  userId: number;
  userName: string;
  userEmail: string;
  playerOrder: number;
  currentScore: number;
  currentBid: number | null;
  hand?: Card[]; // Only for the requesting user
}

interface GameStateForClient {
  id: number; // gameSessionId
  gameName: string | null;
  status: string;
  currentRound: number | null;
  trumpSuit: string | null;
  currentDealerId: number | null;
  currentTurnGamePlayerId: number | null;
  players: PlayerInGame[];
  requestingUserId?: number; // Added for client to identify itself
  currentTrickPlays?: { gamePlayerId: number; userName: string; cardSuit: string; cardRank: string; playSequenceInTrick: number }[];
  allCompletedTricksInCurrentRound?: Array<{
    trickNumberInRound: number;
    winningGamePlayerId: number;
    winnerName: string;
    cards: Array<{
        gamePlayerId: number;
        playerName: string;
        cardSuit: string;
        cardRank: string;
        playSequenceInTrick: number;
    }>;
  }>;
  roundSummaryData?: Array<{
    roundNumber: number;
    playerRoundDetails: Array<{
        gamePlayerId: number;
        playerName: string;
        scoreChange: number;
        cumulativeScoreAfterRound: number;
    }>;
  }>;
}

export const getGameStateAction = validatedActionWithUser(
  getGameStateSchema,
  async (data, _formData, user: User) => {
    // console.log("[getGameStateAction] Called with formData:", _formData.get('gameId')); // Commenting this out
    if (!user || typeof user.id === 'undefined') { 
      return { error: 'Gebruiker niet geauthenticeerd of gebruikers-ID ontbreekt.' };
    }

    const { gameId } = data;

    try {
      const gameSessionWithPlayers = await db.query.gameSessions.findFirst({
        columns: { // ADDED: Explicitly select columns for the session itself
          id: true,
          name: true, // Ensure game name is fetched
          status: true,
          currentRound: true,
          trumpSuit: true,
          currentDealerId: true,
          currentTurnGamePlayerId: true,
          currentTrickLeadSuit: true,
          currentTrickNumberInRound: true,
        },
        where: eq(gameSessions.id, gameId),
        with: {
          gamePlayers: {
            with: {
              user: { columns: { name: true, id: true, email: true } }, 
            },
            orderBy: [asc(gamePlayers.playerOrder)],
          },
        },
      });

      if (!gameSessionWithPlayers) {
        return { error: `Spelsessie met ID ${gameId} niet gevonden.` };
      }
      
      const playersInSession = gameSessionWithPlayers.gamePlayers as (DbGamePlayer & { user: {id: number; name: string | null; email: string}})[];

      if (gameSessionWithPlayers.status === 'pending') {
        return { error: 'Spel is nog in de lobby. Status nog niet beschikbaar.' };
      }
      
      if (gameSessionWithPlayers.status === 'finished' || gameSessionWithPlayers.status === 'archived') {
        return { error: 'Spel is beëindigd. Kan actieve spelstatus niet ophalen.' };
      }

      const currentPlayerAsGamePlayer = playersInSession.find(p => p.userId === user.id);
      if (!currentPlayerAsGamePlayer) {
        console.error(`[getGameStateAction] Authenticated user ${user.id} is not a player in game ${gameId}.`);
        return { error: 'Je bent geen speler in dit spel.' };
      }

      let currentPlayerHand: Card[] = [];
      if (gameSessionWithPlayers.currentRound !== null && gameSessionWithPlayers.currentRound > 0) {
        const handRecords = await db.query.playerRoundHands.findMany({
          where: and(
            eq(playerRoundHands.gamePlayerId, currentPlayerAsGamePlayer.id),
            eq(playerRoundHands.roundNumber, gameSessionWithPlayers.currentRound)
          ),
          columns: { cardSuit: true, cardRank: true }, // Select individual card properties
        });
        if (handRecords && handRecords.length > 0) {
            currentPlayerHand = handRecords.map(record => ({ suit: record.cardSuit, rank: record.cardRank })); 
        }
      }

      const playersForClient: PlayerInGame[] = playersInSession.map(p => ({
        id: p.id,
        userId: p.userId,
        userName: p.user.name || `Speler ${p.playerOrder + 1}`, // Ensure this uses Speler
        userEmail: p.user.email, 
        playerOrder: p.playerOrder,
        currentScore: p.currentScore,
        currentBid: null, 
        hand: p.userId === user.id ? currentPlayerHand : undefined, 
      }));

      // Fetch bids for all players for the current round if bidding or active_play
      if ((gameSessionWithPlayers.status === 'bidding' || gameSessionWithPlayers.status === 'active_play') && gameSessionWithPlayers.currentRound !== null) {
        const bidsForRound = await db.query.playerBids.findMany({
            where: and(
                eq(playerBids.gameSessionId, gameId),
                eq(playerBids.roundNumber, gameSessionWithPlayers.currentRound)
            ),
            columns: { gamePlayerId: true, bidAmount: true }
        });

        bidsForRound.forEach(bid => {
            const playerIndex = playersForClient.findIndex(pClient => pClient.id === bid.gamePlayerId);
            if (playerIndex !== -1) {
                playersForClient[playerIndex].currentBid = bid.bidAmount;
            }
        });
      }
      
      // Fetch current trick plays if in active_play status
      let currentTrickPlaysForClient: GameStateForClient['currentTrickPlays'] = [];
      if (gameSessionWithPlayers.status === 'active_play' && gameSessionWithPlayers.currentRound !== null) {
        // This assumes currentTrickPlays are stored and fetched appropriately for the current trick
        // For now, this is a placeholder as the server.ts logic handles trick construction dynamically
      }

      // Fetch completed tricks for the current round
      // This will be populated by server.ts logic when game state is broadcasted for now.
      let allCompletedTricksForClient: GameStateForClient['allCompletedTricksInCurrentRound'] = [];
      
      // Fetch round summary data
      // This will be populated by server.ts logic when game state is broadcasted for now.
      let roundSummaryDataForClient: GameStateForClient['roundSummaryData'] = [];

      const responseState: GameStateForClient = {
        id: gameSessionWithPlayers.id,
        gameName: gameSessionWithPlayers.name,
        status: gameSessionWithPlayers.status,
        currentRound: gameSessionWithPlayers.currentRound,
        trumpSuit: gameSessionWithPlayers.trumpSuit,
        currentDealerId: gameSessionWithPlayers.currentDealerId,
        currentTurnGamePlayerId: gameSessionWithPlayers.currentTurnGamePlayerId,
        players: playersForClient,
        requestingUserId: user.id,
        currentTrickPlays: currentTrickPlaysForClient,
        allCompletedTricksInCurrentRound: allCompletedTricksForClient,
        roundSummaryData: roundSummaryDataForClient
      };

      return { success: true, gameState: responseState };

    } catch (error) {
      console.error(`Error in getGameStateAction for game ${gameId} and user ${user.id}:`, error);
      return { error: 'Onverwachte fout bij ophalen gedetailleerde spelstatus.' };
    }
  }
);

const initiateBiddingSchema = z.object({
  gameId: z.coerce.number().int().positive(),
  roundNumber: z.coerce.number().int().min(1), // Ensure roundNumber is provided and valid
  gamePlayerId: z.coerce.number().int().positive(), // The gamePlayerId of the dealer initiating
});

export const initiateBiddingAction = validatedActionWithUser(
  initiateBiddingSchema,
  async (data, _formData, user) => {
    if (!user) {
      return { error: 'Gebruiker niet geauthenticeerd.' };
    }

    const { gameId, roundNumber, gamePlayerId } = data;

    try {
      const gameSession = await db.query.gameSessions.findFirst({
        where: eq(gameSessions.id, gameId),
        with: { gamePlayers: true }
      });

      if (!gameSession) {
        return { error: `Spelsessie met ID ${gameId} niet gevonden.` };
      }

      const dealerGamePlayer = gameSession.gamePlayers.find(gp => gp.id === gamePlayerId);
      if (!dealerGamePlayer || dealerGamePlayer.userId !== user.id) {
          return { error: 'Speler is niet de deler of actie niet toegestaan.'}
      }
      if (dealerGamePlayer.id !== gameSession.currentDealerId) {
        return { error: 'Speler is niet de huidige deler voor deze ronde.' };
      }

      if (gameSession.status !== 'bidding' || gameSession.currentRound !== roundNumber) {
        return { error: 'Kan bieden niet starten: Spel niet in correcte status of onjuist rondenummer.' };
      }

      // Further logic to actually deal cards and prepare for bidding might go here
      // For now, this action mainly serves to confirm the dealer is ready for bidding to start for the round
      // The actual transition to bidding might be handled by server.ts upon receiving bids
      // Or, we could update the game status here if this action truly initiates the dealing & bidding process.

      console.log(`[initiateBiddingAction] Dealer (User: ${user.id}, GP: ${gamePlayerId}) confirmed start of bidding for game ${gameId}, round ${roundNumber}.`);

      // This action might not directly change game state that needs immediate revalidation for THIS action
      // if the primary effect is handled by socket emissions in server.ts (e.g., upon first bid).
      // However, if it sets a flag or status, revalidate or emit.

      return { success: `Biedproces voor ronde ${roundNumber} is gestart.` };

    } catch (e) {
      console.error('Error in initiateBiddingAction:', e);
      return { error: 'Fout opgetreden bij starten van het bieden.' };
    }
  }
); 