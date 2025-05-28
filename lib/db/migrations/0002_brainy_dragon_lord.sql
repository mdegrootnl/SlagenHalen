CREATE TYPE "public"."game_status_enum" AS ENUM('pending', 'active', 'bidding', 'active_play', 'round_over', 'round_summary', 'finished', 'archived');--> statement-breakpoint
CREATE TABLE "player_round_score_changes" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_session_id" integer NOT NULL,
	"game_player_id" integer NOT NULL,
	"round_number" integer NOT NULL,
	"score_change" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "player_round_score_changes" ADD CONSTRAINT "player_round_score_changes_game_session_id_game_sessions_id_fk" FOREIGN KEY ("game_session_id") REFERENCES "public"."game_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_round_score_changes" ADD CONSTRAINT "player_round_score_changes_game_player_id_game_players_id_fk" FOREIGN KEY ("game_player_id") REFERENCES "public"."game_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prsc_game_session_idx" ON "player_round_score_changes" USING btree ("game_session_id");--> statement-breakpoint
CREATE INDEX "prsc_game_player_idx" ON "player_round_score_changes" USING btree ("game_player_id");--> statement-breakpoint
CREATE INDEX "prsc_round_idx" ON "player_round_score_changes" USING btree ("round_number");