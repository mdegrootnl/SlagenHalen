// lib/game/round.test.ts

import { Deck, SUITS, Card } from './deck';
import { ROUND_DISTRIBUTION, getTrumpSuit, dealCardsForRound } from './round';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function runRoundTests() {
  console.log('Running Round tests...');

  // Test 1: getTrumpSuit()
  const trumpSuit = getTrumpSuit();
  assert(SUITS.includes(trumpSuit), 'getTrumpSuit() should return a valid suit.');
  console.log(`Test 1 Passed: getTrumpSuit() returned a valid suit: ${trumpSuit}`);

  // Test 2: ROUND_DISTRIBUTION constant
  assert(ROUND_DISTRIBUTION.length === 17, 'ROUND_DISTRIBUTION should have 17 rounds.');
  assert(ROUND_DISTRIBUTION[0] === 1, 'First round should have 1 card.');
  assert(ROUND_DISTRIBUTION[16] === 1, 'Last round should have 1 card.');
  assert(ROUND_DISTRIBUTION[7] === 8, '8th round (index 7) should have 8 cards.');
  console.log('Test 2 Passed: ROUND_DISTRIBUTION constant is correct.');

  // Test 3: dealCardsForRound() - basic case
  let deck = new Deck();
  const round0Hand = dealCardsForRound(0, deck); // Round 1 (0-indexed)
  assert(round0Hand.length === ROUND_DISTRIBUTION[0], `Hand for round 0 should have ${ROUND_DISTRIBUTION[0]} card(s).`);
  assert(deck.getCardsCount() === 32 - ROUND_DISTRIBUTION[0], 'Deck count should decrease correctly after dealing for round 0.');
  console.log('Test 3 Passed: dealCardsForRound() deals correct number of cards for round 0.');

  // Test 4: dealCardsForRound() - max cards round
  deck.reset(); // Reset deck for a clean test
  const round7Hand = dealCardsForRound(7, deck); // Round 8 (0-indexed) -> 8 cards
  assert(round7Hand.length === ROUND_DISTRIBUTION[7], `Hand for round 7 should have ${ROUND_DISTRIBUTION[7]} cards.`);
  assert(deck.getCardsCount() === 32 - ROUND_DISTRIBUTION[7], 'Deck count should decrease correctly after dealing for round 7.');
  console.log('Test 4 Passed: dealCardsForRound() deals correct number of cards for round 7 (max cards).');

  // Test 5: dealCardsForRound() - invalid round number (too low)
  deck.reset();
  let didThrowLow = false;
  try {
    dealCardsForRound(-1, deck);
  } catch (e) {
    if (e instanceof Error && e.message === 'Invalid round number.') {
      didThrowLow = true;
    }
  }
  assert(didThrowLow, 'dealCardsForRound() should throw for round number < 0.');
  console.log('Test 5 Passed: dealCardsForRound() throws for too low round number.');

  // Test 6: dealCardsForRound() - invalid round number (too high)
  deck.reset();
  let didThrowHigh = false;
  try {
    dealCardsForRound(ROUND_DISTRIBUTION.length, deck);
  } catch (e) {
    if (e instanceof Error && e.message === 'Invalid round number.') {
      didThrowHigh = true;
    }
  }
  assert(didThrowHigh, 'dealCardsForRound() should throw for round number >= ROUND_DISTRIBUTION.length.');
  console.log('Test 6 Passed: dealCardsForRound() throws for too high round number.');
  
  // Test 7: dealCardsForRound() - insufficient cards (simulated)
  deck = new Deck();
  // Deal almost all cards to leave less than what the first round needs (e.g. if first round needed 5 but only 3 left)
  // For this test, let's simulate a scenario where ROUND_DISTRIBUTION[0] is large and deck is small.
  // We will use a small deck for this specific test.
  class SmallDeck extends Deck {
    constructor(cards: Card[]) {
        super(); // Calls initializeDeck and shuffle on a full deck first
        this['cards'] = cards; // Then override with a small set of cards
    }
  }
  const smallCardSet: Card[] = [{ suit: 'HEARTS', rank: '7'}, { suit: 'DIAMONDS', rank: '8'}];
  const smallDeck = new SmallDeck(smallCardSet.slice());
  // Assuming ROUND_DISTRIBUTION[0] (1 card) < smallCardSet.length (2 cards) - so this should pass
  // Let's test a round that needs more cards than available in smallDeck.
  // Suppose a round needs 3 cards (not in our current ROUND_DISTRIBUTION, but for testing principle)
  // Or, let's test with ROUND_DISTRIBUTION[2] which is 3 cards.
  let didThrowNotEnough = false;
  try {
      // Ensure we are testing a round that needs more cards than in smallDeck (2 cards)
      // ROUND_DISTRIBUTION[2] needs 3 cards.
      dealCardsForRound(2, smallDeck); 
  } catch (e) {
      if (e instanceof Error && e.message === 'Not enough cards in deck to deal for the round.') {
          didThrowNotEnough = true;
      }
  }
  assert(didThrowNotEnough, 'dealCardsForRound() should throw if not enough cards are in the deck for the specified round.');
  console.log('Test 7 Passed: dealCardsForRound() throws for insufficient cards.');

  console.log('All Round tests passed successfully!\n');
}

// Run the tests
try {
  runRoundTests();
} catch (e) {
  if (e instanceof Error) {
    console.error('Round test suite failed:', e.message);
  } else {
    console.error('Round test suite failed with an unknown error type:', e);
  }
} 