export type Feedback = 'none' | 'up' | 'down' | 'watched';
export type SessionStatus = 'pending' | 'running' | 'complete' | 'error';

export interface RecOut {
  id: string;
  cycle: number;
  position: number;
  ratingKey: string;
  title: string;
  year: number | null;
  genres: string[];
  runtimeMin: number | null;
  audienceRating: number | null;
  directors: string[];
  topCast: string[];
  reasoning: string;
  group: string | null;
  feedback: Feedback;
  playUrl: string | null;
}

export interface ToolCallOut {
  id: string;
  cycle: number;
  turn: number;
  toolName: string;
  toolInput: Record<string, unknown>;
  durationMs: number;
}

export interface StepText {
  cycle: number;
  turn: number;
  text: string;
}

export interface SessionViewData {
  id: string;
  status: SessionStatus;
  userPrompt: string;
  prompts: string[];
  errorMessage: string | null;
  followUpSuggestions: (string | null)[];
  recommendations: RecOut[];
  toolCalls: ToolCallOut[];
  stepTexts: StepText[];
}

export interface LiveToolCall {
  cycle: number;
  turn: number;
  toolName: string;
  toolInput: Record<string, unknown>;
  done: boolean;
}

export interface StepCallView {
  toolName: string;
  toolInput: Record<string, unknown>;
  durationMs: number | null;
  done: boolean;
  id?: string;
}

export interface StepData {
  turn: number;
  text: string | null;
  calls: StepCallView[];
}
