// lib/game/deck.ts

// Define Suits
export const SUITS = ['HEARTS', 'DIAMONDS', 'CLUBS', 'SPADES'] as const;
export type Suit = typeof SUITS[number];

// Define Ranks (7 to Ace)
export const RANKS = ['7', '8', '9', '10', 'JACK', 'QUEEN', 'KING', 'ACE'] as const;
export type Rank = typeof RANKS[number];

// Define Card Interface
export interface Card {
  suit: Suit;
  rank: Rank;
}

// Deck Class
export class Deck {
  private cards: Card[];

  constructor() {
    this.cards = [];
    this.initializeDeck();
    this.shuffle();
  }

  private initializeDeck(): void {
    this.cards = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        this.cards.push({ suit, rank });
      }
    }
  }

  public shuffle(): void {
    // Fisher-Yates (aka Knuth) Shuffle algorithm
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }

  public dealCard(): Card | undefined {
    return this.cards.pop(); // Deals from the "top" of the deck
  }

  public dealCards(numCards: number): Card[] {
    const dealtCards: Card[] = [];
    for (let i = 0; i < numCards; i++) {
      const card = this.dealCard();
      if (card) {
        dealtCards.push(card);
      } else {
        break; // Stop if deck runs out
      }
    }
    return dealtCards;
  }

  public getCardsCount(): number {
    return this.cards.length;
  }

  // Method to reset the deck to its initial state and shuffle
  public reset(): void {
    this.initializeDeck();
    this.shuffle();
  }
}

// Example Usage (can be removed or kept for testing):
// const deck = new Deck();
// console.log(`Initial deck count: ${deck.getCardsCount()}`);
// const hand = deck.dealCards(5);
// console.log('Dealt hand:', hand);
// console.log(`Remaining deck count: ${deck.getCardsCount()}`);
// deck.reset();
// console.log(`Deck count after reset: ${deck.getCardsCount()}`); 