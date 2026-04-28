export type SessionStatus = "pending" | "running" | "complete" | "error";

export type FeedbackStatus = "none" | "up" | "down" | "watched";

export interface SessionFilters {
  genres?: string[];
  year_min?: number;
  year_max?: number;
  max_runtime?: number;
  watched_status?: "watched" | "unwatched" | "any";
}

export interface SessionCreateBody {
  prompt: string;
  count?: number;
  filters?: SessionFilters;
}

export interface SessionCreated {
  session_id: string;
}

export interface ToolCall {
  id: string;
  cycle: number;
  turn: number;
  tool_name: string;
  tool_input: Record<string, unknown> | null;
  tool_output: Record<string, unknown> | null;
  duration_ms: number | null;
  created_at: string;
}

export interface Recommendation {
  id: string;
  session_id: string;
  cycle: number;
  position: number;
  plex_rating_key: string;
  title: string;
  year: number | null;
  reasoning: string;
  group: string | null;
  feedback: FeedbackStatus;
  feedback_at: string | null;
  created_at: string;
  // Hydrated from the catalog at read time.
  genres?: string[];
  synopsis?: string;
  directors?: string[];
  cast?: string[];
  runtime_min?: number | null;
  content_rating?: string | null;
  audience_rating?: number | null;
  play_url?: string | null;
}

export interface Session {
  id: string;
  created_at: string;
  user_prompt: string;
  prompts: string[] | null;
  follow_up_suggestions: (string | null)[] | null;
  form_payload: Record<string, unknown> | null;
  model: string;
  status: SessionStatus;
  error_message: string | null;
  latency_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  tool_calls_n: number | null;
}

export interface SessionContinueBody {
  prompt: string;
}

export interface SessionDetail extends Session {
  recommendations: Recommendation[];
  tool_calls: ToolCall[];
}

export interface SessionList {
  sessions: Session[];
  total: number;
}

export type StreamEventType =
  | "started"
  | "tool_call_started"
  | "tool_call_completed"
  | "assistant_text"
  | "recommendations_ready"
  | "error"
  | "done";

export interface StreamEvent {
  type: StreamEventType;
  data: Record<string, unknown>;
}

export interface StreamedRecommendation {
  id?: string;
  cycle: number;
  position: number;
  rating_key: string;
  title: string;
  year: number | null;
  genres: string[];
  reasoning: string;
  group?: string | null;
}
