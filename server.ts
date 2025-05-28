import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { Server as SocketIOServer, Socket } from 'socket.io';

// Drizzle and DB imports
import { db } from './lib/db/drizzle';
import * as schema from './lib/db/schema'; // Import all from schema
import { eq, and, sql, asc, desc, type InferSelectModel, type InferInsertModel } from 'drizzle-orm'; // Use asc and desc directly
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

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

const PORT = parseInt(process.env.PORT || '3001', 10);

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: "*", // Allow all origins
      methods: ["GET", "POST"]
    }
  });
  
  io.on('connection', (socket: Socket) => {
    // // console.log('A user connected:', socket.id); // Can be noisy

    socket.on('joinGameRoom', (gameId: string) => {
      socket.join(gameId);
      // // console.log(\`Socket \${socket.id} joined room \${gameId}\`);
    });

    socket.on('clientNewGameCreated', async (data: { newGameId: number }) => {
      // // console.log(\`[Server] Received clientNewGameCreated for gameId: \${data.newGameId}\`);
      // Broadcast to all clients (or specific lobby/landing page listeners if you have them)
      // that the list of open games should be refreshed.
      io.emit('openGamesUpdated', { newGameId: data.newGameId });
    });


    socket.on('submitBid', async (data: { gameId: number; gamePlayerId: number; bidAmount: number }) => {
      const { gameId, gamePlayerId, bidAmount } = data;
      // console.log(`[submitBid] Bid received for game ${gameId}, player ${gamePlayerId}, amount ${bidAmount}`); // Keep this one as it's a key action

      try {
        const result = await db.transaction(async (tx) => {
          // 1. Fetch current game session and bidding player
          const currentSession = await tx.query.gameSessions.findFirst({
            where: eq(schema.gameSessions.id, gameId),
            with: { gamePlayers: { orderBy: [asc(schema.gamePlayers.playerOrder)] } } // Use imported schema.gamePlayers
          });

          if (!currentSession) {
            socket.emit('actionError', { message: 'Game session not found.' });
            return { success: false, error: 'Game not found' };
          }
          if (currentSession.status !== 'bidding') {
            socket.emit('actionError', { message: 'Not in bidding phase.' });
            return { success: false, error: 'Not in bidding phase' };
          }
          if (currentSession.currentTurnGamePlayerId !== gamePlayerId) {
            socket.emit('actionError', { message: 'Not your turn to bid.' });
            return { success: false, error: 'Not your turn' };
          }
          if (currentSession.currentRound === null || currentSession.currentRound < 1 || currentSession.currentRound > ROUND_DISTRIBUTION.length) {
            socket.emit('actionError', { message: 'Invalid round for bidding.' });
            return { success: false, error: 'Invalid round' };
          }

          const cardsThisRound = ROUND_DISTRIBUTION[currentSession.currentRound - 1];
          if (bidAmount < 0 || bidAmount > cardsThisRound) {
            socket.emit('actionError', { message: `Invalid bid amount. Must be 0-${cardsThisRound}.` });
            return { success: false, error: 'Invalid bid amount' };
          }

          // Check if player already bid this round
          const existingBid = await tx.query.playerBids.findFirst({
            where: and(
              eq(schema.playerBids.gamePlayerId, gamePlayerId),
              eq(schema.playerBids.roundNumber, currentSession.currentRound)
            )
          });
          if (existingBid) {
            socket.emit('actionError', { message: 'You have already bid this round.' });
            return { success: false, error: 'Already bid' };
          }

          // 2. Insert the new bid
          const newBid: schema.NewPlayerBid = {
            gameSessionId: gameId,
            gamePlayerId: gamePlayerId,
            roundNumber: currentSession.currentRound,
            bidAmount: bidAmount,
          };
          await tx.insert(schema.playerBids).values(newBid);

          // 3. Determine next player or end bidding phase
          const playersInOrder: schema.GamePlayer[] = currentSession.gamePlayers as schema.GamePlayer[];
          if (playersInOrder.length !== 4) {
             // Should not happen in a properly started game
            console.error("Game does not have 4 players during bidding.");
            socket.emit('actionError', { message: 'Game player count error.' });
            return { success: false, error: 'Player count error' }; 
          }

          const currentPlayerIndex = playersInOrder.findIndex((p: schema.GamePlayer) => p.id === gamePlayerId);
          let nextPlayerGamePlayerId = playersInOrder[(currentPlayerIndex + 1) % 4].id;

          // Check if all players have bid for the current round
          const allBidsForRound = await tx.select({ gamePlayerId: schema.playerBids.gamePlayerId })
            .from(schema.playerBids)
            .innerJoin(schema.gamePlayers, eq(schema.playerBids.gamePlayerId, schema.gamePlayers.id))
            .where(and(
                eq(schema.gamePlayers.gameSessionId, gameId),
                eq(schema.playerBids.roundNumber, currentSession.currentRound)
            ));
          
          let nextStatus: GameStatusEnum = currentSession.status as GameStatusEnum;

          if (allBidsForRound.length === playersInOrder.length) { 
            // console.log(`[submitBid] All ${allBidsForRound.length} players have bid for round ${currentSession.currentRound} in game ${gameId}.`); 
            nextStatus = 'active_play';
            
            // Determine who leads the first trick
            const dealer = playersInOrder.find((p: schema.GamePlayer) => p.id === currentSession.currentDealerId);
            if (dealer) {
                const starterIndex = (playersInOrder.findIndex((p: schema.GamePlayer) => p.id === dealer.id) + 1) % playersInOrder.length;
                nextPlayerGamePlayerId = playersInOrder[starterIndex].id;
            } else {
                // console.error(`Dealer not found for game ${gameId} while transitioning to active state.`);
                nextPlayerGamePlayerId = playersInOrder[0].id; 
            }
            // console.log(`[submitBid] Game ${gameId} transitioning to '${nextStatus}', Trump: ${currentSession.trumpSuit}, First turn: ${nextPlayerGamePlayerId}`); 
          }

          // 4. Update game session (turn, status if changed)
          const updateData: Partial<Pick<schema.GameSession, 'currentTurnGamePlayerId' | 'status' | 'updatedAt'>> = {
            currentTurnGamePlayerId: nextPlayerGamePlayerId,
            status: nextStatus,
            updatedAt: new Date(),
          };

          await tx.update(schema.gameSessions)
            .set(updateData)
            .where(eq(schema.gameSessions.id, gameId));
          
          return { success: true, gameId: gameId };
        });

        if (result && result.success) {
          const updatedGameData = await getGameDataForBroadcast(gameId);
          if (updatedGameData) {
            // // console.log('[server.ts/submitBid] Broadcasting updatedGameData:', JSON.stringify(updatedGameData, null, 2)); 
            io.to(gameId.toString()).emit('gameStateUpdate', updatedGameData);
            // console.log(`[submitBid] Broadcasted gameStateUpdate for game ${gameId}`); 
          }
          socket.emit('bidSuccess', { message: 'Bod succesvol ingediend.', gameId: gameId });
        } else if (result && result.error) {
          // console.error(`[submitBid] Bid submission failed for game ${gameId}, player ${gamePlayerId}: ${result.error}`); 
        }

      } catch (error) {
        // console.error('[submitBid] Error processing submitBid:', error); 
        socket.emit('actionError', { message: 'Server error processing bid.' });
      }
    });

    socket.on('disconnect', () => {
      // console.log('User disconnected:', socket.id); // This is a standard operational log, might keep
    });

    socket.on('playCard', async (data: { gameId: number; gamePlayerId: number; card: { suit: schema.Suit; rank: schema.Rank } }) => {
      const { gameId, gamePlayerId, card } = data;
      console.log(`[playCard ENTER] GameID: ${gameId}, PlayerID: ${gamePlayerId}, Card: ${card.rank} of ${card.suit}`);

      try {
        const result = await db.transaction(async (tx) => {
          console.log(`[playCard TXN_START] GameID: ${gameId}, PlayerID: ${gamePlayerId}`);

          // 1. Fetch current game session, players, and bidding player validation
          const currentSession = await tx.query.gameSessions.findFirst({
            where: eq(schema.gameSessions.id, gameId),
            with: {
              gamePlayers: { orderBy: [asc(schema.gamePlayers.playerOrder)] },
            },
          });

          if (!currentSession) {
            socket.emit('actionError', { message: 'Game session not found.' });
            return { success: false, error: 'Game not found' };
          }

          // DEBUG LOGS FOR PREMATURE ROUND ENDING
          const debug_numTricksExpectedThisRound = ROUND_DISTRIBUTION[currentSession.currentRound! - 1];
          console.log(`[playCard DEBUG_ROUND_STATE] GameID: ${gameId}, PlayerID: ${gamePlayerId}, Card: ${card.rank}${card.suit}`);
          console.log(`[playCard DEBUG_ROUND_STATE] currentSession.status: ${currentSession.status}`);
          console.log(`[playCard DEBUG_ROUND_STATE] currentSession.currentRound: ${currentSession.currentRound}`);
          console.log(`[playCard DEBUG_ROUND_STATE] currentSession.currentTrickNumberInRound (from DB): ${currentSession.currentTrickNumberInRound}`);
          console.log(`[playCard DEBUG_ROUND_STATE] calculated numTricksExpectedThisRound (for currentRound ${currentSession.currentRound}): ${debug_numTricksExpectedThisRound}`);
          // END DEBUG LOGS

          const playersInOrderRaw = currentSession.gamePlayers;

          if (currentSession.status !== 'active_play') {
            socket.emit('actionError', { message: 'Not in active play phase.' });
            return { success: false, error: 'Not in active_play phase' };
          }
          if (currentSession.currentTurnGamePlayerId !== gamePlayerId) {
            socket.emit('actionError', { message: 'Not your turn to play.' });
            return { success: false, error: 'Not your turn' };
          }
          if (currentSession.currentRound === null) {
            socket.emit('actionError', { message: 'Current round is not set.' });
            return { success: false, error: 'Round not set' };
          }

          // Card validation (is it in player's hand? is it a valid play for the trick?)
          const actualCardInDbHandToPlay = await tx.query.playerRoundHands.findFirst({
            where: and(
              eq(schema.playerRoundHands.gamePlayerId, gamePlayerId),
              eq(schema.playerRoundHands.roundNumber, currentSession.currentRound),
              eq(schema.playerRoundHands.cardSuit, card.suit),
              eq(schema.playerRoundHands.cardRank, card.rank),
              eq(schema.playerRoundHands.isPlayed, false) 
            )
          });

          if (!actualCardInDbHandToPlay) {
            socket.emit('actionError', { message: 'Invalid card played or card not in hand.' });
            return { success: false, error: 'Invalid card' };
          }
          
          // Fetch current trick's cards (if any) to validate play
          const currentTrickCardsPlayed = await tx.query.playedCardsInTricks.findMany({
            where: and(
              eq(schema.playedCardsInTricks.gameSessionId, gameId),
              eq(schema.playedCardsInTricks.roundNumber, currentSession.currentRound),
              eq(schema.playedCardsInTricks.trickNumberInRound, currentSession.currentTrickNumberInRound ?? 0)
            ),
            orderBy: [asc(schema.playedCardsInTricks.playSequenceInTrick)]
          });
          
          const isFirstCardOfTrick = currentTrickCardsPlayed.length === 0;

          const leadSuitForTrick = isFirstCardOfTrick ? card.suit : currentSession.currentTrickLeadSuit;
          
          const playerHandForValidation: OfflineCard[] = (await tx.query.playerRoundHands.findMany({
            where: and(
              eq(schema.playerRoundHands.gamePlayerId, gamePlayerId),
              eq(schema.playerRoundHands.roundNumber, currentSession.currentRound),
              eq(schema.playerRoundHands.isPlayed, false)
            ),
            columns: { cardSuit: true, cardRank: true }
          })).map(c => ({ suit: c.cardSuit, rank: c.cardRank }));

          if (!currentSession.trumpSuit) {
            socket.emit('actionError', { message: 'Server error: Trump suit not set during active play.' });
            return { success: false, error: 'Trump suit is null in active_play' };
          }

          if (!isValidPlay(playerHandForValidation, card, leadSuitForTrick, currentSession.trumpSuit)) {
            socket.emit('actionError', { message: 'Invalid play. You must follow suit if possible.' });
            return { success: false, error: 'Invalid play according to rules' };
          }
          // --- End Card Validation ---
          
          let currentPlayedTrickId: number | undefined = undefined;
          let playSequenceInTrick = 0;

          if (currentTrickCardsPlayed.length > 0) {
            const existingTrick = await tx.query.playedTricks.findFirst({
               where: and(
                  eq(schema.playedTricks.gameSessionId, gameId),
                  eq(schema.playedTricks.roundNumber, currentSession.currentRound),
                  eq(schema.playedTricks.roundTrickNumber, currentSession.currentTrickNumberInRound ?? 0)
               )
            });
            currentPlayedTrickId = existingTrick?.id;
            playSequenceInTrick = currentTrickCardsPlayed.length; // 0-indexed, so length is next sequence
          } else {
            // console.log(`[playCard] Creating new trick for Game ${gameId}, Round ${currentSession.currentRound}, TrickNum ${currentSession.currentTrickNumberInRound}`); // Less critical
            const [newTrick] = await tx.insert(schema.playedTricks).values({
              gameSessionId: gameId,
              roundNumber: currentSession.currentRound,
              roundTrickNumber: currentSession.currentTrickNumberInRound ?? 1, // Default to 1 if null
              leadSuit: isFirstCardOfTrick ? leadSuitForTrick : null, // Set leadSuit if first card
            }).returning({ id: schema.playedTricks.id });
            if (!newTrick || typeof newTrick.id !== 'number') {
                socket.emit('actionError', { message: 'Failed to create new trick entry.' });
                return { success: false, error: 'Failed to create trick' };
            }
            currentPlayedTrickId = newTrick.id;
            // console.log(`[playCard] New trick created with ID: ${currentPlayedTrickId}`); // Less critical
          }
          
          // Update card as played in player's hand
          await tx.update(schema.playerRoundHands)
            .set({ isPlayed: true })
            .where(eq(schema.playerRoundHands.id, actualCardInDbHandToPlay.id)); // Use the specific ID of the card from hand

          // Record the played card in the trick
          await tx.insert(schema.playedCardsInTricks).values({
            playedTrickId: currentPlayedTrickId!,
            gamePlayerId: gamePlayerId,
            cardSuit: card.suit,
            cardRank: card.rank,
            playSequenceInTrick: playSequenceInTrick,
            gameSessionId: gameId, // Context field
            roundNumber: currentSession.currentRound,
            trickNumberInRound: currentSession.currentTrickNumberInRound ?? 1, // Context field
          });

          // --- Check if Trick is Over ---
          const cardsInCurrentTrickAfterPlay = await tx.query.playedCardsInTricks.findMany({
            where: and(
              eq(schema.playedCardsInTricks.gameSessionId, gameId),
              eq(schema.playedCardsInTricks.roundNumber, currentSession.currentRound),
              eq(schema.playedCardsInTricks.trickNumberInRound, currentSession.currentTrickNumberInRound ?? 1)
            ),
             orderBy: [asc(schema.playedCardsInTricks.playSequenceInTrick)]
          });
          
          let trickOver = false;
          let winningGamePlayerIdForDb: number | undefined = undefined;

          if (cardsInCurrentTrickAfterPlay.length === playersInOrderRaw.length) { // Assuming 4 players
            trickOver = true;
            // Determine trick winner
            const playedCardsForWinnerDet: OfflinePlayedCard[] = cardsInCurrentTrickAfterPlay.map(c => ({
                card: { suit: c.cardSuit, rank: c.cardRank } as OfflineCard, // Simpler cast if suits/ranks align
                playerId: c.gamePlayerId.toString() // determineTrickWinner expects string IDs
            }));
            
            const leadSuitForThisTrick = currentSession.currentTrickLeadSuit || playedCardsForWinnerDet[0]?.card.suit; // Fallback if somehow not set
            const winningOfflinePlayedCard = determineTrickWinner(playedCardsForWinnerDet, currentSession.trumpSuit!); // Removed leadSuitForThisTrick as it's inferred by determineTrickWinner
            winningGamePlayerIdForDb = parseInt(winningOfflinePlayedCard.playerId, 10);

            // Update playedTricks table with winner
            if (winningGamePlayerIdForDb && currentPlayedTrickId) {
              await tx.update(schema.playedTricks)
                .set({ winningGamePlayerId: winningGamePlayerIdForDb /*, updatedAt: new Date() */ }) // updatedAt might not be in playedTricks schema or handled by default
                .where(eq(schema.playedTricks.id, currentPlayedTrickId));
              
              // Increment tricks taken for the winner
              await tx.update(schema.gamePlayers)
                .set({ currentRoundTricksTaken: sql`${schema.gamePlayers.currentRoundTricksTaken} + 1` })
                .where(eq(schema.gamePlayers.id, winningGamePlayerIdForDb));
            } else {
              console.error(`[playCard] CRITICAL: Could not update trick winner. WinnerID: ${winningGamePlayerIdForDb}, TrickID: ${currentPlayedTrickId}`);
            }
          }
          console.log(`[playCard TRICK_OVER_RESULT] GameID: ${gameId}, trickOver: ${trickOver}`);

          // --- Determine Next Turn --- 
          let nextPlayerGamePlayerId: number;
          if (trickOver) {
            if (winningGamePlayerIdForDb === undefined) {
                socket.emit('actionError', { message: 'Error determining trick winner.' });
                return { success: false, error: 'Winner ID undefined post-determination' }; 
            }
            nextPlayerGamePlayerId = winningGamePlayerIdForDb; // Winner of the trick leads next trick
            // console.log(`[playCard] Trick winner ${nextPlayerGamePlayerId} leads next trick.`);
          }
          else {
            const currentPlayerGamePlayerId = currentSession.currentTurnGamePlayerId;
            const currentPlayerIndex = playersInOrderRaw.findIndex((p: schema.GamePlayer) => p.id === currentPlayerGamePlayerId);
            if (currentPlayerIndex === -1) {
              socket.emit('actionError', { message: 'Error determining current player index for next turn.' });
              return { success: false, error: 'Player index error for next turn' };
            }
            nextPlayerGamePlayerId = playersInOrderRaw[(currentPlayerIndex + 1) % playersInOrderRaw.length].id; // Ensure this assignment is present
            // console.log(`[playCard] Trick not over. Next turn for player ${nextPlayerGamePlayerId}.`); // Less critical
          }

          // --- Update Game Session --- 
          const gameSessionUpdateData: Partial<typeof schema.gameSessions.$inferInsert> = {
            currentTurnGamePlayerId: nextPlayerGamePlayerId,
            updatedAt: new Date(),
          };

          if (isFirstCardOfTrick) { // This was the first card of the trick that just started/continued
            gameSessionUpdateData.currentTrickLeadSuit = card.suit; // Corrected: leadSuit is the suit of the card played
          }

          if (trickOver) {
            gameSessionUpdateData.currentTrickNumberInRound = (currentSession.currentTrickNumberInRound ?? 0) + 1;
            gameSessionUpdateData.currentTrickLeadSuit = null; // Reset for the next trick
            
            // **Round Completion & Next Round Preparation (integrated with playCard):**
            // Detects end of a round based on currentTrickNumberInRound and ROUND_DISTRIBUTION.
            // currentRound is 1-indexed. ROUND_DISTRIBUTION is 0-indexed.
            // Use currentSession for immutable properties like currentRound.
            const numTricksExpectedThisRound = ROUND_DISTRIBUTION[currentSession.currentRound! - 1];
            // Add a log here too, just before the critical check
            console.log(`[playCard DEBUG_ROUND_END_CHECK] GameID: ${gameId}, currentRound: ${currentSession.currentRound}, currentTrickNumberInRound_from_session: ${currentSession.currentTrickNumberInRound}, gameSessionUpdateData.currentTrickNumberInRound_for_next: ${gameSessionUpdateData.currentTrickNumberInRound}, numTricksExpectedThisRound: ${numTricksExpectedThisRound}`);
            
            // Check if the trick that just ended was the last trick of the round
            // gameSessionUpdateData.currentTrickNumberInRound is the number for the *next* trick
            if (gameSessionUpdateData.currentTrickNumberInRound > numTricksExpectedThisRound) {
              console.log(`[playCard] Round ${currentSession.currentRound} for game ${gameId} is over. Calculating scores...`);
              
              // --- Scoring ---
              const playersForScoring = await tx.query.gamePlayers.findMany({
                where: eq(schema.gamePlayers.gameSessionId, gameId),
                columns: { id: true, currentScore: true, currentRoundTricksTaken: true }
              });

              const bidsForRound = await tx.query.playerBids.findMany({
                where: and(
                  eq(schema.playerBids.gameSessionId, gameId),
                  eq(schema.playerBids.roundNumber, currentSession.currentRound!)
                )
              });

              for (const player of playersForScoring) {
                let scoreChange = 0;
                const bidRecord = bidsForRound.find(b => b.gamePlayerId === player.id);
                if (bidRecord) {
                  const bidAmount = bidRecord.bidAmount;
                  const tricksActuallyTaken = player.currentRoundTricksTaken;

                  // console.log(`[server.ts] About to call calculatePlayerScore for player ${player.id}. Bid: ${bidAmount}, Tricks: ${tricksActuallyTaken}`);
                  scoreChange = calculatePlayerScore(bidAmount, tricksActuallyTaken);
                  
                  const newPlayerScore = player.currentScore + scoreChange;

                  // Log the score change for the round
                  await tx.insert(schema.playerRoundScoreChanges).values({
                    gameSessionId: gameId, // current gameId
                    gamePlayerId: player.id, // id of the GamePlayer
                    roundNumber: currentSession.currentRound!, // current round number from session
                    scoreChange: scoreChange, // the calculated score change for this round
                    tricksTaken: player.currentRoundTricksTaken, // Populate the new field
                    // createdAt will default
                  });

                  await tx.update(schema.gamePlayers)
                    .set({
                      currentScore: newPlayerScore,
                      currentRoundTricksTaken: 0 // Reset for next round
                    })
                    .where(eq(schema.gamePlayers.id, player.id));
                } else {
                  // console.error(`[server.ts] CRITICAL: No bid record found. Player ID: ${player ? player.id : 'N/A'}, Round: ${currentSession.currentRound}`);
                }
              }
              
              // ---- Transition to Round Summary ----
              gameSessionUpdateData.status = 'round_summary';
              // The actual progression to the next round or game end will be handled by a new 'proceedToNextRound' event.
              // We will NOT set currentRound, trumpSuit, dealer, turn, or deal cards here anymore.
              // We will also NOT set winnerGamePlayerId or status='finished' here directly.
              // This keeps the game in a 'round_summary' state until players acknowledge.
              console.log(`[playCard] Game ${gameId} status set to round_summary. Initiating timeout.`);
              // Clear existing timeout for this game, if any
              const existingTimeout = roundSummaryTimeouts.get(gameId);
              if (existingTimeout) {
                clearTimeout(existingTimeout);
                roundSummaryTimeouts.delete(gameId);
              }
              // Set new timeout
              const timeoutId = setTimeout(() => {
                console.log(`[Server] Round summary timeout for game ${gameId}. Attempting to auto-proceed.`);
                // Call the refactored game continuation logic
                triggerGameContinuation(io, gameId, "timeout_auto_proceed"); 
                roundSummaryTimeouts.delete(gameId); // Clean up after timeout fires
              }, ROUND_SUMMARY_TIMEOUT_MS);
              roundSummaryTimeouts.set(gameId, timeoutId);


              // Comment out or remove old next round/game end logic from here:
              /*
              const nextRoundNumber = currentSession.currentRound! + 1;
              if (nextRoundNumber > ROUND_DISTRIBUTION.length) {
                // Game Over
                gameSessionUpdateData.status = 'finished';
                gameSessionUpdateData.currentTurnGamePlayerId = null; 
                // console.log("[playCard] Game is over. Final round was: ", currentSession.currentRound); 

                let topScore = -Infinity;
                let potentialWinners: schema.GamePlayer[] = [];

                for (const player of playersInOrderRaw) {
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
                  // console.log(`[playCard] Game winner determined: Player ${gameWinner.id} with score ${gameWinner.currentScore}. Tie-breakers (if any) resolved by playerOrder.`);
                } else {
                  // console.error(`[playCard] CRITICAL: Could not determine game winner for game ${gameId}. No players found or scores were problematic.`);
                }
              } else {
                // Prepare for Next Round
                gameSessionUpdateData.currentRound = nextRoundNumber;
                gameSessionUpdateData.currentTrickNumberInRound = 1; 
                gameSessionUpdateData.status = 'bidding'; 
                
                const newTrumpSuit = determineTrumpForNewRound();
                gameSessionUpdateData.trumpSuit = newTrumpSuit;
                
                const currentDealerIndex = playersInOrderRaw.findIndex(p => p.id === currentSession.currentDealerId);
                let nextDealerId = currentSession.currentDealerId; 
                if (currentDealerIndex !== -1 && playersInOrderRaw.length > 0) {
                    nextDealerId = playersInOrderRaw[(currentDealerIndex + 1) % playersInOrderRaw.length].id;
                }
                gameSessionUpdateData.currentDealerId = nextDealerId;
                const nextDealerActualIndex = playersInOrderRaw.findIndex(p => p.id === nextDealerId);
                if (nextDealerActualIndex !== -1 && playersInOrderRaw.length > 0) {
                    gameSessionUpdateData.currentTurnGamePlayerId = playersInOrderRaw[(nextDealerActualIndex + 1) % playersInOrderRaw.length].id;
                }

                // console.log(`[playCard] Preparing for round ${nextRoundNumber}. Status: bidding. New Trump: ${newTrumpSuit}. New Dealer: ${gameSessionUpdateData.currentDealerId}, First to bid: ${gameSessionUpdateData.currentTurnGamePlayerId}`); 
                await dealCardsForRound(tx, gameId, nextRoundNumber, playersInOrderRaw.map(p => ({id: p.id })));
              }
              */
            }
          }

          await tx.update(schema.gameSessions)
            .set(gameSessionUpdateData)
            .where(eq(schema.gameSessions.id, gameId));
          
          console.log(`[playCard TXN_END] GameID: ${gameId}, PlayerID: ${gamePlayerId}. DB updated. success: true`);
          return { success: true };
        });

        
        if (result && result.success) {
          let updatedGameData;
          try {
            console.log(`[playCard PRE_GET_GAME_DATA] GameID: ${gameId}`);
            updatedGameData = await getGameDataForBroadcast(gameId);
            console.log(`[playCard POST_GET_GAME_DATA] GameID: ${gameId}, Data fetched: ${!!updatedGameData}`);
          } catch (e) {
            console.error(`[playCard CATCH_ERROR_GET_GAME_DATA] GameID: ${gameId}, Error: `, e);
            throw e; 
          }

          if (updatedGameData) {
            try {
              console.log(`[playCard PRE_IO_EMIT] GameID: ${gameId}`);
              io.to(gameId.toString()).emit('gameStateUpdate', updatedGameData);
              console.log(`[playCard POST_IO_EMIT] GameID: ${gameId}`);
            } catch (e) {
              console.error(`[playCard CATCH_ERROR_IO_EMIT] GameID: ${gameId}, Error: `, e);
              throw e; 
            }
          }
          try {
            console.log(`[playCard PRE_SOCKET_EMIT_SUCCESS] GameID: ${gameId}`);
            socket.emit('playCardSuccess', { message: 'Kaart gespeeld succesvol.', gameId: gameId });
            console.log(`[playCard SUCCESS_EMIT] GameID: ${gameId}, PlayerID: ${gamePlayerId}`);
          } catch (e) {
            console.error(`[playCard CATCH_ERROR_SOCKET_EMIT_SUCCESS] GameID: ${gameId}, Error: `, e);
            throw e;
          }
        } else if (result && result.error) {
          console.error(`[playCard ERROR_RESULT] GameID: ${gameId}, PlayerID: ${gamePlayerId}, Error: ${result.error}`);
        }

      } catch (error) {
        console.error(`[playCard CATCH_ERROR] GameID: ${gameId}, PlayerID: ${gamePlayerId}, Card: ${card.rank} of ${card.suit}, Error: `, error);
        socket.emit('actionError', { message: 'Server error processing card play.' });
      }
    });

    socket.on('proceedToNextRound', async (data: { gameId: number }) => {
      const { gameId } = data;
      console.log(`[proceedToNextRound] Received for game ${gameId} from host action.`);

      // Clear existing timeout if host proceeds manually
      const existingTimeout = roundSummaryTimeouts.get(gameId);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
        roundSummaryTimeouts.delete(gameId);
        console.log(`[proceedToNextRound] Cleared existing round_summary timeout for game ${gameId}.`);
      }
      
      await triggerGameContinuation(io, gameId, "host_manual_proceed");
    });

  });

  httpServer.listen(PORT, () => {
    console.log(`> Ready on http://localhost:${PORT}`); 
  });
}); 