import { createServer, IncomingMessage, ServerResponse } from 'http';
import { parse } from 'url';
import next from 'next';
import { Server as SocketIOServer, Socket } from 'socket.io';

// Drizzle and DB imports
import { db } from './lib/db/drizzle';
import * as schema from './lib/db/schema'; // Import all from schema
import { eq, and, sql, asc, desc, inArray, type InferSelectModel, type InferInsertModel } from 'drizzle-orm'; // Use asc and desc directly
import { ROUND_DISTRIBUTION } from './lib/game/round'; // For bid validation
import { getTrumpSuit as determineTrumpForNewRound } from './lib/game/round'; // For setting trump in new rounds
import { calculatePlayerScore } from './lib/game/game'; // Added for scoring
import { determineTrickWinner, type PlayedCard as OfflinePlayedCard, isValidPlay } from './lib/game/trick'; // Added for trick winner logic & validation
import type { Card as OfflineCard } from './lib/game/deck'; // Import Card directly from deck.ts

// Define the enum type for game status explicitly and correctly
type GameStatusEnum = "pending" | "active" | "bidding" | "active_play" | "round_over" | "finished" | "archived" | "round_summary";

// Timeout management for round_summary
const roundSummaryTimeouts = new Map<number, NodeJS.Timeout>();
const ROUND_SUMMARY_TIMEOUT_MS = 10000; // 10 seconds

const isProduction = process.env.NODE_ENV === 'production';
const dev = !isProduction; // For Next.js app initialization
const hostname = 'localhost'; // Or your desired hostname
const port = parseInt(process.env.PORT || '3001', 10);

// Initialize Next.js app properly for both dev and production
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// Helper function to deal cards for a new round
async function dealCardsForRound(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0], // Drizzle transaction type
  gameId: number,
  roundNumber: number, // The new round number for which to deal
  players: Pick<schema.GamePlayer, 'id'>[] // Array of players with their gamePlayer IDs
) {
  if (roundNumber <= 0 || roundNumber > ROUND_DISTRIBUTION.length) {
    console.error(`[dealCardsForRound] Invalid round number: ${roundNumber}`);
    throw new Error('Ongeldig rondenummer om te delen.');
  }
  if (!players || players.length === 0) {
    console.error(`[dealCardsForRound] No players provided to deal cards to.`);
    throw new Error('Geen spelers om aan te delen.');
  }

  // 1. Delete old hands for the PREVIOUS round (if applicable)
  if (roundNumber > 1) {
    const previousRoundNumber = roundNumber - 1;
    // console.log(`[dealCardsForRound] Deleting hands from previous round ${previousRoundNumber} for game ${gameId}`); // Can be noisy
    await tx.delete(schema.playerRoundHands)
      .where(and(
        eq(schema.playerRoundHands.gameSessionId, gameId),
        eq(schema.playerRoundHands.roundNumber, previousRoundNumber)
      ));
  }

  // 2. Determine number of cards to deal
  const numCardsToDeal = ROUND_DISTRIBUTION[roundNumber - 1];
  // console.log(`[dealCardsForRound] Dealing ${numCardsToDeal} cards for round ${roundNumber} to ${players.length} players.`); // Can be noisy

  // 3. Create and shuffle deck
  const deck: { suit: schema.Suit; rank: schema.Rank }[] = [];
  for (const suit of schema.SUITS) {
    for (const rank of schema.RANKS) {
      deck.push({ suit, rank });
    }
  }

  // Fisher-Yates Shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  // 4. Deal cards
  const newHands: schema.NewPlayerRoundHand[] = [];
  let cardIndex = 0;
  for (let i = 0; i < numCardsToDeal; i++) {
    for (const player of players) {
      if (cardIndex < deck.length) {
        const card = deck[cardIndex++];
        newHands.push({
          gameSessionId: gameId,
          gamePlayerId: player.id,
          roundNumber: roundNumber,
          cardSuit: card.suit,
          cardRank: card.rank,
          isPlayed: false, // Important: new cards are not played
          // createdAt will use default
        });
      } else {
        console.error("[dealCardsForRound] Ran out of cards in deck while dealing!");
        throw new Error('Stok kaarten is op tijdens het delen.');
      }
    }
  }

  if (newHands.length > 0) {
    await tx.insert(schema.playerRoundHands).values(newHands);
    // console.log(`[dealCardsForRound] Successfully inserted ${newHands.length} new cards into playerRoundHands.`); // Can be noisy
  } else {
    // console.log("[dealCardsForRound] No cards were dealt (e.g., 0 cards that round or no players)."); // Can be noisy
  }
}

