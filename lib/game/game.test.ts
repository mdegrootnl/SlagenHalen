import { calculatePlayerScore, GamePlayer, simulateRound, RoundResult, simulateGame, GameResult } from './game';
import { Deck, SUITS, RANKS, Card, Suit } from './deck';
import { ROUND_DISTRIBUTION } from './round';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function testCalculatePlayerScore() {
  console.log('Running calculatePlayerScore tests...');

  // Test cases based on rules from requirements.md section 5:
  // 1. Exact prediction: 10 + (3 * tricksTaken)
  // 2. Incorrect prediction: -3 * Math.abs(bid - tricksTaken)

  // Scenario 1: Exact prediction (bid 3, took 3)
  // Score = 10 + (3 * 3) = 10 + 9 = 19
  assert(calculatePlayerScore(3, 3) === 19, 'Exact bid of 3, took 3 should be 19');

  // Scenario 2: Exact prediction (bid 0, took 0)
  // Score = 10 + (3 * 0) = 10 + 0 = 10
  assert(calculatePlayerScore(0, 0) === 10, 'Exact bid of 0, took 0 should be 10');

  // Scenario 3: Exact prediction (bid 1, took 1)
  // Score = 10 + (3 * 1) = 10 + 3 = 13
  assert(calculatePlayerScore(1, 1) === 13, 'Exact bid of 1, took 1 should be 13');

  // Scenario 4: Overtricks (bid 2, took 3) - Incorrect prediction
  // Difference = |2 - 3| = 1
  // Score = -3 * 1 = -3
  assert(calculatePlayerScore(2, 3) === -3, 'Overtricks: bid 2, took 3 should be -3');

  // Scenario 5: Undertricks (bid 3, took 1) - Incorrect prediction
  // Difference = |3 - 1| = 2
  // Score = -3 * 2 = -6
  assert(calculatePlayerScore(3, 1) === -6, 'Undertricks: bid 3, took 1 should be -6');

  // Scenario 6: Overtricks significantly (bid 1, took 5) - Incorrect prediction
  // Difference = |1 - 5| = 4
  // Score = -3 * 4 = -12
  assert(calculatePlayerScore(1, 5) === -12, 'Overtricks: bid 1, took 5 should be -12');

  // Scenario 7: Undertricks significantly (bid 5, took 1) - Incorrect prediction
  // Difference = |5 - 1| = 4
  // Score = -3 * 4 = -12
  assert(calculatePlayerScore(5, 1) === -12, 'Undertricks: bid 5, took 1 should be -12');

  // Scenario 8: Bid 0, took 1 (undertrick for 0 bid, or just incorrect)
  // Difference = |0 - 1| = 1
  // Score = -3 * 1 = -3
  assert(calculatePlayerScore(0, 1) === -3, 'Incorrect bid: bid 0, took 1 should be -3');

  console.log('calculatePlayerScore tests passed!\n');
}

// Helper to create a card for tests if needed, though deck dealing is usually random
const C = (suit: Suit, rank: typeof RANKS[number]): Card => ({ suit, rank });

