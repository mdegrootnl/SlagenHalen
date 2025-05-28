CREATE TABLE "activity_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"user_id" integer,
	"action" text NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"ip_address" varchar(45)
);
--> statement-breakpoint
CREATE TABLE "game_players" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_session_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"player_order" integer NOT NULL,
	"current_score" integer DEFAULT 0 NOT NULL,
	"current_round_tricks_taken" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"current_round" integer DEFAULT 0 NOT NULL,
	"trump_suit" text,
	"current_dealer_id" integer,
	"current_turn_game_player_id" integer,
	"current_trick_lead_suit" text,
	"current_trick_number_in_round" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"email" varchar(255) NOT NULL,
	"role" varchar(50) NOT NULL,
	"invited_by" integer NOT NULL,
	"invited_at" timestamp DEFAULT now() NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "played_cards_in_tricks" (
	"id" serial PRIMARY KEY NOT NULL,
	"played_trick_id" integer NOT NULL,
	"game_player_id" integer NOT NULL,
	"card_suit" text NOT NULL,
	"card_rank" text NOT NULL,
	"play_sequence_in_trick" integer NOT NULL,
	"game_session_id" integer NOT NULL,
	"round_number" integer NOT NULL,
	"trick_number_in_round" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "played_tricks" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_session_id" integer NOT NULL,
	"round_number" integer NOT NULL,
	"round_trick_number" integer NOT NULL,
	"lead_suit" text,
	"winning_game_player_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_bids" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_session_id" integer NOT NULL,
	"game_player_id" integer NOT NULL,
	"round_number" integer NOT NULL,
	"bid_amount" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_round_hands" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_session_id" integer NOT NULL,
	"game_player_id" integer NOT NULL,
	"round_number" integer NOT NULL,
	"card_suit" text NOT NULL,
	"card_rank" text NOT NULL,
	"is_played" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	"role" varchar(50) NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"personal_account" boolean DEFAULT false,
	"image_url" text,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"stripe_price_id" text,
	"stripe_current_period_end" timestamp
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100),
	"email" varchar(255) NOT NULL,
	"password_hash" text NOT NULL,
	"role" varchar(20) DEFAULT 'member' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_game_session_id_game_sessions_id_fk" FOREIGN KEY ("game_session_id") REFERENCES "public"."game_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_current_dealer_id_game_players_id_fk" FOREIGN KEY ("current_dealer_id") REFERENCES "public"."game_players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_current_turn_game_player_id_game_players_id_fk" FOREIGN KEY ("current_turn_game_player_id") REFERENCES "public"."game_players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "played_cards_in_tricks" ADD CONSTRAINT "played_cards_in_tricks_played_trick_id_played_tricks_id_fk" FOREIGN KEY ("played_trick_id") REFERENCES "public"."played_tricks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "played_cards_in_tricks" ADD CONSTRAINT "played_cards_in_tricks_game_player_id_game_players_id_fk" FOREIGN KEY ("game_player_id") REFERENCES "public"."game_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "played_cards_in_tricks" ADD CONSTRAINT "played_cards_in_tricks_game_session_id_game_sessions_id_fk" FOREIGN KEY ("game_session_id") REFERENCES "public"."game_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "played_tricks" ADD CONSTRAINT "played_tricks_game_session_id_game_sessions_id_fk" FOREIGN KEY ("game_session_id") REFERENCES "public"."game_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "played_tricks" ADD CONSTRAINT "played_tricks_winning_game_player_id_game_players_id_fk" FOREIGN KEY ("winning_game_player_id") REFERENCES "public"."game_players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_bids" ADD CONSTRAINT "player_bids_game_session_id_game_sessions_id_fk" FOREIGN KEY ("game_session_id") REFERENCES "public"."game_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_bids" ADD CONSTRAINT "player_bids_game_player_id_game_players_id_fk" FOREIGN KEY ("game_player_id") REFERENCES "public"."game_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_round_hands" ADD CONSTRAINT "player_round_hands_game_session_id_game_sessions_id_fk" FOREIGN KEY ("game_session_id") REFERENCES "public"."game_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_round_hands" ADD CONSTRAINT "player_round_hands_game_player_id_game_players_id_fk" FOREIGN KEY ("game_player_id") REFERENCES "public"."game_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gp_game_session_idx" ON "game_players" USING btree ("game_session_id");--> statement-breakpoint
CREATE INDEX "gp_user_idx" ON "game_players" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gp_game_session_user_unique_idx" ON "game_players" USING btree ("game_session_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pcit_card_in_trick_unique_idx" ON "played_cards_in_tricks" USING btree ("played_trick_id","game_player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pcit_sequence_in_trick_unique_idx" ON "played_cards_in_tricks" USING btree ("played_trick_id","play_sequence_in_trick");--> statement-breakpoint
CREATE UNIQUE INDEX "pt_trick_unique_idx" ON "played_tricks" USING btree ("game_session_id","round_number","round_trick_number");--> statement-breakpoint
CREATE UNIQUE INDEX "pb_bid_unique_idx" ON "player_bids" USING btree ("game_session_id","game_player_id","round_number");--> statement-breakpoint
CREATE UNIQUE INDEX "prh_hand_card_unique_idx" ON "player_round_hands" USING btree ("game_session_id","game_player_id","round_number","card_suit","card_rank");