import { createServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';

// Drizzle and DB imports
import { db } from './lib/db/drizzle';
import * as schema from './lib/db/schema';
import { eq, and, sql, asc, desc, inArray, type InferSelectModel, type InferInsertModel } from 'drizzle-orm';
import { ROUND_DISTRIBUTION } from './lib/game/round';
import { getTrumpSuit as determineTrumpForNewRound } from './lib/game/round';
import { calculatePlayerScore } from './lib/game/game';
import { determineTrickWinner, type PlayedCard as OfflinePlayedCard, isValidPlay } from './lib/game/trick';
import type { Card as OfflineCard } from './lib/game/deck';

// Define the enum type for game status explicitly and correctly
type GameStatusEnum = "pending" | "active" | "bidding" | "active_play" | "round_over" | "finished" | "archived" | "round_summary";

// Timeout management for round_summary
const roundSummaryTimeouts = new Map<number, NodeJS.Timeout>();
const ROUND_SUMMARY_TIMEOUT_MS = 10000; // 10 seconds

const port = parseInt(process.env.SOCKET_PORT || '3001', 10);

// Helper function to deal cards for a new round
async function dealCardsForRound(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  gameId: number,
  roundNumber: number,
  players: Pick<schema.GamePlayer, 'id'>[]
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
    await tx.delete(schema.playerRoundHands)
      .where(and(
        eq(schema.playerRoundHands.gameSessionId, gameId),
        eq(schema.playerRoundHands.roundNumber, previousRoundNumber)
      ));
  }

  // 2. Determine number of cards to deal
  const numCardsToDeal = ROUND_DISTRIBUTION[roundNumber - 1];

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
          isPlayed: false,
        });
      } else {
        console.error("[dealCardsForRound] Ran out of cards in deck while dealing!");
        throw new Error('Stok kaarten is op tijdens het delen.');
      }
    }
  }

  if (newHands.length > 0) {
    await tx.insert(schema.playerRoundHands).values(newHands);
  }
}

