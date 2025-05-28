// lib/game/game.ts

import { Player as RoundPlayer, PlayerBid as RoundPlayerBidOriginal, getTrumpSuit, dealCardsForRound, biddingPhase, ROUND_DISTRIBUTION } from './round'; 
import { Card, Deck, Suit } from './deck';
import { simulateTrick, PlayedCard } from './trick';

// Enhanced Player type for game-level state
export interface GamePlayer {
  id: string;
  hand: Card[];
  bid: number; // Bid for the current round
  tricksTaken: number; // Tricks taken in the current round
  score: number; // Cumulative score across all rounds
}

// Represents the overall game state, including all players and their scores
export interface GameState {
  gamePlayers: GamePlayer[]; 
  currentRoundNumber: number; // 0-indexed
  dealerIndex: number; // Index of the current dealer (0-3)
  // We might add game history, round-specific details etc. later
}

/**
 * Calculates the score for a single player for a completed round.
 *
 * Scoring Rules (as per requirements.md section 5):
 * 1. Exact prediction (tricks taken === bid):
 *    10 + (3 * tricksTaken)
 * 2. Incorrect prediction (tricks taken !== bid):
 *    -3 * Math.abs(bid - tricksTaken)
 *
 * @param bid The number of tricks the player bid (prediction).
 * @param tricksTaken The number of tricks the player actually took (actual).
 * @returns The score for the player for this round.
 */
export function calculatePlayerScore(
  bid: number,
  tricksTaken: number
): number {
  let score: number;
  let predictionType: string;

  if (tricksTaken === bid) {
    // Exact prediction
    score = 10 + (3 * tricksTaken);
    predictionType = "Exact prediction";
  } else {
    // Incorrect prediction
    score = -3 * Math.abs(bid - tricksTaken);
    predictionType = "Incorrect prediction";
  }

  console.log(
    `[calculatePlayerScore] Input bid: ${bid}, Input tricksTaken: ${tricksTaken}. Type: "${predictionType}". Calculated score: ${score}`
  );

  return score;
}

// Interface for storing a player's bid along with actual tricks taken for result reporting
export interface PlayerBidWithActual {
    playerId: string;
    bid: number;
    actual: number; // Actual tricks taken
}

export interface RoundResult {
  roundNumber: number;
  numberOfCards: number;
  trumpSuit: Suit;
  bids: PlayerBidWithActual[]; // Use the new interface here
  tricksPlayed: PlayedCard[][]; 
  tricksTakenByPlayer: { [playerId: string]: number };
  scoresForRound: { [playerId: string]: number };
  cumulativeScores: { [playerId: string]: number };
  startingPlayerIndex: number;
}

/**
 * Simulates a single round of the game.
 * - Deals cards
 * - Determines trump
 * - Handles bidding
 * - Plays all tricks
 * - Calculates scores for the round and updates cumulative scores for players
 *
 * @param deck The game deck, already initialized and shuffled.
 * @param players Array of GamePlayer objects. Their hands will be dealt, bids recorded, tricks taken updated, and scores updated.
 * @param roundNumber The current round number (0-indexed).
 * @param dealerIndex The index of the player who is the dealer for this round.
 * @returns RoundResult object with details of the round.
 */
