CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."feedback" AS ENUM('none', 'up', 'down', 'watched');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('pending', 'running', 'complete', 'error');--> statement-breakpoint
CREATE TABLE "catalog_state" (
	"id" integer PRIMARY KEY NOT NULL,
	"last_refresh_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "collection" (
	"name" text PRIMARY KEY NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"rating_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "movie" (
	"rating_key" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"year" integer,
	"genres" text[] DEFAULT '{}'::text[] NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"audience_rating" real,
	"content_rating" text,
	"duration_min" integer,
	"directors" text[] DEFAULT '{}'::text[] NOT NULL,
	"top_cast" text[] DEFAULT '{}'::text[] NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"last_viewed_at" timestamp with time zone,
	"added_at" timestamp with time zone,
	"collections" text[] DEFAULT '{}'::text[] NOT NULL,
	"thumb" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "movie_embedding" (
	"rating_key" text PRIMARY KEY NOT NULL,
	"embedding" vector(384) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recommendation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"cycle" integer NOT NULL,
	"position" integer NOT NULL,
	"plex_rating_key" text NOT NULL,
	"title" text NOT NULL,
	"year" integer,
	"reasoning" text NOT NULL,
	"group" text,
	"feedback" "feedback" DEFAULT 'none' NOT NULL,
	"feedback_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_prompt" text NOT NULL,
	"prompts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"form_payload" jsonb,
	"model" text,
	"status" "session_status" DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"latency_ms" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"tool_calls_n" integer DEFAULT 0 NOT NULL,
	"follow_up_suggestions" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_call" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"cycle" integer NOT NULL,
	"turn" integer NOT NULL,
	"tool_name" text NOT NULL,
	"tool_input" jsonb NOT NULL,
	"tool_output" jsonb,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "movie_embedding" ADD CONSTRAINT "movie_embedding_rating_key_movie_rating_key_fk" FOREIGN KEY ("rating_key") REFERENCES "public"."movie"("rating_key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation" ADD CONSTRAINT "recommendation_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_call" ADD CONSTRAINT "tool_call_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "movie_embedding_cosine_idx" ON "movie_embedding" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "recommendation_session_cycle_idx" ON "recommendation" USING btree ("session_id","cycle","position");--> statement-breakpoint
CREATE INDEX "recommendation_rating_key_idx" ON "recommendation" USING btree ("plex_rating_key");--> statement-breakpoint
CREATE INDEX "tool_call_session_cycle_turn_idx" ON "tool_call" USING btree ("session_id","cycle","turn");