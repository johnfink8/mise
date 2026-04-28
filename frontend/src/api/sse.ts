import type { StreamEvent, StreamEventType } from '@/types'

export type SseHandler = (evt: StreamEvent) => void

export function openSessionStream(sessionId: string, onEvent: SseHandler): () => void {
  const es = new EventSource(`/api/sessions/${sessionId}/stream`)
  const types: StreamEventType[] = [
    'started',
    'tool_call_started',
    'tool_call_completed',
    'assistant_text',
    'recommendations_ready',
    'error',
    'done',
  ]
  for (const t of types) {
    es.addEventListener(t, (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data)
        onEvent({ type: t, data })
      } catch {
        onEvent({ type: t, data: {} })
      }
    })
  }
  return () => es.close()
}