// Helper to fetch full game state for broadcasting (simplified, adapt as needed)
// This would be similar to getGameStateAction but directly usable on server
async function getGameDataForBroadcast(gameId: number) {
  console.log(`[getGameDataForBroadcast ENTER] GameID: ${gameId}`);
  try {
    const session = await db.query.gameSessions.findFirst({
      columns: { // MODIFIED: Explicitly select columns
        id: true,
        name: true,
        status: true,
        currentRound: true,
        trumpSuit: true,
        currentDealerId: true,
        currentTurnGamePlayerId: true,
        currentTrickLeadSuit: true, // Added as it was used later
        currentTrickNumberInRound: true // Added as it was used later
        // Add any other direct fields from gameSessions that are used in this function
      },
      where: eq(schema.gameSessions.id, gameId),
      with: {
        gamePlayers: { 
          orderBy: [asc(schema.gamePlayers.playerOrder)],
          with: {
            user: { columns: { email: true, id: true, name: true } } 
          }
        },
      },
    });

    console.log(`[getGameDataForBroadcast POST_SESSION_FETCH] GameID: ${gameId}, Session found: ${!!session}`);
    if (!session) {
      console.error(`[getGameDataForBroadcast ERROR] Session not found for gameId: ${gameId}`);
      return null;
    }
    console.log(`[getGameDataForBroadcast POST_SESSION_NULL_CHECK] GameID: ${gameId}`);
    if (!session.gamePlayers || session.gamePlayers.length === 0) {
      // console.log(`[getGameDataForBroadcast] No gamePlayers found for gameId: ${gameId}`); // Keep if debugging this specifically
      return null; 
    }
    // console.log(`[getGameDataForBroadcast] Found ${session.gamePlayers.length} gamePlayers for gameId: ${gameId}`); // Keep if debugging this specifically

    // No longer fetching all users separately just for names if names are derived

    // console.log(`[getGameDataForBroadcast] Fetching current bids for gameId: ${gameId}, round: ${session.currentRound}`);
    console.log(`[getGameDataForBroadcast PRE_BIDS_FETCH] GameID: ${gameId}`);
    const currentBids = await db.select()
      .from(schema.playerBids)
      .innerJoin(schema.gamePlayers, eq(schema.playerBids.gamePlayerId, schema.gamePlayers.id))
      .where(and(eq(schema.gamePlayers.gameSessionId, gameId), eq(schema.playerBids.roundNumber, session.currentRound ?? 0)));
    console.log(`[getGameDataForBroadcast POST_BIDS_FETCH] GameID: ${gameId}, Bids fetched: ${currentBids.length}`);
    // console.log(`[getGameDataForBroadcast] Fetched ${currentBids.length} bid records.`);

    console.log(`[getGameDataForBroadcast PRE_PLAYERS_WITH_DETAILS] GameID: ${gameId}`);
    const playersWithDetails = await Promise.all(session.gamePlayers.map(async (gp: schema.GamePlayer & { user?: { id: number; email: string | null; name: string | null } }) => {
      const bidRecord = currentBids.find(b => b.player_bids.gamePlayerId === gp.id);
      
      let playerHand: { suit: string; rank: string }[] = [];
      if (session.currentRound !== null && session.currentRound > 0) {
        const handRecords = await db.query.playerRoundHands.findMany({
          where: and(
            eq(schema.playerRoundHands.gamePlayerId, gp.id),
            eq(schema.playerRoundHands.roundNumber, session.currentRound),
            eq(schema.playerRoundHands.isPlayed, false)
          ),
          columns: { cardSuit: true, cardRank: true, isPlayed: true }
        });
        playerHand = handRecords.map(cardInHand => ({ suit: cardInHand.cardSuit, rank: cardInHand.cardRank }));
      }

      return {
        id: gp.id,
        userId: gp.userId,
        userName: gp.user?.name || `Speler ${gp.playerOrder + 1}`, // MODIFIED: Use user.name, fallback if null/undefined
        userEmail: gp.user?.email || '-',
        playerOrder: gp.playerOrder,
        currentScore: gp.currentScore,
        currentBid: bidRecord ? bidRecord.player_bids.bidAmount : null,
        hand: playerHand,
      };
    }));
    console.log(`[getGameDataForBroadcast POST_PLAYERS_WITH_DETAILS] GameID: ${gameId}, Players processed: ${playersWithDetails.length}`);

    // Fetch cards played in the current trick
    let currentTrickPlaysData: { gamePlayerId: number; userName: string; cardSuit: string; cardRank: string; playSequenceInTrick: number }[] = [];
    console.log(`[getGameDataForBroadcast PRE_TRICK_PLAYS_FETCH] GameID: ${gameId}, Status: ${session.status}, Round: ${session.currentRound}, TrickNum: ${session.currentTrickNumberInRound}`);
    if (session.status === 'active_play' && session.currentRound !== null && session.currentTrickNumberInRound !== null) {
      const trickPlayRecords = await db.query.playedCardsInTricks.findMany({
        where: and(
          eq(schema.playedCardsInTricks.gameSessionId, gameId),
          eq(schema.playedCardsInTricks.roundNumber, session.currentRound),
          eq(schema.playedCardsInTricks.trickNumberInRound, session.currentTrickNumberInRound)
        ),
        orderBy: [asc(schema.playedCardsInTricks.playSequenceInTrick)],
        // No need for `with` here if playersWithDetails is already constructed and contains userName
      });

      currentTrickPlaysData = trickPlayRecords.map(tp => {
        const playerDetails = playersWithDetails.find(p => p.id === tp.gamePlayerId);
        return {
          gamePlayerId: tp.gamePlayerId,
          userName: playerDetails?.userName || `Speler_Fallback_${tp.gamePlayerId}`, // MODIFIED Uses userName from playerDetails, which now has the real name
          cardSuit: tp.cardSuit,
          cardRank: tp.cardRank,
          playSequenceInTrick: tp.playSequenceInTrick
        };
      });
    }
    console.log(`[getGameDataForBroadcast POST_TRICK_PLAYS_FETCH] GameID: ${gameId}, Trick plays fetched: ${currentTrickPlaysData.length}`);

    // Fetch all completed tricks for the current round
    let allCompletedTricksData: {
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
    }[] = [];

    console.log(`[getGameDataForBroadcast PRE_COMPLETED_TRICKS_FETCH] GameID: ${gameId}, Round: ${session.currentRound}`);
    if (session.currentRound !== null && session.currentRound > 0) {
      // console.log(`[getGameDataForBroadcast ServerDebug] Fetching completed tricks for round: ${session.currentRound}, game: ${gameId}`);
      const completedTricksFromDb = await db.query.playedTricks.findMany({
        where: and(
          eq(schema.playedTricks.gameSessionId, gameId),
          eq(schema.playedTricks.roundNumber, session.currentRound),
          sql`${schema.playedTricks.winningGamePlayerId} IS NOT NULL`
        ),
        orderBy: [asc(schema.playedTricks.roundTrickNumber)],
        with: {
          cardsInTrick: { 
            orderBy: [asc(schema.playedCardsInTricks.playSequenceInTrick)],
            columns: { 
              gamePlayerId: true,
              cardSuit: true,
              cardRank: true,
              playSequenceInTrick: true,
            }
          }
        }
      });
      // console.log(`[getGameDataForBroadcast ServerDebug] Fetched ${completedTricksFromDb.length} completed tricks from DB.`);
      // console.log(`[getGameDataForBroadcast ServerDebug] completedTricksFromDb (raw):`, JSON.stringify(completedTricksFromDb));

      allCompletedTricksData = completedTricksFromDb.map(trick => {
        const winnerDetails = playersWithDetails.find(p => p.id === trick.winningGamePlayerId);
        return {
          trickNumberInRound: trick.roundTrickNumber,
          winningGamePlayerId: trick.winningGamePlayerId!,
          winnerName: winnerDetails?.userName || `Winner_Fallback_${trick.winningGamePlayerId}`, // Uses userName from playerDetails
          cards: trick.cardsInTrick.map(cardInTrick => {
            const playerDetails = playersWithDetails.find(p => p.id === cardInTrick.gamePlayerId);
            return {
              gamePlayerId: cardInTrick.gamePlayerId,
              playerName: playerDetails?.userName || `Player_Fallback_${cardInTrick.gamePlayerId}`, // Uses userName from playerDetails
              cardSuit: cardInTrick.cardSuit,
              cardRank: cardInTrick.cardRank,
              playSequenceInTrick: cardInTrick.playSequenceInTrick,
            };
          }),
        };
      });
      // console.log(`[getGameDataForBroadcast ServerDebug] Mapped allCompletedTricksData count: ${allCompletedTricksData.length}`);
      // console.log(`[getGameDataForBroadcast ServerDebug] allCompletedTricksData (mapped):`, JSON.stringify(allCompletedTricksData));
    }
    console.log(`[getGameDataForBroadcast POST_COMPLETED_TRICKS_FETCH] GameID: ${gameId}, Completed tricks mapped: ${allCompletedTricksData.length}`);

    // --- Round Summary Data --- 
    let roundSummaryDataForClient: Array<{
      roundNumber: number;
      playerRoundDetails: Array<{
        gamePlayerId: number;
        playerName: string;
        scoreChange: number;
        cumulativeScoreAfterRound: number;
      }>;
    }> = [];

    console.log(`[getGameDataForBroadcast PRE_ROUND_SUMMARY_FETCH] GameID: ${gameId}, Status: ${session.status}`);
    // Always fetch round summary data if available, regardless of current status,
    // as it's historical. The client decides whether to show the modal based on 'round_summary' status.
    // Let's fetch all rounds up to the current round if currentRound is not null
    // or up to the last round recorded in playerRoundScoreChanges if game is finished.
    
    const scoreChanges = await db.query.playerRoundScoreChanges.findMany({
        where: eq(schema.playerRoundScoreChanges.gameSessionId, gameId),
        orderBy: [asc(schema.playerRoundScoreChanges.roundNumber), asc(schema.playerRoundScoreChanges.gamePlayerId)]
    });

    if (scoreChanges.length > 0) {
        const maxRoundWithScores = scoreChanges[scoreChanges.length - 1].roundNumber;
        const playerCumulativeScores: { [gamePlayerId: number]: number } = {};
        
        // Initialize cumulative scores to 0 for all players in the game
        session.gamePlayers.forEach(p => {
            playerCumulativeScores[p.id] = 0;
        });

        for (let r = 1; r <= maxRoundWithScores; r++) {
            const detailsForThisRound: typeof roundSummaryDataForClient[0]['playerRoundDetails'] = [];
            const changesForThisSpecificRound = scoreChanges.filter(sc => sc.roundNumber === r);

            for (const player of playersWithDetails) { // Iterate through game players to ensure all are listed
                const changeRecord = changesForThisSpecificRound.find(sc => sc.gamePlayerId === player.id);
                const scoreChangeThisRound = changeRecord ? changeRecord.scoreChange : 0;
                
                playerCumulativeScores[player.id] += scoreChangeThisRound; // Update based on this round's change

                detailsForThisRound.push({
                    gamePlayerId: player.id,
                    playerName: player.userName,
                    scoreChange: scoreChangeThisRound,
                    cumulativeScoreAfterRound: playerCumulativeScores[player.id]
                });
            }
            roundSummaryDataForClient.push({
                roundNumber: r,
                playerRoundDetails: detailsForThisRound.sort((a,b) => { // Sort by original player order for display consistency
                    const playerAOrder = playersWithDetails.find(p => p.id === a.gamePlayerId)?.playerOrder ?? 99;
                    const playerBOrder = playersWithDetails.find(p => p.id === b.gamePlayerId)?.playerOrder ?? 99;
                    return playerAOrder - playerBOrder;
                })
            });
        }
    }
    console.log(`[getGameDataForBroadcast POST_ROUND_SUMMARY_FETCH] GameID: ${gameId}, Summary items: ${roundSummaryDataForClient.length}`);

    // Log the session object to inspect its properties, especially 'name'
    console.log(`[getGameDataForBroadcast DEBUG_SESSION] GameID: ${gameId}, Session Name: ${session.name}, Session object exists: ${!!session}`); // SIMPLIFIED LOG

    const finalData = {
      id: session.id,
      gameName: session.name,
      status: session.status,
      currentRound: session.currentRound,
      trumpSuit: session.trumpSuit,
      currentDealerId: session.currentDealerId,
      currentTurnGamePlayerId: session.currentTurnGamePlayerId,
      currentTrickPlays: currentTrickPlaysData,
      allCompletedTricksInCurrentRound: allCompletedTricksData,
      roundSummaryData: roundSummaryDataForClient,
      players: playersWithDetails,
      // Add requestingUserId if needed by client, though this function is generic for broadcast
      // If called from an action, the action wrapper would add it.
    };
    console.log(`[getGameDataForBroadcast PRE_RETURN] GameID: ${gameId}, FinalData status: ${finalData.status}`);
    return finalData;
  } catch (error) {
    console.error(`[getGameDataForBroadcast CATCH_ERROR] GameID: ${gameId}, Error:`, error);
    throw error; // Re-throw the error to see if it's caught by the caller
  }
}