// Helper to fetch full game state for broadcasting
async function getGameDataForBroadcast(gameId: number) {
  console.log(`[getGameDataForBroadcast ENTER] GameID: ${gameId}`);
  try {
    const session = await db.query.gameSessions.findFirst({
      columns: {
        id: true,
        name: true,
        status: true,
        currentRound: true,
        trumpSuit: true,
        currentDealerId: true,
        currentTurnGamePlayerId: true,
        currentTrickLeadSuit: true,
        currentTrickNumberInRound: true
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

    if (!session) {
      console.error(`[getGameDataForBroadcast ERROR] Session not found for gameId: ${gameId}`);
      return null;
    }
    
    if (!session.gamePlayers || session.gamePlayers.length === 0) {
      return null; 
    }

    const currentBids = await db.select()
      .from(schema.playerBids)
      .innerJoin(schema.gamePlayers, eq(schema.playerBids.gamePlayerId, schema.gamePlayers.id))
      .where(and(eq(schema.gamePlayers.gameSessionId, gameId), eq(schema.playerBids.roundNumber, session.currentRound ?? 0)));

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
        userName: gp.user?.name || `Speler ${gp.playerOrder + 1}`,
        userEmail: gp.user?.email || '-',
        playerOrder: gp.playerOrder,
        currentScore: gp.currentScore,
        currentBid: bidRecord ? bidRecord.player_bids.bidAmount : null,
        hand: playerHand,
      };
    }));

    // Fetch cards played in the current trick
    let currentTrickPlaysData: { gamePlayerId: number; userName: string; cardSuit: string; cardRank: string; playSequenceInTrick: number }[] = [];
    if (session.status === 'active_play' && session.currentRound !== null && session.currentTrickNumberInRound !== null) {
      const trickPlayRecords = await db.query.playedCardsInTricks.findMany({
        where: and(
          eq(schema.playedCardsInTricks.gameSessionId, gameId),
          eq(schema.playedCardsInTricks.roundNumber, session.currentRound),
          eq(schema.playedCardsInTricks.trickNumberInRound, session.currentTrickNumberInRound)
        ),
        orderBy: [asc(schema.playedCardsInTricks.playSequenceInTrick)],
      });

      currentTrickPlaysData = trickPlayRecords.map(tp => {
        const playerDetails = playersWithDetails.find(p => p.id === tp.gamePlayerId);
        return {
          gamePlayerId: tp.gamePlayerId,
          userName: playerDetails?.userName || `Speler_Fallback_${tp.gamePlayerId}`,
          cardSuit: tp.cardSuit,
          cardRank: tp.cardRank,
          playSequenceInTrick: tp.playSequenceInTrick
        };
      });
    }

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

    if (session.currentRound !== null && session.currentRound > 0) {
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

      allCompletedTricksData = completedTricksFromDb.map(trick => {
        const winnerDetails = playersWithDetails.find(p => p.id === trick.winningGamePlayerId);
        return {
          trickNumberInRound: trick.roundTrickNumber,
          winningGamePlayerId: trick.winningGamePlayerId!,
          winnerName: winnerDetails?.userName || `Winner_Fallback_${trick.winningGamePlayerId}`,
          cards: trick.cardsInTrick.map(cardInTrick => {
            const playerDetails = playersWithDetails.find(p => p.id === cardInTrick.gamePlayerId);
            return {
              gamePlayerId: cardInTrick.gamePlayerId,
              playerName: playerDetails?.userName || `Player_Fallback_${cardInTrick.gamePlayerId}`,
              cardSuit: cardInTrick.cardSuit,
              cardRank: cardInTrick.cardRank,
              playSequenceInTrick: cardInTrick.playSequenceInTrick,
            };
          }),
        };
      });
    }

    // Round Summary Data
    let roundSummaryDataForClient: Array<{
      roundNumber: number;
      playerRoundDetails: Array<{
        gamePlayerId: number;
        playerName: string;
        scoreChange: number;
        cumulativeScoreAfterRound: number;
      }>;
    }> = [];

    const scoreChanges = await db.query.playerRoundScoreChanges.findMany({
        where: eq(schema.playerRoundScoreChanges.gameSessionId, gameId),
        orderBy: [asc(schema.playerRoundScoreChanges.roundNumber), asc(schema.playerRoundScoreChanges.gamePlayerId)]
    });

    if (scoreChanges.length > 0) {
        const maxRoundWithScores = scoreChanges[scoreChanges.length - 1].roundNumber;
        const playerCumulativeScores: { [gamePlayerId: number]: number } = {};
        
        session.gamePlayers.forEach(p => {
            playerCumulativeScores[p.id] = 0;
        });

        for (let r = 1; r <= maxRoundWithScores; r++) {
            const detailsForThisRound: typeof roundSummaryDataForClient[0]['playerRoundDetails'] = [];
            const changesForThisSpecificRound = scoreChanges.filter(sc => sc.roundNumber === r);

            for (const player of playersWithDetails) {
                const changeRecord = changesForThisSpecificRound.find(sc => sc.gamePlayerId === player.id);
                const scoreChangeThisRound = changeRecord ? changeRecord.scoreChange : 0;
                
                playerCumulativeScores[player.id] += scoreChangeThisRound;

                detailsForThisRound.push({
                    gamePlayerId: player.id,
                    playerName: player.userName,
                    scoreChange: scoreChangeThisRound,
                    cumulativeScoreAfterRound: playerCumulativeScores[player.id]
                });
            }
            roundSummaryDataForClient.push({
                roundNumber: r,
                playerRoundDetails: detailsForThisRound.sort((a,b) => {
                    const playerAOrder = playersWithDetails.find(p => p.id === a.gamePlayerId)?.playerOrder ?? 99;
                    const playerBOrder = playersWithDetails.find(p => p.id === b.gamePlayerId)?.playerOrder ?? 99;
                    return playerAOrder - playerBOrder;
                })
            });
        }
    }

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
    };
    
    return finalData;
  } catch (error) {
    console.error(`[getGameDataForBroadcast CATCH_ERROR] GameID: ${gameId}, Error:`, error);
    throw error;
  }
}

