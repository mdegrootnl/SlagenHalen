// lib/game/deck.test.ts

import { Deck, SUITS, RANKS, Card } from './deck';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function runDeckTests() {
  console.log('Running Deck tests...');

  // Test 1: Deck initialization
  let deck = new Deck();
  assert(deck.getCardsCount() === 32, 'Deck should have 32 cards upon initialization.');
  console.log('Test 1 Passed: Deck initializes with 32 cards.');

  // Test 2: All unique cards are present (simple check)
  const cardSet = new Set<string>();
  const tempDeckForFullCheck = new Deck(); // Use a fresh, unshuffled deck for this by re-initializing
  tempDeckForFullCheck['initializeDeck'](); // Access private method for test purpose to get unshuffled
  const allCards = tempDeckForFullCheck['cards']; // Access private field for test purpose
  for (const card of allCards) {
    cardSet.add(`${card.rank}-${card.suit}`);
  }
  assert(cardSet.size === 32, 'Deck should contain 32 unique cards.');
  console.log('Test 2 Passed: Deck contains 32 unique cards.');

  // Test 3: Shuffle changes card order
  deck = new Deck(); // Freshly shuffled deck
  const firstCardOrder = JSON.stringify(deck['cards'].slice(0, 5));
  deck.shuffle();
  const secondCardOrder = JSON.stringify(deck['cards'].slice(0, 5));
  // It's highly improbable they are the same after shuffle, but not impossible for small slices.
  // A more robust test would compare the full deck or use statistical analysis.
  // For a simple test, we accept a high probability of them being different.
  assert(firstCardOrder !== secondCardOrder || deck.getCardsCount() < 2, 'Shuffle should change card order (probabilistic).');
  console.log('Test 3 Passed: Shuffle changes card order.');

  // Test 4: dealCard()
  deck = new Deck();
  const initialCount = deck.getCardsCount();
  const card1 = deck.dealCard();
  assert(card1 !== undefined, 'dealCard() should return a card from a full deck.');
  assert(deck.getCardsCount() === initialCount - 1, 'Deck count should decrease by 1 after dealCard().');
  console.log('Test 4 Passed: dealCard() works as expected.');

  // Test 5: dealCards(numCards)
  deck = new Deck();
  const numToDeal = 5;
  const dealtHand = deck.dealCards(numToDeal);
  assert(dealtHand.length === numToDeal, `dealCards(${numToDeal}) should return ${numToDeal} cards.`);
  assert(deck.getCardsCount() === 32 - numToDeal, `Deck count should be ${32 - numToDeal} after dealing ${numToDeal} cards.`);
  console.log('Test 5 Passed: dealCards(numCards) works as expected.');

  // Test 6: Dealing more cards than available
  deck = new Deck();
  const tooManyCards = 35;
  const allDealtCards = deck.dealCards(tooManyCards);
  assert(allDealtCards.length === 32, 'Dealing more cards than available should return all available cards (32).');
  assert(deck.getCardsCount() === 0, 'Deck count should be 0 after dealing all cards.');
  const noMoreCard = deck.dealCard();
  assert(noMoreCard === undefined, 'dealCard() should return undefined from an empty deck.');
  console.log('Test 6 Passed: Dealing from empty or near-empty deck behaves correctly.');

  // Test 7: Reset deck
  deck = new Deck();
  deck.dealCards(10);
  assert(deck.getCardsCount() === 22, 'Deck count should be 22 after dealing 10 cards.');
  deck.reset();
  assert(deck.getCardsCount() === 32, 'Deck count should be 32 after reset.');
  const cardAfterReset = deck.dealCard();
  assert(cardAfterReset !== undefined, 'Should be able to deal a card after reset.');
  console.log('Test 7 Passed: Resetting deck works.');

  console.log('All Deck tests passed successfully!\n');
}

// Run the tests
try {
  runDeckTests();
} catch (e) {
  if (e instanceof Error) {
    console.error('Deck test suite failed:', e.message);
  } else {
    console.error('Deck test suite failed with an unknown error type:', e);
  }
} 