function testSimulateRound() {
  console.log('Running simulateRound tests...');

  const deck = new Deck();
  const players: GamePlayer[] = [
    { id: 'P1', hand: [], bid: 0, tricksTaken: 0, score: 0 },
    { id: 'P2', hand: [], bid: 0, tricksTaken: 0, score: 0 },
    { id: 'P3', hand: [], bid: 0, tricksTaken: 0, score: 0 },
    { id: 'P4', hand: [], bid: 0, tricksTaken: 0, score: 0 },
  ];

  // Scenario 1: First round (1 card dealt)
  console.log('  Testing Round 0 (1 card)...');
  const roundNumber0 = 0;
  const dealerIndex0 = 3; // P4 is dealer, P1 bids/plays first
  const resultR0: RoundResult = simulateRound(deck, players, roundNumber0, dealerIndex0);

  assert(resultR0.roundNumber === roundNumber0, `R0: Round number should be ${roundNumber0}`);
  assert(resultR0.numberOfCards === 1, 'R0: Number of cards should be 1');
  assert(SUITS.includes(resultR0.trumpSuit), 'R0: Trump suit should be valid');
  assert(resultR0.bids.length === 4, 'R0: Should have 4 bids recorded');
  resultR0.bids.forEach(b => {
    assert(b.bid === 0 || b.bid === 1, `R0: Player ${b.playerId} bid ${b.bid} should be 0 or 1 for 1 card`);
  });
  assert(resultR0.tricksPlayed.length === 1, 'R0: Should have 1 trick played');
  assert(resultR0.tricksPlayed[0].length === 4, 'R0: Trick 0 should have 4 cards played');
  
  let totalTricksTakenR0 = 0;
  Object.values(resultR0.tricksTakenByPlayer).forEach(taken => totalTricksTakenR0 += taken);
  assert(totalTricksTakenR0 === 1, 'R0: Total tricks taken by all players should be 1');

  players.forEach(p => {
    const bidInfo = resultR0.bids.find(b => b.playerId === p.id);
    assert(bidInfo !== undefined, `R0: Bid info for player ${p.id} should exist`);
    if (bidInfo) {
        const expectedScore = calculatePlayerScore(bidInfo.bid, resultR0.tricksTakenByPlayer[p.id]);
        assert(resultR0.scoresForRound[p.id] === expectedScore, `R0: Score for player ${p.id} should be ${expectedScore}`);
        assert(p.score === expectedScore, `R0: Cumulative score for ${p.id} should be updated to ${expectedScore} (was 0)`);
    }
  });
  assert(resultR0.startingPlayerIndex === (dealerIndex0 + 1) % 4, 'R0: Starting player index should be correct');
  console.log(`  Round 0 Test Passed. Trump: ${resultR0.trumpSuit}. P1 bid: ${resultR0.bids.find(b=>b.playerId==='P1')?.bid}, took: ${resultR0.tricksTakenByPlayer['P1']}`);


  // Scenario 2: A middle round (e.g., round 7, 8 cards dealt)
  // Reset scores for this specific test scenario for clarity, though simulateRound updates them cumulatively
  players.forEach(p => p.score = 100); // Arbitrary starting score for testing accumulation
  const initialScoresR7 = players.map(p => p.score);

  console.log('\n  Testing Round 7 (8 cards)...');
  const roundNumber7 = 7; // 8 cards
  const dealerIndex7 = 0; // P1 is dealer, P2 bids/plays first
  const resultR7: RoundResult = simulateRound(deck, players, roundNumber7, dealerIndex7);

  assert(resultR7.roundNumber === roundNumber7, `R7: Round number should be ${roundNumber7}`);
  assert(resultR7.numberOfCards === 8, 'R7: Number of cards should be 8');
  assert(resultR7.bids.length === 4, 'R7: Should have 4 bids recorded');
  resultR7.bids.forEach(b => {
    assert(b.bid >= 0 && b.bid <= 8, `R7: Player ${b.playerId} bid ${b.bid} should be between 0 and 8`);
  });
  assert(resultR7.tricksPlayed.length === 8, 'R7: Should have 8 tricks played');
  resultR7.tricksPlayed.forEach((trick, i) => {
    assert(trick.length === 4, `R7: Trick ${i} should have 4 cards played`);
  });

  let totalTricksTakenR7 = 0;
  Object.values(resultR7.tricksTakenByPlayer).forEach(taken => totalTricksTakenR7 += taken);
  assert(totalTricksTakenR7 === 8, 'R7: Total tricks taken by all players should be 8');

  players.forEach((p, idx) => {
    const bidInfo = resultR7.bids.find(b => b.playerId === p.id);
    assert(bidInfo !== undefined, `R7: Bid info for player ${p.id} should exist`);
    if (bidInfo) {
        const expectedScoreForRound = calculatePlayerScore(bidInfo.bid, resultR7.tricksTakenByPlayer[p.id]);
        assert(resultR7.scoresForRound[p.id] === expectedScoreForRound, `R7: Score for player ${p.id} for round should be ${expectedScoreForRound}`);
        assert(p.score === initialScoresR7[idx] + expectedScoreForRound, `R7: Cumulative score for ${p.id} should be ${initialScoresR7[idx]} + ${expectedScoreForRound}`);
    }
  });
  assert(resultR7.startingPlayerIndex === (dealerIndex7 + 1) % 4, 'R7: Starting player index should be correct');
  console.log(`  Round 7 Test Passed. Trump: ${resultR7.trumpSuit}. P1 bid: ${resultR7.bids.find(b=>b.playerId==='P1')?.bid}, took: ${resultR7.tricksTakenByPlayer['P1']}`);

  console.log('simulateRound tests passed!\n');
}

