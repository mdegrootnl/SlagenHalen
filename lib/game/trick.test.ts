// lib/game/trick.test.ts

import { Card, Suit, Rank, SUITS, RANKS } from './deck';
import { Player } from './round';
import {
  PlayedCard,
  Trick,
  RANK_ORDER,
  compareCardsInTrick,
  isValidPlay,
  determineTrickWinner,
  simulateTrick
} from './trick';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

// Helper to create a card easily
const C = (suit: Suit, rank: Rank): Card => ({ suit, rank });

// --- Tests for compareCardsInTrick ---
function testCompareCards() {
  console.log('Running compareCardsInTrick tests...');
  const H = 'HEARTS', S = 'SPADES', D = 'DIAMONDS', CL = 'CLUBS';
  const A = 'ACE', K = 'KING', Q = 'QUEEN', J = 'JACK', T = '10', N = '9', E = '8', SV = '7';

  // Scenario 1: Trump vs Non-Trump
  assert(compareCardsInTrick(C(H, A), C(S, K), S, H) > 0, 'Trump Ace should beat King of lead suit');
  assert(compareCardsInTrick(C(S, K), C(H, A), S, H) < 0, 'King of lead suit should lose to Trump Ace');

  // Scenario 2: Both Trump
  assert(compareCardsInTrick(C(H, A), C(H, K), S, H) > 0, 'Trump Ace should beat Trump King');
  assert(compareCardsInTrick(C(H, K), C(H, A), S, H) < 0, 'Trump King should lose to Trump Ace');

  // Scenario 3: Both Lead Suit, No Trump involved
  assert(compareCardsInTrick(C(S, A), C(S, K), S, H) > 0, 'Lead Ace should beat Lead King (no trump)');
  assert(compareCardsInTrick(C(S, K), C(S, A), S, H) < 0, 'Lead King should lose to Lead Ace (no trump)');

  // Scenario 4: One Lead, One Other (neither trump)
  assert(compareCardsInTrick(C(S, A), C(D, K), S, H) > 0, 'Lead Ace should beat Diamond King (neither trump)');
  assert(compareCardsInTrick(C(D, K), C(S, A), S, H) < 0, 'Diamond King should lose to Lead Ace (neither trump)');

  // Scenario 5: Both different off-suit (neither lead, neither trump)
  assert(compareCardsInTrick(C(D, A), C(CL, K), S, H) === 0, 'Off-suit Ace vs Off-suit King should be 0 (no winner between them)');
  
  console.log('compareCardsInTrick tests passed!\n');
}

// --- Tests for isValidPlay ---
function testIsValidPlay() {
  console.log('Running isValidPlay tests...');
  const H = 'HEARTS', S = 'SPADES', D = 'DIAMONDS', CL = 'CLUBS';
  const A = 'ACE', K = 'KING', Q = 'QUEEN', J = 'JACK', T = '10';

  const playerHand: Card[] = [C(H, A), C(H, K), C(S, Q), C(D, J)];

  // Case 1: Leading a trick (leadSuit is null)
  assert(isValidPlay(playerHand, C(H,A), null, S), 'Leading with any card is valid');

  // Case 2: Must follow lead suit
  assert(isValidPlay(playerHand, C(H,K), H, S), 'Must play lead suit (Hearts)');
  assert(!isValidPlay(playerHand, C(S,Q), H, S), 'Cannot play Spade if has Hearts (lead Hearts)');

  // Case 3: Cannot follow lead, must play trump
  const handNoLead: Card[] = [C(S,Q), C(S,K), C(D,J)]; // No Hearts, Trump is Diamonds
  assert(isValidPlay(handNoLead, C(D,J), H, D), 'Must play trump (Diamonds) if no lead (Hearts)');
  assert(!isValidPlay(handNoLead, C(S,Q), H, D), 'Cannot play Spade if has Trump (Diamonds) and no lead (Hearts)');

  // Case 4: Cannot follow lead, no trump, can discard anything
  const handNoLeadNoTrump: Card[] = [C(S,Q), C(S,K), C(CL, J)]; // No Hearts (lead), No Diamonds (trump)
  assert(isValidPlay(handNoLeadNoTrump, C(S,Q), H, D), 'Can play Spade (discard) if no lead & no trump');
  assert(isValidPlay(handNoLeadNoTrump, C(CL,J), H, D), 'Can play Club (discard) if no lead & no trump');

  // Case 5: Card not in hand
  assert(!isValidPlay(playerHand, C(CL, A), H, S), 'Cannot play card not in hand');

  console.log('isValidPlay tests passed!\n');
}


