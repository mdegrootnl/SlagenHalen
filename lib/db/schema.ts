import {
  timestamp,
  pgTable,
  text,
  integer,
  boolean,
  pgEnum,
  uniqueIndex,
  index,
  serial,
  varchar,
  type PgColumn,
} from "drizzle-orm/pg-core";
import { relations, type InferInsertModel, type InferSelectModel } from "drizzle-orm";

export const SUITS = ["HEARTS", "DIAMONDS", "CLUBS", "SPADES"] as const;
export type Suit = typeof SUITS[number];

export const RANKS = [
  "7",
  "8",
  "9",
  "10",
  "JACK",
  "QUEEN",
  "KING",
  "ACE",
] as const;
export type Rank = (typeof RANKS)[number];

export const game_status_enum = pgEnum('game_status_enum', ["pending", "active", "bidding", "active_play", "round_over", "round_summary", "finished", "archived"]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: varchar("role", { length: 20 }).notNull().default("member"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

export const teams = pgTable("teams", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  personalAccount: boolean("personal_account").default(false),
  imageUrl: text("image_url"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripePriceId: text("stripe_price_id"),
  stripeCurrentPeriodEnd: timestamp("stripe_current_period_end"),
});

export const teamMembers = pgTable("team_members", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references((): PgColumn => users.id, { onDelete: "no action" }),
  teamId: integer("team_id")
    .notNull()
    .references((): PgColumn => teams.id, { onDelete: "no action" }),
  role: varchar("role", { length: 50 }).notNull(),
  joinedAt: timestamp("joined_at").notNull().defaultNow(),
});

export const invitations = pgTable("invitations", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id")
    .notNull()
    .references((): PgColumn => teams.id, { onDelete: "no action" }),
  email: varchar("email", { length: 255 }).notNull(),
  role: varchar("role", { length: 50 }).notNull(),
  invitedBy: integer("invited_by")
    .notNull()
    .references((): PgColumn => users.id, { onDelete: "no action" }),
  invitedAt: timestamp("invited_at").notNull().defaultNow(),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
});

export const activityLogs = pgTable("activity_logs", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id")
    .notNull()
    .references((): PgColumn => teams.id, { onDelete: "no action" }),
  userId: integer("user_id").references((): PgColumn => users.id, { onDelete: "no action" }),
  action: text("action").notNull(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  ipAddress: varchar("ip_address", { length: 45 }),
});

