import { NextResponse } from 'next/server';
import { z } from 'zod';
import { listSessions } from '@/lib/sessions/queries';
import { startSession } from '@/lib/sessions/run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CreateBody = z.object({
  prompt: z.string().min(1),
  count: z.number().int().min(1).max(25).optional(),
  filters: z
    .object({
      genres: z.array(z.string()).optional(),
      year_min: z.number().int().optional(),
      year_max: z.number().int().optional(),
      watched_status: z.enum(['watched', 'unwatched', 'any']).optional(),
    })
    .optional(),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = CreateBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }
  const { sessionId } = await startSession({
    prompt: parsed.data.prompt,
    formPayload: { count: parsed.data.count, filters: parsed.data.filters } as Record<
      string,
      unknown
    >,
  });
  return NextResponse.json({ session_id: sessionId }, { status: 202 });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = Number(searchParams.get('limit') ?? '20');
  const offset = Number(searchParams.get('offset') ?? '0');
  const { sessions, total } = await listSessions({ limit, offset });
  return NextResponse.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      created_at: s.createdAt,
      status: s.status,
      user_prompt: s.userPrompt,
      prompts: s.prompts,
      error_message: s.errorMessage,
      latency_ms: s.latencyMs,
      input_tokens: s.inputTokens,
      output_tokens: s.outputTokens,
    })),
    total,
  });
}