// Helper function to manage tasks after round_summary acknowledgement
async function handleRoundCompletionOrGameEnd(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  gameId: number,
  currentSession: InferSelectModel<typeof schema.gameSessions> & { gamePlayers: Pick<schema.GamePlayer, 'id' | 'playerOrder' | 'currentScore'>[] },
  playersInOrder: (Pick<schema.GamePlayer, 'id' | 'playerOrder' | 'currentScore'>)[] // Already ordered
) {
  const gameSessionUpdateData: Partial<typeof schema.gameSessions.$inferInsert> = { updatedAt: new Date() };
  const currentRoundNumber = currentSession.currentRound;

  if (currentRoundNumber === null) {
    console.error(`[handleRoundCompletionOrGameEnd] Critical error: currentRoundNumber is null for game ${gameId}. Cannot proceed.`);
    // Potentially set game to an error state or archived
    gameSessionUpdateData.status = 'archived'; // Or some error status
    await tx.update(schema.gameSessions).set(gameSessionUpdateData).where(eq(schema.gameSessions.id, gameId));
    return { success: false, error: 'Critical: Current round is null.' };
  }

  const nextRoundNumber = currentRoundNumber + 1;

  if (nextRoundNumber > ROUND_DISTRIBUTION.length) {
    // Game Over
    gameSessionUpdateData.status = 'finished';
    gameSessionUpdateData.currentTurnGamePlayerId = null;
    // console.log("[handleRoundCompletionOrGameEnd] Game is over. Final round was: ", currentRoundNumber);

    let topScore = -Infinity;
    let potentialWinners: (Pick<schema.GamePlayer, 'id' | 'playerOrder' | 'currentScore'>)[] = [];
    for (const player of playersInOrder) {
      if (player.currentScore > topScore) {
        topScore = player.currentScore;
        potentialWinners = [player];
      } else if (player.currentScore === topScore) {
        potentialWinners.push(player);
      }
    }
    if (potentialWinners.length > 0) {
      potentialWinners.sort((a, b) => a.playerOrder - b.playerOrder);
      const gameWinner = potentialWinners[0];
      gameSessionUpdateData.winnerGamePlayerId = gameWinner.id;
      // console.log(`[handleRoundCompletionOrGameEnd] Game winner determined: Player ${gameWinner.id} with score ${gameWinner.currentScore}`);
    } else {
      // console.error(`[handleRoundCompletionOrGameEnd] Could not determine game winner for game ${gameId}. No players or scores problematic.`);
    }
  } else {
    // Prepare for Next Round
    gameSessionUpdateData.currentRound = nextRoundNumber;
    gameSessionUpdateData.currentTrickNumberInRound = 1;
    gameSessionUpdateData.status = 'bidding';
    const newTrumpSuit = determineTrumpForNewRound();
    gameSessionUpdateData.trumpSuit = newTrumpSuit;

    const currentDealerId = currentSession.currentDealerId;
    const currentDealerIndex = playersInOrder.findIndex(p => p.id === currentDealerId);
    let nextDealerId = currentDealerId; // Default to current if not found or single player
    if (currentDealerIndex !== -1 && playersInOrder.length > 0) {
      nextDealerId = playersInOrder[(currentDealerIndex + 1) % playersInOrder.length].id;
    }
    gameSessionUpdateData.currentDealerId = nextDealerId;

    const nextDealerActualIndex = playersInOrder.findIndex(p => p.id === nextDealerId);
    if (nextDealerActualIndex !== -1 && playersInOrder.length > 0) {
      gameSessionUpdateData.currentTurnGamePlayerId = playersInOrder[(nextDealerActualIndex + 1) % playersInOrder.length].id;
    } else if (playersInOrder.length > 0) { // Fallback if dealer logic has issues
      gameSessionUpdateData.currentTurnGamePlayerId = playersInOrder[0].id;
    }

    // console.log(`[handleRoundCompletionOrGameEnd] Preparing for round ${nextRoundNumber}. Status: bidding. Trump: ${newTrumpSuit}. Dealer: ${nextDealerId}, First to bid: ${gameSessionUpdateData.currentTurnGamePlayerId}`);
    await dealCardsForRound(tx, gameId, nextRoundNumber, playersInOrder.map(p => ({ id: p.id })));
  }

  await tx.update(schema.gameSessions).set(gameSessionUpdateData).where(eq(schema.gameSessions.id, gameId));
  return { success: true };
}

