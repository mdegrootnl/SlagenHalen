// lib/game/trick.ts

import { Card, Suit, Rank, SUITS, RANKS } from './deck';
import { Player } from './round'; // Assuming Player is defined in round.ts for now

// Represents a card played by a player in a trick
export interface PlayedCard {
  playerId: string; // Using ID to avoid circular dependencies if Player object is too complex
  card: Card;
}

// Represents the state of a single trick
export interface Trick {
  leadSuit: Suit | null;       // Suit of the first card played in the trick
  playedCards: PlayedCard[];   // Cards played so far, in order
  trumpSuit: Suit;             // Trump suit for the current round
  // We might add whose turn it is, or current player index if managing full game state here
}

// Order of ranks for comparison. Lower index = lower value.
// This can be used to determine the higher card.
export const RANK_ORDER: Rank[] = ['7', '8', '9', '10', 'JACK', 'QUEEN', 'KING', 'ACE'];

/**
 * Compares two cards to determine which is higher in the context of a trick.
 * @param cardA The first card.
 * @param cardB The second card.
 * @param leadSuit The lead suit of the trick.
 * @param trumpSuit The trump suit for the round.
 * @returns 1 if cardA is higher, -1 if cardB is higher, 0 if they are equivalent (should not happen with unique cards).
 */
export function compareCardsInTrick(
  cardA: Card,
  cardB: Card,
  leadSuit: Suit | null, // Lead suit can be null if this is the first card of the trick, though comparison usually happens after.
  trumpSuit: Suit
): number {
  const aIsTrump = cardA.suit === trumpSuit;
  const bIsTrump = cardB.suit === trumpSuit;

  // Rule 1: Trump cards beat non-trump cards
  if (aIsTrump && !bIsTrump) return 1;
  if (!aIsTrump && bIsTrump) return -1;

  // Rule 2: If both are trump, or both are not trump and of the lead suit
  if (aIsTrump && bIsTrump) { // Both are trump, highest rank wins
    return RANK_ORDER.indexOf(cardA.rank) > RANK_ORDER.indexOf(cardB.rank) ? 1 : -1;
  } 
  
  // Rule 3: If neither is trump, compare based on lead suit
  // Only cards of the lead suit can win if no trump is played.
  if (!aIsTrump && !bIsTrump) {
    if (leadSuit) {
      const aIsLeadSuit = cardA.suit === leadSuit;
      const bIsLeadSuit = cardB.suit === leadSuit;

      if (aIsLeadSuit && !bIsLeadSuit) return 1; // Card A is lead, Card B is not (and not trump)
      if (!aIsLeadSuit && bIsLeadSuit) return -1; // Card B is lead, Card A is not (and not trump)
      
      if (aIsLeadSuit && bIsLeadSuit) { // Both are lead suit, highest rank wins
        return RANK_ORDER.indexOf(cardA.rank) > RANK_ORDER.indexOf(cardB.rank) ? 1 : -1;
      }
      // If neither is lead suit (and neither is trump), they can't win the trick usually.
      // This function is about which card is *higher for winning purposes*.
      // If cardA and cardB are off-suit and not trump, their relative rank doesn't matter for winning *this* trick against each other
      // unless they are the only cards of a specific suit being compared for some other reason.
      // However, if they are the *only* cards played, and neither is lead/trump, this comparison is less defined for winning.
      // Let's assume for now this function is called in context of a potentially winning card.
      // If both are off-suit (not lead, not trump), a simple rank comparison can be a fallback,
      // but it won't make them win if a lead-suit card was played.
      // Fallback to rank comparison if both are same non-lead, non-trump suit, though this path is tricky for winning logic.
      // For now, if they are not lead and not trump, they are effectively equal in terms of power to win *this specific trick against each other* if leadSuit is established.
      // The `determineTrickWinner` will handle the broader context.
      return 0; // Or compare by rank if necessary for other logic: RANK_ORDER.indexOf(cardA.rank) > RANK_ORDER.indexOf(cardB.rank) ? 1 : -1;
    } else {
      // No lead suit yet (e.g. comparing first two cards if rules allowed that directly)
      // This case is less common for this specific function, usually leadSuit is known.
      // Higher rank wins if suits are same, otherwise this comparison is ill-defined without lead/trump context.
      if (cardA.suit === cardB.suit) {
        return RANK_ORDER.indexOf(cardA.rank) > RANK_ORDER.indexOf(cardB.rank) ? 1 : -1;
      }
      return 0; // Cannot compare meaningfully without lead/trump context if suits differ.
    }
  }
  return 0; // Should not be reached if logic is exhaustive
}

/**
 * Checks if a player has a card of a specific suit in their hand.
 * @param hand The player's hand.
 * @param suit The suit to check for.
 * @returns True if the player has a card of the given suit, false otherwise.
 */
function hasSuit(hand: Card[], suit: Suit): boolean {
  return hand.some(card => card.suit === suit);
}

/**
 * Validates if a card play is legal according to standard trick-taking rules.
 * @param playerHand The hand of the player making the play.
 * @param cardToPlay The card the player intends to play.
 * @param leadSuit The suit that was led in the current trick (null if this is the lead play).
 * @param trumpSuit The trump suit for the current round.
 * @returns True if the play is valid, false otherwise.
 */