export function simulateRound(
  deck: Deck,
  players: GamePlayer[],
  roundNumber: number,
  dealerIndex: number // Player to the left of dealer starts bidding and playing first trick
): RoundResult {
  deck.reset(); // Ensure deck is fresh and shuffled for the round

  const numberOfCards = ROUND_DISTRIBUTION[roundNumber];
  const trumpSuit = getTrumpSuit();

  // Reset round-specific player stats
  players.forEach(p => {
    p.hand = [];
    p.bid = 0;
    p.tricksTaken = 0;
  });

  // Deal cards
  for (let i = 0; i < numberOfCards; i++) {
    for (let j = 0; j < players.length; j++) {
      // Deal in turn, starting from player left of dealer
      const playerIndex = (dealerIndex + 1 + j) % players.length;
      const card = deck.dealCard();
      if (card) {
        players[playerIndex].hand.push(card);
      } else {
        throw new Error('Deck ran out of cards unexpectedly during dealing.');
      }
    }
  }
  
  // Bidding phase - requires players in the format {id: string, hand: Card[]}
  // The player to the left of the dealer starts the bidding.
  const biddingOrderPlayerIndices = players.map((p,idx) => (dealerIndex + 1 + idx) % players.length);
  const roundPlayersForBidding: RoundPlayer[] = biddingOrderPlayerIndices.map(idx => ({
    id: players[idx].id,
    hand: players[idx].hand, 
  }));

  // The biddingPhase in round.ts expects players sorted by bidding order.
  // We need to map bids back to original players later.
  const playerBidsOriginal: RoundPlayerBidOriginal[] = biddingPhase(roundPlayersForBidding, roundNumber);

  // Prepare bids with actuals (actuals will be filled after tricks are played)
  const bidsWithActuals: PlayerBidWithActual[] = playerBidsOriginal.map(b => ({
      playerId: b.playerId,
      bid: b.bid,
      actual: 0 // Initialize actual, will be updated later
  }));

  // Map original bids back to the GamePlayer objects and store them
  playerBidsOriginal.forEach(bidInfo => {
    const playerToUpdate = players.find(p => p.id === bidInfo.playerId);
    if (playerToUpdate) {
      playerToUpdate.bid = bidInfo.bid;
    } else {
      throw new Error(`Could not find player with ID ${bidInfo.playerId} to update bid.`);
    }
  });

  let currentStartingPlayerIndex = (dealerIndex + 1) % players.length;
  const tricksPlayed: PlayedCard[][] = [];
  const tricksTakenByPlayer: { [playerId: string]: number } = {};
  players.forEach(p => { tricksTakenByPlayer[p.id] = 0; });

  // Play tricks
  for (let i = 0; i < numberOfCards; i++) {
    // Create a temporary array of players for simulateTrick, as it modifies hands directly.
    // Ensure the player objects passed to simulateTrick have the current hands.
    // The order of players passed to simulateTrick matters for turn sequence based on startingPlayerIndex.
    const playersForTrick: RoundPlayer[] = players.map(p => ({ id: p.id, hand: [...p.hand] }));
    
    const trickResult = simulateTrick(playersForTrick, currentStartingPlayerIndex, trumpSuit);
    tricksPlayed.push(trickResult.trickPlays);
    tricksTakenByPlayer[trickResult.winner.playerId]++;

    // Update original player hands after the trick
    players.forEach((gp, index) => {
      const playerInTrickSim = playersForTrick.find(pfs => pfs.id === gp.id);
      if(playerInTrickSim) {
         gp.hand = playerInTrickSim.hand; // Hand was modified by simulateTrick
      }
    });
    
    // Winner of the trick starts the next trick
    currentStartingPlayerIndex = players.findIndex(p => p.id === trickResult.winner.playerId);
    if (currentStartingPlayerIndex === -1) {
        throw new Error("Could not find trick winner in players array to determine next starting player.")
    }
  }

  // Calculate scores for the round and update cumulative scores
  const scoresForRound: { [playerId: string]: number } = {};
  players.forEach(player => {
    player.tricksTaken = tricksTakenByPlayer[player.id];
    // Update actual tricks taken in bidsWithActuals array for the report
    const bidRecord = bidsWithActuals.find(b => b.playerId === player.id);
    if (bidRecord) {
        bidRecord.actual = player.tricksTaken;
    }

    const roundScore = calculatePlayerScore(player.bid, player.tricksTaken);
    scoresForRound[player.id] = roundScore;
    player.score += roundScore; // Update cumulative score
  });

  return {
    roundNumber,
    numberOfCards,
    trumpSuit,
    bids: bidsWithActuals, // Use the array that now contains actuals
    tricksPlayed,
    tricksTakenByPlayer,
    scoresForRound,
    cumulativeScores: players.reduce((acc, p) => ({ ...acc, [p.id]: p.score }), {}),
    startingPlayerIndex: (dealerIndex + 1) % players.length // Original starting player for the round
  };
}

export interface GameResult {
  finalScores: { [playerId: string]: number };
  winnerIds: string[]; // Could be multiple in case of a tie
  allRoundResults: RoundResult[];
}

/**
 * Simulates a full 17-round game for 4 players.
 * @returns GameResult object with final scores, winner(s), and all round results.
 */
export function simulateGame(): GameResult {
  const players: GamePlayer[] = [
    { id: 'Player 1', hand: [], bid: 0, tricksTaken: 0, score: 0 },
    { id: 'Player 2', hand: [], bid: 0, tricksTaken: 0, score: 0 },
    { id: 'Player 3', hand: [], bid: 0, tricksTaken: 0, score: 0 },
    { id: 'Player 4', hand: [], bid: 0, tricksTaken: 0, score: 0 },
  ];
  const deck = new Deck();
  const allRoundResults: RoundResult[] = [];

  let currentDealerIndex = Math.floor(Math.random() * 4); // Randomly select first dealer

  for (let roundNum = 0; roundNum < ROUND_DISTRIBUTION.length; roundNum++) {
    console.log(`\n--- Starting Round ${roundNum + 1} (${ROUND_DISTRIBUTION[roundNum]} cards) ---`);
    console.log(`Dealer: ${players[currentDealerIndex].id}`);
    
    const roundResult = simulateRound(deck, players, roundNum, currentDealerIndex);
    allRoundResults.push(roundResult);

    console.log(`Round ${roundNum + 1} Summary:` );
    console.log(`  Trump Suit: ${roundResult.trumpSuit}`);
    roundResult.bids.forEach(b => { // b is now PlayerBidWithActual
      console.log(`  ${b.playerId}: Bid ${b.bid}, Took ${b.actual}, Score for round: ${roundResult.scoresForRound[b.playerId]}, Total Score: ${roundResult.cumulativeScores[b.playerId]}`);
    });

    // Rotate dealer for next round
    currentDealerIndex = (currentDealerIndex + 1) % players.length;
  }

  // Determine winner(s)
  let highScore = -Infinity;
  players.forEach(p => {
    if (p.score > highScore) {
      highScore = p.score;
    }
  });
  const winnerIds = players.filter(p => p.score === highScore).map(p => p.id);

  console.log('\n--- FINAL GAME RESULTS ---');
  players.forEach(p => {
    console.log(`${p.id}: ${p.score} points`);
  });
  console.log(`Winner(s): ${winnerIds.join(', ')} with ${highScore} points.`);

  return {
    finalScores: players.reduce((acc, p) => ({ ...acc, [p.id]: p.score }), {}),
    winnerIds,
    allRoundResults,
  };
}

// Further implementations will include:
// - simulateGame: Manages multiple rounds, tracks cumulative scores, and determines game winner.
// - Player-related structures if they need to be more complex than what's in round.ts for game-level tracking. 