function testSimulateGame() {
  console.log('Running simulateGame tests...');
  // This test primarily checks if a full game can run without crashing and produces valid structure.
  // Specific scores are not asserted due to randomness of AI and dealing.

  const gameResult: GameResult = simulateGame();

  assert(gameResult.allRoundResults.length === ROUND_DISTRIBUTION.length, `Should have ${ROUND_DISTRIBUTION.length} round results.`);
  assert(Object.keys(gameResult.finalScores).length === 4, 'Should have final scores for 4 players.');
  assert(gameResult.winnerIds.length > 0 && gameResult.winnerIds.length <= 4, 'Should have at least one winner and at most 4.');

  // Check properties of the first and last round result for basic sanity
  const firstRound = gameResult.allRoundResults[0];
  assert(firstRound.roundNumber === 0, 'First round number should be 0.');
  assert(firstRound.numberOfCards === ROUND_DISTRIBUTION[0], `First round cards should be ${ROUND_DISTRIBUTION[0]}.`);
  assert(firstRound.bids.length === 4, 'First round should have 4 bids.');
  assert(Object.keys(firstRound.tricksTakenByPlayer).length === 4, 'First round should have tricks taken for 4 players.');
  assert(Object.keys(firstRound.scoresForRound).length === 4, 'First round should have scores for 4 players.');
  assert(Object.keys(firstRound.cumulativeScores).length === 4, 'First round should have cumulative scores for 4 players.');

  const lastRound = gameResult.allRoundResults[ROUND_DISTRIBUTION.length - 1];
  assert(lastRound.roundNumber === ROUND_DISTRIBUTION.length - 1, `Last round number should be ${ROUND_DISTRIBUTION.length - 1}.`);
  assert(lastRound.numberOfCards === ROUND_DISTRIBUTION[ROUND_DISTRIBUTION.length - 1], `Last round cards should be ${ROUND_DISTRIBUTION[ROUND_DISTRIBUTION.length - 1]}.`);

  // Check if final scores match the cumulative scores from the last round
  for (const playerId in gameResult.finalScores) {
    assert(gameResult.finalScores[playerId] === lastRound.cumulativeScores[playerId], 
      `Final score for ${playerId} should match last round cumulative score.`);
  }

  // Check if winner(s) actually have the highest score
  let maxScore = -Infinity;
  for (const playerId in gameResult.finalScores) {
    if (gameResult.finalScores[playerId] > maxScore) {
      maxScore = gameResult.finalScores[playerId];
    }
  }
  gameResult.winnerIds.forEach(winnerId => {
    assert(gameResult.finalScores[winnerId] === maxScore, `Winner ${winnerId} score should be the max score.`);
  });

  console.log('simulateGame test completed (structural checks passed). Winner(s): ' + gameResult.winnerIds.join(', '));
  console.log('simulateGame tests passed!\n');
}

// Run all test suites
try {
  testCalculatePlayerScore();
  testSimulateRound();
  testSimulateGame();
  console.log('ALL GAME LOGIC TESTS (game.ts) PASSED SUCCESSFULLY!');
} catch (e) {
  if (e instanceof Error) {
    console.error('Game test suite (game.ts) failed:', e.message, e.stack);
  } else {
    console.error('Game test suite (game.ts) failed with an unknown error type:', e);
  }
} 