// Refactored function to trigger game continuation
async function triggerGameContinuation(io: SocketIOServer, gameId: number, source: string) {
  console.log(`[triggerGameContinuation] Source: ${source}. Attempting to advance game ${gameId}.`);
  await db.transaction(async (tx) => {
    const currentSession = await tx.query.gameSessions.findFirst({
      where: eq(schema.gameSessions.id, gameId),
      with: { gamePlayers: { orderBy: [asc(schema.gamePlayers.playerOrder)] } }
    });

    if (!currentSession) {
      console.error(`[triggerGameContinuation] Game ${gameId} not found.`);
      // Cannot emit to client here easily as we don't have a specific socket.id
      // This function is mostly for server-initiated progression.
      return; 
    }

    if (currentSession.status !== 'round_summary') {
      console.warn(`[triggerGameContinuation] Game ${gameId} is in status '${currentSession.status}', not 'round_summary'. Cannot advance. Source: ${source}`);
      // Potentially emit an error if source was a client action that bypassed UI checks
      return;
    }

    const playersInOrder: (Pick<schema.GamePlayer, 'id' | 'playerOrder' | 'currentScore'>)[] = currentSession.gamePlayers.map(gp => ({
      id: gp.id,
      playerOrder: gp.playerOrder,
      currentScore: gp.currentScore
    }));

    return await handleRoundCompletionOrGameEnd(tx, gameId, currentSession as any, playersInOrder); 
  });
}