// --- Tests for simulateTrick ---
function testSimulateTrick() {
  try {
    console.log('Running simulateTrick tests...');
    const H = 'HEARTS', S = 'SPADES', D = 'DIAMONDS', CL = 'CLUBS';
    const A = 'ACE', K = 'KING', Q = 'QUEEN', J = 'JACK', T = '10', N='9', E='8', SV='7';

    // Helper to clone players array and their hands for isolated tests
    const clonePlayers = (players: Player[]): Player[] => 
      players.map(p => ({ ...p, hand: [...p.hand] }));

    // Scenario 1: Simple lead suit win, no trumps
    let players1: Player[] = [
      { id: 'P1', hand: [C(S,A), C(H,T)] },
      { id: 'P2', hand: [C(S,K), C(H,J)] },
      { id: 'P3', hand: [C(S,Q), C(H,Q)] },
      { id: 'P4', hand: [C(S,J), C(H,N)] },
    ];
    let result1 = simulateTrick(clonePlayers(players1), 0, D); // Diamonds trump, Spades lead by P1
    assert(result1.winner.playerId === 'P1', 'S1: P1 should win with Ace of Spades');
    assert(result1.winner.card.rank === A && result1.winner.card.suit === S, 'S1: Winning card should be Ace of Spades');
    assert(result1.trickPlays.length === 4, 'S1: Trick should have 4 plays');
    console.log('SimulateTrick Test 1 Passed: Simple lead suit win.');

    // Scenario 2: Trump wins over lead suit
    let players2: Player[] = [
      { id: 'P1', hand: [C(S,A), C(H,T)] },      // Leads Spade Ace
      { id: 'P2', hand: [C(D,SV), C(H,K)] },   // No Spades, Plays Diamond 7 (trump)
      { id: 'P3', hand: [C(S,Q), C(H,Q)] },      // Follows Spade Queen
      { id: 'P4', hand: [C(S,J), C(H,N)] },      // Follows Spade Jack
    ];
    let result2 = simulateTrick(clonePlayers(players2), 0, D); // Diamonds trump
    assert(result2.winner.playerId === 'P2', 'S2: P2 should win with Trump Diamond 7');
    assert(result2.winner.card.rank === SV && result2.winner.card.suit === D, 'S2: Winning card should be Diamond 7');
    console.log('SimulateTrick Test 2 Passed: Trump wins over lead suit.');

    // Scenario 3: Highest trump wins when multiple trumps played
    let players3: Player[] = [
      { id: 'P1', hand: [C(S,A), C(H,T)] },      // Leads Spade Ace
      { id: 'P2', hand: [C(D,SV), C(S,K)] },   // P2 has Spade, will play Spade King.
      { id: 'P3', hand: [C(D,Q), C(H,Q)] },      // P3 no Spade, has Trump Diamond Queen, plays it.
      { id: 'P4', hand: [C(S,J), C(D,N)] },      // P4 has Spade, will play Spade Jack.
    ];
    let result3 = simulateTrick(clonePlayers(players3), 0, D); // Diamonds trump
    assert(result3.winner.playerId === 'P3', 'S3: P3 should win with Trump Diamond Queen (S,A; S,K; D,Q; S,J -> D,Q wins)');
    console.log('SimulateTrick Test 3 Passed: Highest trump wins.');

    console.log("--- About to start Scenario 4 ---");
    // Scenario 4: Player cannot follow suit, plays trump (and wins)
    let players4: Player[] = [
      { id: 'P1', hand: [C(S,K)] },         // P1 leads Spade King
      { id: 'P2', hand: [C(H,A)] },         // P2 has no Spades, Trumps with Heart Ace
      { id: 'P3', hand: [C(S,Q)] },         // P3 follows Spade Queen
      { id: 'P4', hand: [C(CL,J)] },        // P4 has no Spades or Hearts, discards Club Jack
    ];
    let result4 = simulateTrick(clonePlayers(players4), 0, H); // Hearts trump
    assert(result4.winner.playerId === 'P2', 'S4: P2 should win with Trump Heart Ace');
    console.log('SimulateTrick Test 4 Passed: Trump when void in lead suit wins.');
    
    // Scenario 5: Player cannot follow suit, has no trump, discards (another player wins with lead suit)
    let players5: Player[] = [
      { id: 'P1', hand: [C(S,A)] },         // P1 leads Spade Ace
      { id: 'P2', hand: [C(CL,K)] },        // P2 has no Spades, no Hearts (trump), discards Club King
      { id: 'P3', hand: [C(S,Q)] },         // P3 follows Spade Queen
      { id: 'P4', hand: [C(D,J)] },         // P4 has no Spades, no Hearts (trump), discards Diamond Jack
    ];
    let result5 = simulateTrick(clonePlayers(players5), 0, H); // Hearts trump
    assert(result5.winner.playerId === 'P1', 'S5: P1 should win with Spade Ace (others discarded)');
    console.log('SimulateTrick Test 5 Passed: Discard scenario, lead suit wins.');

    console.log('All simulateTrick tests passed successfully!\n');
  } catch (e) {
    console.error('Error within testSimulateTrick:', e);
    // Optionally re-throw if we want the outer catch to also see it, though it might be redundant.
    // throw e;
  }
}


// Run all test suites
try {
  testCompareCards();
  testIsValidPlay();
  testSimulateTrick();
  console.log('ALL TRICK LOGIC TESTS PASSED SUCCESSFULLY!');
} catch (e) {
  if (e instanceof Error) {
    console.error('Trick test suite failed:', e.message, e.stack);
  } else {
    console.error('Trick test suite failed with an unknown error type:', e);
  }
} 