// Helper function to manage tasks after round_summary acknowledgement
async function handleRoundCompletionOrGameEnd(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  gameId: number,
  currentSession: InferSelectModel<typeof schema.gameSessions> & { gamePlayers: Pick<schema.GamePlayer, 'id' | 'playerOrder' | 'currentScore'>[] },
  playersInOrder: (Pick<schema.GamePlayer, 'id' | 'playerOrder' | 'currentScore'>)[]
) {
  const gameSessionUpdateData: Partial<typeof schema.gameSessions.$inferInsert> = { updatedAt: new Date() };
  const currentRoundNumber = currentSession.currentRound;

  if (currentRoundNumber === null) {
    console.error(`[handleRoundCompletionOrGameEnd] Critical error: currentRoundNumber is null for game ${gameId}. Cannot proceed.`);
    gameSessionUpdateData.status = 'archived';
    await tx.update(schema.gameSessions).set(gameSessionUpdateData).where(eq(schema.gameSessions.id, gameId));
    return { success: false, error: 'Critical: Current round is null.' };
  }

  const nextRoundNumber = currentRoundNumber + 1;

  if (nextRoundNumber > ROUND_DISTRIBUTION.length) {
    // Game Over
    gameSessionUpdateData.status = 'finished';
    gameSessionUpdateData.currentTurnGamePlayerId = null;

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
    let nextDealerId = currentDealerId;
    if (currentDealerIndex !== -1 && playersInOrder.length > 0) {
      nextDealerId = playersInOrder[(currentDealerIndex + 1) % playersInOrder.length].id;
    }
    gameSessionUpdateData.currentDealerId = nextDealerId;

    const nextDealerActualIndex = playersInOrder.findIndex(p => p.id === nextDealerId);
    if (nextDealerActualIndex !== -1 && playersInOrder.length > 0) {
      gameSessionUpdateData.currentTurnGamePlayerId = playersInOrder[(nextDealerActualIndex + 1) % playersInOrder.length].id;
    } else if (playersInOrder.length > 0) {
      gameSessionUpdateData.currentTurnGamePlayerId = playersInOrder[0].id;
    }

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
      return; 
    }

    if (currentSession.status !== 'round_summary') {
      console.warn(`[triggerGameContinuation] Game ${gameId} is in status '${currentSession.status}', not 'round_summary'. Cannot advance. Source: ${source}`);
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

// Main function to start the Socket.IO server
async function startSocketServer() {
  const httpServer = createServer();

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

        if (!gameId || !gamePlayerId || bidAmount === undefined || !roundNumber) {
          socket.emit('actionError', { message: 'Ongeldige bidgegevens.' });
          return;
        }

        await db.transaction(async (tx) => {
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

          if (gameSession.currentTurnGamePlayerId !== gamePlayerId) {
            socket.emit('actionError', { message: 'Het is niet jouw beurt om te bieden.' });
            return;
          }

          const currentRoundIndex = (gameSession.currentRound || 1) - 1;
          const maxBid = ROUND_DISTRIBUTION[currentRoundIndex] || 0;
          if (bidAmount < 0 || bidAmount > maxBid) {
            socket.emit('actionError', { message: `Bod moet tussen 0 en ${maxBid} zijn.` });
            return;
          }

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

          await tx.insert(schema.playerBids).values({
            gameSessionId: gameId,
            gamePlayerId,
            roundNumber,
            bidAmount,
            createdAt: new Date()
          });

          const currentPlayerIndex = gameSession.gamePlayers.findIndex(p => p.id === gamePlayerId);
          const nextPlayerIndex = (currentPlayerIndex + 1) % gameSession.gamePlayers.length;
          const nextPlayer = gameSession.gamePlayers[nextPlayerIndex];

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
            gameSessionUpdate.status = 'active_play';
            
            const playersInOrder = gameSession.gamePlayers.sort((a, b) => a.playerOrder - b.playerOrder);
            const dealerIndex = playersInOrder.findIndex(p => p.id === gameSession.currentDealerId);
            const firstPlayerIndex = (dealerIndex + 1) % playersInOrder.length;
            const firstPlayer = playersInOrder[firstPlayerIndex];
            
            gameSessionUpdate.currentTurnGamePlayerId = firstPlayer.id;
          } else {
            gameSessionUpdate.currentTurnGamePlayerId = nextPlayer.id;
          }

          await tx.update(schema.gameSessions)
            .set(gameSessionUpdate)
            .where(eq(schema.gameSessions.id, gameId));
        });

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

        if (!gameId || !gamePlayerId || !card || !card.suit || !card.rank) {
          socket.emit('actionError', { message: 'Ongeldige kaartgegevens.' });
          return;
        }

        await db.transaction(async (tx) => {
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

          if (gameSession.currentTurnGamePlayerId !== gamePlayerId) {
            socket.emit('actionError', { message: 'Het is niet jouw beurt om te spelen.' });
            return;
          }

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

          const playerHandRecords = await tx.query.playerRoundHands.findMany({
            where: and(
              eq(schema.playerRoundHands.gamePlayerId, gamePlayerId),
              eq(schema.playerRoundHands.gameSessionId, gameId),
              eq(schema.playerRoundHands.roundNumber, gameSession.currentRound || 1),
              eq(schema.playerRoundHands.isPlayed, false)
            )
          });

          const playerHand: OfflineCard[] = playerHandRecords.map(handCard => ({
            suit: handCard.cardSuit as schema.Suit,
            rank: handCard.cardRank as schema.Rank
          }));

          const cardToPlay: OfflineCard = { suit: card.suit as schema.Suit, rank: card.rank as schema.Rank };

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

          if (!isValidPlay(playerHand, cardToPlay, leadSuit, trumpSuit)) {
            socket.emit('actionError', { message: 'Ongeldige kaartspel. Je moet de kleur volgen als je deze hebt, anders troef spelen als je troef hebt.' });
            return;
          }

          await tx.update(schema.playerRoundHands)
            .set({ isPlayed: true })
            .where(eq(schema.playerRoundHands.id, playerCard.id));

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

          const existingPlays = await tx.query.playedCardsInTricks.findMany({
            where: and(
              eq(schema.playedCardsInTricks.playedTrickId, currentTrick.id)
            )
          });

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

          if (existingPlays.length + 1 >= 4) {
            const allCardsInTrick = await tx.query.playedCardsInTricks.findMany({
              where: and(
                eq(schema.playedCardsInTricks.playedTrickId, currentTrick.id)
              ),
              orderBy: [asc(schema.playedCardsInTricks.playSequenceInTrick)]
            });

            const offlineCards: OfflinePlayedCard[] = allCardsInTrick.map(dbCard => ({
              playerId: dbCard.gamePlayerId.toString(),
              card: { suit: dbCard.cardSuit, rank: dbCard.cardRank },
              playSequenceInTrick: dbCard.playSequenceInTrick
            }));

            const trickWinner = determineTrickWinner(offlineCards, trumpSuit);
            
            await tx.update(schema.playedTricks)
              .set({ winningGamePlayerId: parseInt(trickWinner.playerId) })
              .where(eq(schema.playedTricks.id, currentTrick.id));

            await tx.update(schema.gamePlayers)
              .set({ 
                currentRoundTricksTaken: sql`${schema.gamePlayers.currentRoundTricksTaken} + 1`,
                updatedAt: new Date()
              })
              .where(eq(schema.gamePlayers.id, parseInt(trickWinner.playerId)));

            const currentRoundNumber = gameSession.currentRound || 1;
            const expectedTricksThisRound = ROUND_DISTRIBUTION[currentRoundNumber - 1] || 0;
            const currentTrickNumber = gameSession.currentTrickNumberInRound || 1;

            if (currentTrickNumber >= expectedTricksThisRound) {
              console.log(`[Socket playCard] Round ${currentRoundNumber} complete. Calculating scores...`);
              
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

              for (const player of playersWithStats) {
                const bidRecord = bidsThisRound.find(b => b.gamePlayerId === player.id);
                const bid = bidRecord ? bidRecord.bidAmount : 0;
                const tricksTaken = player.currentRoundTricksTaken;
                
                const scoreChange = calculatePlayerScore(bid, tricksTaken);
                const newCumulativeScore = player.currentScore + scoreChange;

                await tx.update(schema.gamePlayers)
                  .set({ 
                    currentScore: newCumulativeScore,
                    currentRoundTricksTaken: 0,
                    updatedAt: new Date()
                  })
                  .where(eq(schema.gamePlayers.id, player.id));

                await tx.insert(schema.playerRoundScoreChanges).values({
                  gameSessionId: gameId,
                  gamePlayerId: player.id,
                  roundNumber: currentRoundNumber,
                  scoreChange,
                  tricksTaken,
                  createdAt: new Date()
                });
              }

              gameSessionUpdate.status = 'round_summary';
              gameSessionUpdate.currentTurnGamePlayerId = null;
              console.log(`[Socket playCard] Setting game ${gameId} to round_summary status`);

              setTimeout(() => {
                triggerGameContinuation(io, gameId, 'auto_timeout');
              }, ROUND_SUMMARY_TIMEOUT_MS);

            } else {
              gameSessionUpdate.currentTrickNumberInRound = currentTrickNumber + 1;
              gameSessionUpdate.currentTurnGamePlayerId = parseInt(trickWinner.playerId);
              console.log(`[Socket playCard] Trick ${currentTrickNumber} complete. Winner ${trickWinner.playerId} starts trick ${currentTrickNumber + 1}`);
            }
          } else {
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

    socket.on('clientNewGameCreated', (data: { newGameId: number }) => {
      console.log(`[Socket clientNewGameCreated] Received from socket ${socket.id}:`, data);
      io.emit('openGamesUpdated', { newGameId: data.newGameId });
      console.log(`[Socket clientNewGameCreated] Broadcasted 'openGamesUpdated' event for game ${data.newGameId}`);
    });

    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
    });
  });

  httpServer
    .once('error', (err) => {
      console.error('Socket.IO server error:', err);
      process.exit(1);
    })
    .listen(port, () => {
      console.log(`> Socket.IO server ready on http://localhost:${port}`);
    });
}

// Start the Socket.IO server
startSocketServer().catch(err => {
  console.error("Socket.IO server failed to start:", err);
  process.exit(1);
}); 