// Main function to start the server
async function startServer() {
  try {
    // Prepare the Next.js app
    await app.prepare();
    console.log('Next.js app prepared successfully');
  } catch (error) {
    console.error('Error preparing Next.js app:', error);
    process.exit(1);
  }

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const parsedUrl = parse(req.url!, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error handling request:', err);
      res.statusCode = 500;
      res.end('internal server error');
    }
  });

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: "*", // Configure as needed for production
      methods: ["GET", "POST"]
    }
  });

  io.on('connection', (socket: Socket) => {
    console.log('A user connected with socket ID:', socket.id);

    socket.on('joinRoom', (roomId) => {
      socket.join(roomId);
      console.log(`Socket ${socket.id} joined room ${roomId}`);
    });
    
    socket.on('chatMessage', (data: { roomId: string; message: string; userId?: number }) => {
      console.log(`Message received in room ${data.roomId} from user ${data.userId || socket.id}: ${data.message}`);
      io.to(data.roomId).emit('newChatMessage', { 
        message: data.message, 
        userId: data.userId || socket.id,
        timestamp: new Date().toISOString() 
      });
    });

    // Game-specific socket handlers
    socket.on('joinGameRoom', (gameId: string) => {
      socket.join(`game_${gameId}`);
      console.log(`Socket ${socket.id} joined game room: game_${gameId}`);
    });

    socket.on('submitBid', async (data: { gameId: number; gamePlayerId: number; bidAmount: number; roundNumber: number }) => {
      console.log(`[Socket submitBid] Received bid from socket ${socket.id}:`, data);
      
      try {
        const { gameId, gamePlayerId, bidAmount, roundNumber } = data;

        // Validate input
        if (!gameId || !gamePlayerId || bidAmount === undefined || !roundNumber) {
          socket.emit('actionError', { message: 'Ongeldige bidgegevens.' });
          return;
        }

        await db.transaction(async (tx) => {
          // Get game session and validate
          const gameSession = await tx.query.gameSessions.findFirst({
            where: eq(schema.gameSessions.id, gameId),
            with: { 
              gamePlayers: { 
                orderBy: [asc(schema.gamePlayers.playerOrder)],
                with: { user: { columns: { id: true, name: true, email: true } } }
              } 
            }
          });

          if (!gameSession) {
            socket.emit('actionError', { message: 'Spelsessie niet gevonden.' });
            return;
          }

          if (gameSession.status !== 'bidding') {
            socket.emit('actionError', { message: 'Spel is niet in biedfase.' });
            return;
          }

          if (gameSession.currentRound !== roundNumber) {
            socket.emit('actionError', { message: 'Onjuist rondenummer.' });
            return;
          }

          // Validate it's the player's turn
          if (gameSession.currentTurnGamePlayerId !== gamePlayerId) {
            socket.emit('actionError', { message: 'Het is niet jouw beurt om te bieden.' });
            return;
          }

          // Validate bid amount
          const currentRoundIndex = (gameSession.currentRound || 1) - 1;
          const maxBid = ROUND_DISTRIBUTION[currentRoundIndex] || 0;
          if (bidAmount < 0 || bidAmount > maxBid) {
            socket.emit('actionError', { message: `Bod moet tussen 0 en ${maxBid} zijn.` });
            return;
          }

          // Check if player already has a bid for this round
          const existingBid = await tx.query.playerBids.findFirst({
            where: and(
              eq(schema.playerBids.gamePlayerId, gamePlayerId),
              eq(schema.playerBids.roundNumber, roundNumber)
            )
          });

          if (existingBid) {
            socket.emit('actionError', { message: 'Je hebt al een bod ingediend voor deze ronde.' });
            return;
          }

          // Insert the bid
          await tx.insert(schema.playerBids).values({
            gameSessionId: gameId,
            gamePlayerId,
            roundNumber,
            bidAmount,
            createdAt: new Date()
          });

          // Determine next player to bid
          const currentPlayerIndex = gameSession.gamePlayers.findIndex(p => p.id === gamePlayerId);
          const nextPlayerIndex = (currentPlayerIndex + 1) % gameSession.gamePlayers.length;
          const nextPlayer = gameSession.gamePlayers[nextPlayerIndex];

          // Check if all players have bid
          const allBids = await tx.query.playerBids.findMany({
            where: and(
              eq(schema.playerBids.roundNumber, roundNumber),
              inArray(schema.playerBids.gamePlayerId, gameSession.gamePlayers.map(p => p.id))
            )
          });

          let gameSessionUpdate: Partial<typeof schema.gameSessions.$inferInsert> = {
            updatedAt: new Date()
          };

          if (allBids.length >= gameSession.gamePlayers.length) {
            // All players have bid, start playing phase
            gameSessionUpdate.status = 'active_play';
            
            // Player to the left of dealer starts first trick
            const playersInOrder = gameSession.gamePlayers.sort((a, b) => a.playerOrder - b.playerOrder);
            const dealerIndex = playersInOrder.findIndex(p => p.id === gameSession.currentDealerId);
            const firstPlayerIndex = (dealerIndex + 1) % playersInOrder.length;
            const firstPlayer = playersInOrder[firstPlayerIndex];
            
            gameSessionUpdate.currentTurnGamePlayerId = firstPlayer.id; // Player left of dealer starts first trick
          } else {
            // Move to next player
            gameSessionUpdate.currentTurnGamePlayerId = nextPlayer.id;
          }

          await tx.update(schema.gameSessions)
            .set(gameSessionUpdate)
            .where(eq(schema.gameSessions.id, gameId));
        });

        // Broadcast updated game state
        const updatedGameState = await getGameDataForBroadcast(gameId);
        io.to(`game_${gameId}`).emit('gameStateUpdate', updatedGameState);
        socket.emit('bidSuccess', { message: 'Bod succesvol ingediend!', gameId });

      } catch (error) {
        console.error('[Socket submitBid] Error:', error);
        socket.emit('actionError', { message: 'Fout bij indienen van bod.' });
      }
    });

    socket.on('playCard', async (data: { gameId: number; gamePlayerId: number; card: { suit: string; rank: string } }) => {
      console.log(`[Socket playCard] Received card play from socket ${socket.id}:`, data);
      
      try {
        const { gameId, gamePlayerId, card } = data;

        // Validate input
        if (!gameId || !gamePlayerId || !card || !card.suit || !card.rank) {
          socket.emit('actionError', { message: 'Ongeldige kaartgegevens.' });
          return;
        }

        await db.transaction(async (tx) => {
          // Get game session and validate
          const gameSession = await tx.query.gameSessions.findFirst({
            where: eq(schema.gameSessions.id, gameId),
            with: { 
              gamePlayers: { 
                orderBy: [asc(schema.gamePlayers.playerOrder)],
                with: { user: { columns: { id: true, name: true, email: true } } }
              } 
            }
          });

          if (!gameSession) {
            socket.emit('actionError', { message: 'Spelsessie niet gevonden.' });
            return;
          }

          if (gameSession.status !== 'active_play') {
            socket.emit('actionError', { message: 'Spel is niet in speelfase.' });
            return;
          }

          // Validate it's the player's turn
          if (gameSession.currentTurnGamePlayerId !== gamePlayerId) {
            socket.emit('actionError', { message: 'Het is niet jouw beurt om te spelen.' });
            return;
          }

          // Validate player has this card in their hand
          const playerCard = await tx.query.playerRoundHands.findFirst({
            where: and(
              eq(schema.playerRoundHands.gamePlayerId, gamePlayerId),
              eq(schema.playerRoundHands.gameSessionId, gameId),
              eq(schema.playerRoundHands.roundNumber, gameSession.currentRound || 1),
              eq(schema.playerRoundHands.cardSuit, card.suit as schema.Suit),
              eq(schema.playerRoundHands.cardRank, card.rank as schema.Rank),
              eq(schema.playerRoundHands.isPlayed, false)
            )
          });

          if (!playerCard) {
            socket.emit('actionError', { message: 'Je hebt deze kaart niet in je hand.' });
            return;
          }

          // Get player's full hand for validation
          const playerHandRecords = await tx.query.playerRoundHands.findMany({
            where: and(
              eq(schema.playerRoundHands.gamePlayerId, gamePlayerId),
              eq(schema.playerRoundHands.gameSessionId, gameId),
              eq(schema.playerRoundHands.roundNumber, gameSession.currentRound || 1),
              eq(schema.playerRoundHands.isPlayed, false)
            )
          });

          // Convert to offline format for validation
          const playerHand: OfflineCard[] = playerHandRecords.map(handCard => ({
            suit: handCard.cardSuit as schema.Suit,
            rank: handCard.cardRank as schema.Rank
          }));

          const cardToPlay: OfflineCard = { suit: card.suit as schema.Suit, rank: card.rank as schema.Rank };

          // Determine lead suit for this trick
          const existingPlaysForValidation = await tx.query.playedCardsInTricks.findMany({
            where: and(
              eq(schema.playedCardsInTricks.gameSessionId, gameId),
              eq(schema.playedCardsInTricks.roundNumber, gameSession.currentRound || 1),
              eq(schema.playedCardsInTricks.trickNumberInRound, gameSession.currentTrickNumberInRound || 1)
            ),
            orderBy: [asc(schema.playedCardsInTricks.playSequenceInTrick)]
          });

          const leadSuit = existingPlaysForValidation.length > 0 ? existingPlaysForValidation[0].cardSuit : null;
          const trumpSuit = gameSession.trumpSuit || 'HEARTS';

          // Validate the play using game rules
          if (!isValidPlay(playerHand, cardToPlay, leadSuit, trumpSuit)) {
            socket.emit('actionError', { message: 'Ongeldige kaartspel. Je moet de kleur volgen als je deze hebt, anders troef spelen als je troef hebt.' });
            return;
          }

          // Mark card as played
          await tx.update(schema.playerRoundHands)
            .set({ isPlayed: true })
            .where(eq(schema.playerRoundHands.id, playerCard.id));

          // Get or create current trick
          let currentTrick = await tx.query.playedTricks.findFirst({
            where: and(
              eq(schema.playedTricks.gameSessionId, gameId),
              eq(schema.playedTricks.roundNumber, gameSession.currentRound || 1),
              eq(schema.playedTricks.roundTrickNumber, gameSession.currentTrickNumberInRound || 1)
            )
          });

          if (!currentTrick) {
            const [newTrick] = await tx.insert(schema.playedTricks).values({
              gameSessionId: gameId,
              roundNumber: gameSession.currentRound || 1,
              roundTrickNumber: gameSession.currentTrickNumberInRound || 1,
              leadSuit: card.suit as schema.Suit,
              createdAt: new Date()
            }).returning();
            currentTrick = newTrick;
          }

          // Get current play sequence
          const existingPlays = await tx.query.playedCardsInTricks.findMany({
            where: and(
              eq(schema.playedCardsInTricks.playedTrickId, currentTrick.id)
            )
          });

          // Add card to trick
          await tx.insert(schema.playedCardsInTricks).values({
            playedTrickId: currentTrick.id,
            gameSessionId: gameId,
            roundNumber: gameSession.currentRound || 1,
            trickNumberInRound: gameSession.currentTrickNumberInRound || 1,
            gamePlayerId,
            cardSuit: card.suit as schema.Suit,
            cardRank: card.rank as schema.Rank,
            playSequenceInTrick: existingPlays.length + 1,
            createdAt: new Date()
          });

          let gameSessionUpdate: Partial<typeof schema.gameSessions.$inferInsert> = {
            updatedAt: new Date()
          };

          // Check if trick is complete (4 cards played)
          if (existingPlays.length + 1 >= 4) {
            // Trick is complete - determine winner using game logic
            const allCardsInTrick = await tx.query.playedCardsInTricks.findMany({
              where: and(
                eq(schema.playedCardsInTricks.playedTrickId, currentTrick.id)
              ),
              orderBy: [asc(schema.playedCardsInTricks.playSequenceInTrick)]
            });

            // Convert DB cards to offline format for trick winner logic
            const offlineCards: OfflinePlayedCard[] = allCardsInTrick.map(dbCard => ({
              playerId: dbCard.gamePlayerId.toString(), // Convert number to string
              card: { suit: dbCard.cardSuit, rank: dbCard.cardRank },
              playSequenceInTrick: dbCard.playSequenceInTrick
            }));

            const trickWinner = determineTrickWinner(offlineCards, trumpSuit);
            
            // Update trick with winner
            await tx.update(schema.playedTricks)
              .set({ winningGamePlayerId: parseInt(trickWinner.playerId) }) // Convert string back to number
              .where(eq(schema.playedTricks.id, currentTrick.id));

            // Update winner's tricks taken count
            await tx.update(schema.gamePlayers)
              .set({ 
                currentRoundTricksTaken: sql`${schema.gamePlayers.currentRoundTricksTaken} + 1`,
                updatedAt: new Date()
              })
              .where(eq(schema.gamePlayers.id, parseInt(trickWinner.playerId))); // Convert string back to number

            // Check if round is complete
            const currentRoundNumber = gameSession.currentRound || 1;
            const expectedTricksThisRound = ROUND_DISTRIBUTION[currentRoundNumber - 1] || 0;
            const currentTrickNumber = gameSession.currentTrickNumberInRound || 1;

            if (currentTrickNumber >= expectedTricksThisRound) {
              // Round is complete - calculate scores and set up round summary
              console.log(`[Socket playCard] Round ${currentRoundNumber} complete. Calculating scores...`);
              
              // Get all players with their bids and tricks taken
              const playersWithStats = await tx.query.gamePlayers.findMany({
                where: eq(schema.gamePlayers.gameSessionId, gameId),
                orderBy: [asc(schema.gamePlayers.playerOrder)]
              });

              const bidsThisRound = await tx.query.playerBids.findMany({
                where: and(
                  eq(schema.playerBids.roundNumber, currentRoundNumber),
                  inArray(schema.playerBids.gamePlayerId, playersWithStats.map(p => p.id))
                )
              });

              // Calculate and update scores
              for (const player of playersWithStats) {
                const bidRecord = bidsThisRound.find(b => b.gamePlayerId === player.id);
                const bid = bidRecord ? bidRecord.bidAmount : 0;
                const tricksTaken = player.currentRoundTricksTaken;
                
                const scoreChange = calculatePlayerScore(bid, tricksTaken);
                const newCumulativeScore = player.currentScore + scoreChange;

                // Update player's cumulative score and reset tricks taken
                await tx.update(schema.gamePlayers)
                  .set({ 
                    currentScore: newCumulativeScore,
                    currentRoundTricksTaken: 0,
                    updatedAt: new Date()
                  })
                  .where(eq(schema.gamePlayers.id, player.id));

                // Record score change for round summary
                await tx.insert(schema.playerRoundScoreChanges).values({
                  gameSessionId: gameId,
                  gamePlayerId: player.id,
                  roundNumber: currentRoundNumber,
                  scoreChange,
                  tricksTaken,
                  createdAt: new Date()
                });
              }

              // Set game to round_summary status
              gameSessionUpdate.status = 'round_summary';
              gameSessionUpdate.currentTurnGamePlayerId = null;
              console.log(`[Socket playCard] Setting game ${gameId} to round_summary status`);

              // Set timeout to auto-advance after 10 seconds
              setTimeout(() => {
                triggerGameContinuation(io, gameId, 'auto_timeout');
              }, ROUND_SUMMARY_TIMEOUT_MS);

            } else {
              // More tricks to play in this round
              gameSessionUpdate.currentTrickNumberInRound = currentTrickNumber + 1;
              gameSessionUpdate.currentTurnGamePlayerId = parseInt(trickWinner.playerId); // Convert string back to number
              console.log(`[Socket playCard] Trick ${currentTrickNumber} complete. Winner ${trickWinner.playerId} starts trick ${currentTrickNumber + 1}`);
            }
          } else {
            // Move to next player - ensure players are ordered by playerOrder
            const playersInOrder = gameSession.gamePlayers.sort((a, b) => a.playerOrder - b.playerOrder);
            const currentPlayerIndex = playersInOrder.findIndex(p => p.id === gamePlayerId);
            const nextPlayerIndex = (currentPlayerIndex + 1) % playersInOrder.length;
            const nextPlayer = playersInOrder[nextPlayerIndex];
            gameSessionUpdate.currentTurnGamePlayerId = nextPlayer.id;
            console.log(`[Socket playCard] Turn advancing from player ${gamePlayerId} (index ${currentPlayerIndex}) to player ${nextPlayer.id} (index ${nextPlayerIndex})`);
          }

          await tx.update(schema.gameSessions)
            .set(gameSessionUpdate)
            .where(eq(schema.gameSessions.id, gameId));
        });

        // Broadcast updated game state
        const updatedGameState = await getGameDataForBroadcast(gameId);
        io.to(`game_${gameId}`).emit('gameStateUpdate', updatedGameState);

      } catch (error) {
        console.error('[Socket playCard] Error:', error);
        socket.emit('actionError', { message: 'Fout bij spelen van kaart.' });
      }
    });

    socket.on('proceedToNextRound', async (data: { gameId: number }) => {
      console.log(`[Socket proceedToNextRound] Received from socket ${socket.id}:`, data);
      
      try {
        const { gameId } = data;
        await triggerGameContinuation(io, gameId, 'client_socket');
        
        // Broadcast updated game state
        const updatedGameState = await getGameDataForBroadcast(gameId);
        io.to(`game_${gameId}`).emit('gameStateUpdate', updatedGameState);

      } catch (error) {
        console.error('[Socket proceedToNextRound] Error:', error);
        socket.emit('actionError', { message: 'Fout bij doorgaan naar volgende ronde.' });
      }
    });

    socket.on('createGame', async (data, callback) => {
      console.log('[Socket Event - createGame] Received:', data);
    });

    socket.on('joinGame', async (data: { gameSessionId: number, userId: number }, callback) => {
      console.log('[Socket Event - joinGame] Received:', data);
    });

    // Handle client notification of new game creation
    socket.on('clientNewGameCreated', (data: { newGameId: number }) => {
      console.log(`[Socket clientNewGameCreated] Received from socket ${socket.id}:`, data);
      // Broadcast to all clients that the open games list should be refreshed
      io.emit('openGamesUpdated', { newGameId: data.newGameId });
      console.log(`[Socket clientNewGameCreated] Broadcasted 'openGamesUpdated' event for game ${data.newGameId}`);
    });

    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
    });
  });

  httpServer
    .once('error', (err) => {
      console.error('HTTP server error:', err);
      process.exit(1);
    })
    .listen(port, () => {
      if (isProduction) {
        console.log(`> Production server ready on http://${hostname}:${port}`);
      } else {
        console.log(`> Socket.IO server ready for development on http://${hostname}:${port}`);
        console.log(`> Run 'pnpm dev:next' (or yarn/npm) in a separate terminal for the Next.js frontend.`);
      }
    });
}

// Prepare Next.js app only in production, then start the server.
// In development (socket only), just start the server.
if (isProduction && app) {
  app.prepare()
    .then(startServer)
    .catch(err => {
      console.error("Next.js app preparation error:", err);
      process.exit(1);
    });
} else if (!isProduction) {
  startServer().catch(err => { // Start server directly for dev:socket
      console.error("Socket.IO server failed to start in development:", err);
      process.exit(1);
  });
} else {
    // This case should ideally not be reached if app is defined only in production
    console.error("Server configuration error: app not defined for production mode.");
    process.exit(1);
} 