export function isValidPlay(
  playerHand: Card[],
  cardToPlay: Card,
  leadSuit: Suit | null,
  trumpSuit: Suit
): boolean {
  // 1. Check if the player actually has the card to play.
  if (!playerHand.find(card => card.suit === cardToPlay.suit && card.rank === cardToPlay.rank)) {
    console.error("Player does not have the card they are trying to play.", cardToPlay, playerHand);
    return false; 
  }

  // 2. If player is leading the trick (no leadSuit yet), any card is valid.
  if (leadSuit === null) {
    return true;
  }

  // 3. Player is not leading, must follow suit if possible.
  const playerHasLeadSuit = hasSuit(playerHand, leadSuit);

  if (playerHasLeadSuit) {
    // If player has the lead suit, they must play a card of the lead suit.
    return cardToPlay.suit === leadSuit;
  }

  // 4. Player cannot follow lead suit. Must play trump if possible.
  const playerHasTrumpSuit = hasSuit(playerHand, trumpSuit);

  if (playerHasTrumpSuit) {
    // If player has trump (and no lead suit), they must play a trump card.
    return cardToPlay.suit === trumpSuit;
  }

  // 5. Player has no lead suit and no trump suit. Any card is valid (a discard).
  return true;
}

/**
 * Determines the winner of a completed trick.
 * @param playedCardsInOrder An array of PlayedCard objects, in the order they were played.
 * @param trumpSuit The trump suit for the current round.
 * @returns The PlayedCard object that won the trick.
 * @throws Error if playedCardsInOrder is empty.
 */
export function determineTrickWinner(
  playedCardsInOrder: PlayedCard[],
  trumpSuit: Suit
): PlayedCard {
  if (!playedCardsInOrder || playedCardsInOrder.length === 0) {
    throw new Error('Cannot determine winner from an empty set of played cards.');
  }

  // The first card played establishes the lead suit for the trick.
  const leadSuit = playedCardsInOrder[0].card.suit;
  let winningPlayedCard = playedCardsInOrder[0];

  for (let i = 1; i < playedCardsInOrder.length; i++) {
    const currentPlayedCard = playedCardsInOrder[i];
    const comparisonResult = compareCardsInTrick(
      currentPlayedCard.card, // Card A (the challenger)
      winningPlayedCard.card, // Card B (the current winner)
      leadSuit, 
      trumpSuit
    );

    if (comparisonResult > 0) { // currentPlayedCard.card is higher than winningPlayedCard.card
      winningPlayedCard = currentPlayedCard;
    }
  }

  return winningPlayedCard;
}

/**
 * Simulates a single trick being played by 4 players.
 * Player hands are modified by removing the card they play.
 * Uses a simple AI for card selection (plays the first valid card found).
 *
 * @param players - An array of 4 Player objects. Their hands will be modified.
 * @param startingPlayerIndex - The index (0-3) of the player who leads the trick.
 * @param trumpSuit - The trump suit for the current round.
 * @returns An object containing the list of cards played in order and the winning PlayedCard.
 * @throws Error if players array is not of length 4, or if a player cannot make a valid play.
 */
export function simulateTrick(
  players: Player[],
  startingPlayerIndex: number,
  trumpSuit: Suit
): { trickPlays: PlayedCard[]; winner: PlayedCard } {
  if (players.length !== 4) {
    throw new Error('simulateTrick currently only supports 4 players.');
  }
  if (startingPlayerIndex < 0 || startingPlayerIndex >= 4) {
    throw new Error('Invalid startingPlayerIndex.');
  }

  const currentTrick: Trick = {
    leadSuit: null,
    playedCards: [],
    trumpSuit: trumpSuit,
  };

  for (let i = 0; i < 4; i++) {
    const playerIndex = (startingPlayerIndex + i) % 4;
    const currentPlayer = players[playerIndex];

    let cardToPlay: Card | null = null;
    let cardIndexInHand = -1;

    // Simple AI: find the first valid card to play
    for (let j = 0; j < currentPlayer.hand.length; j++) {
      if (isValidPlay(currentPlayer.hand, currentPlayer.hand[j], currentTrick.leadSuit, trumpSuit)) {
        cardToPlay = currentPlayer.hand[j];
        cardIndexInHand = j;
        break;
      }
    }

    if (!cardToPlay || cardIndexInHand === -1) {
      console.error('Player hand:', currentPlayer.hand);
      console.error('Lead suit:', currentTrick.leadSuit, 'Trump suit:', trumpSuit);
      throw new Error(`Player ${currentPlayer.id} could not find a valid card to play.`);
    }

    // Update trick state
    if (currentTrick.leadSuit === null) {
      currentTrick.leadSuit = cardToPlay.suit;
    }
    currentTrick.playedCards.push({ playerId: currentPlayer.id, card: cardToPlay });

    // Remove card from player's hand
    currentPlayer.hand.splice(cardIndexInHand, 1);
    
    // console.log(`Player ${currentPlayer.id} played ${cardToPlay.rank} of ${cardToPlay.suit}. Hand size: ${currentPlayer.hand.length}`);
  }

  const trickWinner = determineTrickWinner(currentTrick.playedCards, trumpSuit);
  // console.log(`Trick winner: ${trickWinner.playerId} with ${trickWinner.card.rank} of ${trickWinner.card.suit}`);

  return { trickPlays: currentTrick.playedCards, winner: trickWinner };
}

// Further implementations will include:
// - A playCard() function that orchestrates a single card play within a trick,
//   updating the trick state and using isValidPlay.
// - Logic to manage a full trick (e.g., a Trick class or more stateful functions). 