export const gameSessions = pgTable("game_sessions", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }),
  image_url: text("image_url"),
  status: text("status", { enum: ["pending", "active", "bidding", "active_play", "round_over", "round_summary", "finished", "archived"] })
    .notNull()
    .default("pending"),
  currentRound: integer("current_round").notNull().default(0),
  trumpSuit: text("trump_suit", { enum: SUITS }),
  currentDealerId: integer("current_dealer_id").references((): PgColumn => gamePlayers.id, { onDelete: "set null" }),
  currentTurnGamePlayerId: integer("current_turn_game_player_id").references((): PgColumn => gamePlayers.id, { onDelete: "set null" }),
  currentTrickLeadSuit: text("current_trick_lead_suit", { enum: SUITS }),
  currentTrickNumberInRound: integer("current_trick_number_in_round").notNull().default(1),
  winnerGamePlayerId: integer("winner_game_player_id").references((): PgColumn => gamePlayers.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const gamePlayers = pgTable("game_players",
  {
    id: serial("id").primaryKey(),
    gameSessionId: integer("game_session_id")
      .notNull()
      .references((): PgColumn => gameSessions.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references((): PgColumn => users.id, { onDelete: "cascade" }),
    playerOrder: integer("player_order").notNull(),
    currentScore: integer("current_score").notNull().default(0),
    currentRoundTricksTaken: integer("current_round_tricks_taken").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => {
    return {
      gameSessionIdx: index("gp_game_session_idx").on(table.gameSessionId),
      userIdx: index("gp_user_idx").on(table.userId),
      gameSessionUserUnique: uniqueIndex("gp_game_session_user_unique_idx").on(
        table.gameSessionId,
        table.userId,
      ),
    };
  },
);

export const playerBids = pgTable("player_bids",
  {
    id: serial("id").primaryKey(),
    gameSessionId: integer("game_session_id")
        .notNull()
        .references((): PgColumn => gameSessions.id, { onDelete: "cascade" }),
    gamePlayerId: integer("game_player_id")
      .notNull()
      .references((): PgColumn => gamePlayers.id, { onDelete: "cascade" }),
    roundNumber: integer("round_number").notNull(),
    bidAmount: integer("bid_amount").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => {
    return {
      bidUniqueIdx: uniqueIndex("pb_bid_unique_idx").on(
        table.gameSessionId,
        table.gamePlayerId,
        table.roundNumber,
      ),
    };
  },
);

export const playerRoundHands = pgTable("player_round_hands",
  {
    id: serial("id").primaryKey(),
    gameSessionId: integer("game_session_id")
      .notNull()
      .references((): PgColumn => gameSessions.id, { onDelete: "cascade" }),
    gamePlayerId: integer("game_player_id")
      .notNull()
      .references((): PgColumn => gamePlayers.id, { onDelete: "cascade" }),
    roundNumber: integer("round_number").notNull(),
    cardSuit: text("card_suit", { enum: SUITS }).notNull(),
    cardRank: text("card_rank", { enum: RANKS }).notNull(),
    isPlayed: boolean("is_played").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => {
    return {
      handCardUniqueIdx: uniqueIndex("prh_hand_card_unique_idx").on(
        table.gameSessionId,
        table.gamePlayerId,
        table.roundNumber,
        table.cardSuit,
        table.cardRank,
      ),
    };
  },
);

export const playedTricks = pgTable("played_tricks",
  {
    id: serial("id").primaryKey(),
    gameSessionId: integer("game_session_id")
      .notNull()
      .references((): PgColumn => gameSessions.id, { onDelete: "cascade" }),
    roundNumber: integer("round_number").notNull(),
    roundTrickNumber: integer("round_trick_number").notNull(),
    leadSuit: text("lead_suit", { enum: SUITS }),
    winningGamePlayerId: integer("winning_game_player_id").references((): PgColumn => gamePlayers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => {
    return {
      trickUniqueIdx: uniqueIndex("pt_trick_unique_idx").on(
        table.gameSessionId,
        table.roundNumber,
        table.roundTrickNumber,
      ),
    };
  },
);

export const playedCardsInTricks = pgTable("played_cards_in_tricks",
  {
    id: serial("id").primaryKey(),
    playedTrickId: integer("played_trick_id")
      .notNull()
      .references((): PgColumn => playedTricks.id, { onDelete: "cascade" }),
    gamePlayerId: integer("game_player_id")
      .notNull()
      .references((): PgColumn => gamePlayers.id, { onDelete: "cascade" }),
    cardSuit: text("card_suit", { enum: SUITS }).notNull(),
    cardRank: text("card_rank", { enum: RANKS }).notNull(),
    playSequenceInTrick: integer("play_sequence_in_trick").notNull(),
    gameSessionId: integer("game_session_id")
        .notNull()
        .references((): PgColumn => gameSessions.id, { onDelete: "cascade" }),
    roundNumber: integer("round_number").notNull(),
    trickNumberInRound: integer("trick_number_in_round").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => {
    return {
      cardInTrickUniqueIdx: uniqueIndex("pcit_card_in_trick_unique_idx").on(
        table.playedTrickId,
        table.gamePlayerId,
      ),
      sequenceInTrickUnique: uniqueIndex("pcit_sequence_in_trick_unique_idx").on(
        table.playedTrickId,
        table.playSequenceInTrick,
      )
    };
  },
);

export const usersRelations = relations(users, ({ many }) => ({
  teamMembers: many(teamMembers),
  invitations: many(invitations, { relationName: "sentInvitations" }),
  gamePlayers: many(gamePlayers),
  activityLogs: many(activityLogs),
}));

export const teamsRelations = relations(teams, ({ many }) => ({
  teamMembers: many(teamMembers),
  invitations: many(invitations),
  activityLogs: many(activityLogs),
}));

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
  user: one(users, {
    fields: [teamMembers.userId],
    references: [users.id],
  }),
  team: one(teams, {
    fields: [teamMembers.teamId],
    references: [teams.id],
  }),
}));

export const invitationsRelations = relations(invitations, ({ one }) => ({
  team: one(teams, {
    fields: [invitations.teamId],
    references: [teams.id],
  }),
  invitedByUser: one(users, {
    fields: [invitations.invitedBy],
    references: [users.id],
    relationName: "sentInvitations",
  }),
}));

export const activityLogsRelations = relations(activityLogs, ({ one }) => ({
  team: one(teams, {
    fields: [activityLogs.teamId],
    references: [teams.id],
  }),
  user: one(users, {
    fields: [activityLogs.userId],
    references: [users.id],
  }),
}));

export const gameSessionsRelations = relations(gameSessions, ({ many, one }) => ({
  gamePlayers: many(gamePlayers, { relationName: "gamePlayersForSession" }),
  playerBids: many(playerBids),
  playedTricks: many(playedTricks),
  playerRoundHands: many(playerRoundHands),
  currentDealer: one(gamePlayers, {
    fields: [gameSessions.currentDealerId],
    references: [gamePlayers.id],
    relationName: "currentDealerForSession",
  }),
  currentTurnGamePlayer: one(gamePlayers, {
    fields: [gameSessions.currentTurnGamePlayerId],
    references: [gamePlayers.id],
    relationName: "currentTurnPlayerForSession",
  }),
}));

export const gamePlayersRelations = relations(gamePlayers, ({ one, many }) => ({
  user: one(users, {
    fields: [gamePlayers.userId],
    references: [users.id],
  }),
  gameSession: one(gameSessions, {
    fields: [gamePlayers.gameSessionId],
    references: [gameSessions.id],
    relationName: "gamePlayersForSession",
  }),
  bidsMade: many(playerBids),
  roundHands: many(playerRoundHands),
  cardsPlayedInTricks: many(playedCardsInTricks, {relationName: "cardsPlayerHasPlayed"}),
  tricksWon: many(playedTricks, { relationName: "tricksWonByPlayer" }),
}));

export const playerBidsRelations = relations(playerBids, ({ one }) => ({
  gameSession: one(gameSessions, {
    fields: [playerBids.gameSessionId],
    references: [gameSessions.id],
  }),
  gamePlayer: one(gamePlayers, {
    fields: [playerBids.gamePlayerId],
    references: [gamePlayers.id],
  }),
}));

export const playerRoundHandsRelations = relations(playerRoundHands, ({ one }) => ({
  gameSession: one(gameSessions, {
    fields: [playerRoundHands.gameSessionId],
    references: [gameSessions.id],
  }),
  gamePlayer: one(gamePlayers, {
    fields: [playerRoundHands.gamePlayerId],
    references: [gamePlayers.id],
  }),
}));

export const playedTricksRelations = relations(playedTricks, ({ one, many }) => ({
  gameSession: one(gameSessions, {
    fields: [playedTricks.gameSessionId],
    references: [gameSessions.id],
  }),
  winningGamePlayer: one(gamePlayers, {
    fields: [playedTricks.winningGamePlayerId],
    references: [gamePlayers.id],
    relationName: "tricksWonByPlayer"
  }),
  cardsInTrick: many(playedCardsInTricks),
}));

export const playedCardsInTricksRelations = relations(playedCardsInTricks, ({ one }) => ({
  playedTrick: one(playedTricks, {
    fields: [playedCardsInTricks.playedTrickId],
    references: [playedTricks.id],
  }),
  gamePlayer: one(gamePlayers, {
    fields: [playedCardsInTricks.gamePlayerId],
    references: [gamePlayers.id],
  }),
  gameSession: one(gameSessions, {
    fields: [playedCardsInTricks.gameSessionId],
    references: [gameSessions.id],
  }),
}));

export const playerRoundScoreChanges = pgTable('player_round_score_changes', {
  id: serial('id').primaryKey(),
  gameSessionId: integer('game_session_id').notNull().references(() => gameSessions.id, { onDelete: 'cascade' }),
  gamePlayerId: integer('game_player_id').notNull().references(() => gamePlayers.id, { onDelete: 'cascade' }),
  roundNumber: integer('round_number').notNull(),
  scoreChange: integer('score_change').notNull(),
  tricksTaken: integer('tricks_taken').notNull().default(0),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
}, (table) => ({
  gameSessionIdx: index('prsc_game_session_idx').on(table.gameSessionId),
  gamePlayerIdx: index('prsc_game_player_idx').on(table.gamePlayerId),
  roundIdx: index('prsc_round_idx').on(table.roundNumber),
}));

export const playerRoundScoreChangesRelations = relations(playerRoundScoreChanges, ({ one }) => ({
  gameSession: one(gameSessions, {
    fields: [playerRoundScoreChanges.gameSessionId],
    references: [gameSessions.id],
  }),
  gamePlayer: one(gamePlayers, {
    fields: [playerRoundScoreChanges.gamePlayerId],
    references: [gamePlayers.id],
  }),
}));

export type User = InferSelectModel<typeof users>;
export type NewUser = InferInsertModel<typeof users>;

export type Team = InferSelectModel<typeof teams>;
export type NewTeam = InferInsertModel<typeof teams>;

export type TeamMember = InferSelectModel<typeof teamMembers>;
export type NewTeamMember = InferInsertModel<typeof teamMembers>;

export type Invitation = InferSelectModel<typeof invitations>;
export type NewInvitation = InferInsertModel<typeof invitations>;

export type ActivityLog = InferSelectModel<typeof activityLogs>;
export type NewActivityLog = InferInsertModel<typeof activityLogs>;

export type TeamDataWithMembers = Team & {
  teamMembers: (TeamMember & {
    user: Pick<User, "id" | "name" | "email">;
  })[];
};

export type GameSession = InferSelectModel<typeof gameSessions>;
export type NewGameSession = InferInsertModel<typeof gameSessions>;

export type GamePlayer = InferSelectModel<typeof gamePlayers>;
export type NewGamePlayer = InferInsertModel<typeof gamePlayers>;

export type PlayerBid = InferSelectModel<typeof playerBids>;
export type NewPlayerBid = InferInsertModel<typeof playerBids>;

export type PlayerRoundHand = InferSelectModel<typeof playerRoundHands>;
export type NewPlayerRoundHand = InferInsertModel<typeof playerRoundHands>;

export type PlayedTrick = InferSelectModel<typeof playedTricks>;
export type NewPlayedTrick = InferInsertModel<typeof playedTricks>;

export type PlayedCardInTrick = InferSelectModel<typeof playedCardsInTricks>;
export type NewPlayedCardInTrick = InferInsertModel<typeof playedCardsInTricks>;

export type Card = { suit: Suit; rank: Rank };

export type CardInHandDb = Pick<PlayerRoundHand, "id" | "cardSuit" | "cardRank" | "isPlayed">;

export type GamePlayerWithUser = GamePlayer & { user: Pick<User, "id" | "name" | "email"> };

export enum GameActionType {
  JOIN_GAME = "JOIN_GAME",
  LEAVE_GAME = "LEAVE_GAME",
  START_GAME = "START_GAME",
  PLACE_BID = "PLACE_BID",
  PLAY_CARD = "PLAY_CARD",
};

export type GameAction = {
  type: GameActionType;
  payload: any;
  userId?: number;
  gameId?: number;
  timestamp?: Date;
};

export enum ActivityType {
  SIGN_UP = "SIGN_UP",
  SIGN_IN = "SIGN_IN",
  SIGN_OUT = "SIGN_OUT",
  UPDATE_PASSWORD = "UPDATE_PASSWORD",
  DELETE_ACCOUNT = "DELETE_ACCOUNT",
  UPDATE_ACCOUNT = "UPDATE_ACCOUNT",
  CREATE_TEAM = "CREATE_TEAM",
  REMOVE_TEAM_MEMBER = "REMOVE_TEAM_MEMBER",
  INVITE_TEAM_MEMBER = "INVITE_TEAM_MEMBER",
  ACCEPT_INVITATION = "ACCEPT_INVITATION",
};
