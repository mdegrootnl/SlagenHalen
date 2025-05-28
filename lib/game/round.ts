import { SUITS, Deck, Card, Suit } from './deck';

// Player representation (minimal for now)
export interface Player {
  id: string; // Or number, a unique identifier
  hand: Card[];
  // We will add bids, scores etc. here later
}

// Bid representation
export interface PlayerBid {
  playerId: string;
  bid: number; // Number of tricks player predicts they will win
}

// Round distribution constant as per requirements
export const ROUND_DISTRIBUTION = [1, 2, 3, 4, 5, 6, 7, 8, 8, 8, 7, 6, 5, 4, 3, 2, 1];

/**
 * Randomly selects a trump suit for the round.
 * @returns A randomly selected suit.
 */
export function getTrumpSuit(): Suit {
  const randomIndex = Math.floor(Math.random() * SUITS.length);
  return SUITS[randomIndex];
}

/**
 * Deals cards for a single player for a given round.
 * @param roundNumber - The current round number (0-indexed, corresponding to ROUND_DISTRIBUTION).
 * @param deck - The deck instance to deal cards from.
 * @returns An array of Card objects representing the player's hand.
 * @throws Error if roundNumber is out of bounds.
 */
export function dealCardsForRound(roundNumber: number, deck: Deck): Card[] {
  if (roundNumber < 0 || roundNumber >= ROUND_DISTRIBUTION.length) {
    throw new Error('Invalid round number.');
  }

  const numCardsToDeal = ROUND_DISTRIBUTION[roundNumber];
  
  // Ensure the deck has enough cards (though for 1 player, this is less of an issue initially)
  // In a 4-player game, total cards needed: numCardsToDeal * 4. Max is 8*4 = 32. So, deck is sufficient.
  if (deck.getCardsCount() < numCardsToDeal) {
    // This might indicate a need to reset the deck or an issue with game flow
    // For now, we'll throw an error if not enough for a single player hand.
    // In a multiplayer context, we'd check against numCardsToDeal * numPlayers.
    throw new Error('Not enough cards in deck to deal for the round.');
  }

  return deck.dealCards(numCardsToDeal);
}

/**
 * Simulates a player making a bid for the current round.
 * For now, this is a placeholder. In a real game, this would involve player input.
 * @param player - The player making the bid.
 * @param numCardsInHand - The number of cards the player has.
 * @returns The player's bid (number of tricks).
 * @throws Error if the bid is invalid (e.g., less than 0 or more than cards in hand).
 */
export function getPlayerBid(player: Player, numCardsInHand: number): number {
  // Basic validation: bid must be between 0 and numCardsInHand
  // This function would eventually take real input or use AI for simulation.
  // For now, let's assume a simple strategy or random bid for simulation.
  
  // Example: Naive AI bids 1 if they have any cards, 0 otherwise, up to numCardsInHand
  let simulatedBid = numCardsInHand > 0 ? 1 : 0; 
  // Or, a random bid:
  // let simulatedBid = Math.floor(Math.random() * (numCardsInHand + 1));

  // Validate the bid (even for simulation, to ensure logic is sound)
  if (simulatedBid < 0 || simulatedBid > numCardsInHand) {
    // This case should ideally not be hit if simulation logic is correct,
    // but good for robustness if input was from an external source.
    throw new Error(`Invalid bid: ${simulatedBid}. Bid must be between 0 and ${numCardsInHand}.`);
  }
  console.log(`${player.id} bids ${simulatedBid} (cards in hand: ${numCardsInHand})`);
  return simulatedBid;
}

/**
 * Conducts the bidding phase for all players for the current round.
 * @param players - An array of Player objects.
 * @param roundNumber - The current round number (0-indexed).
 * @returns An array of PlayerBid objects.
 * @throws Error if roundNumber is invalid.
 */
export function biddingPhase(players: Player[], roundNumber: number): PlayerBid[] {
  if (roundNumber < 0 || roundNumber >= ROUND_DISTRIBUTION.length) {
    throw new Error('Invalid round number for bidding phase.');
  }

  const numCardsInHandThisRound = ROUND_DISTRIBUTION[roundNumber];
  const bids: PlayerBid[] = [];

  for (const player of players) {
    // In a real game, ensure player.hand.length matches numCardsInHandThisRound
    // For simulation, we pass numCardsInHandThisRound directly to getPlayerBid
    const bidAmount = getPlayerBid(player, numCardsInHandThisRound);
    bids.push({ playerId: player.id, bid: bidAmount });
  }

  // TODO: Implement "Oh Hell" rule logic here if desired.
  // This rule states that the sum of bids cannot equal the number of tricks available.
  // If it does, the last player (or dealer) might need to change their bid.
  // For now, we just collect bids.
  
  // Example of checking Oh Hell rule (can be refined):
  const totalBids = bids.reduce((sum, currentBid) => sum + currentBid.bid, 0);
  if (totalBids === numCardsInHandThisRound) {
    console.warn(
      `Oh Hell! Condition Met: Total bids (${totalBids}) equals available tricks (${numCardsInHandThisRound}). ` +
      `Last player may need to adjust bid in a full implementation.`
    );
    // In a full game: you might re-prompt the last player or apply a specific rule.
    // For simulation, this warning is a placeholder.
  }

  return bids;
}

// We will add more round-specific logic here later, such as:
// - Dealing cards for a specific round number (using ROUND_DISTRIBUTION)
// - Managing player hands for a round
// - Tracking the starting player for the round

// Example Usage (can be removed or kept for testing):
// const trump = getTrumpSuit();
// console.log(`This round's trump suit is: ${trump}`);
// console.log(`Cards in the first round: ${ROUND_DISTRIBUTION[0]}`);
// console.log(`Total number of rounds: ${ROUND_DISTRIBUTION.length}`);

// const gameDeck = new Deck();
// const currentRound = 0; // First round
// try {
//   const playerHand = dealCardsForRound(currentRound, gameDeck);
//   console.log(`Player hand for round ${currentRound + 1}:`, playerHand);
//   console.log(`Cards dealt: ${playerHand.length}`);
//   console.log(`Remaining cards in deck: ${gameDeck.getCardsCount()}`);
// } catch (error) {
//   console.error(error.message);
// } 