ALTER TABLE "session" ADD COLUMN "playlist_titles" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "plex_playlist_rating_key" text;