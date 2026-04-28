import { useEffect, useRef, useState } from 'react'

import LinearProgress from '@mui/material/LinearProgress'

import { ChatPanel } from '@/components/ChatPanel'
import { Conversation } from '@/components/Conversation'
import { LibraryLoading } from '@/components/LibraryLoading'
import { LobbyTitle } from '@/components/LobbyTitle'
import { INITIAL_PLACEHOLDERS } from '@/components/placeholderPrompts'
import {
  useCatalog,
  useContinueSession,
  useCreateSession,
  useSession,
  useSubmitFeedback,
} from '@/api/hooks'
import { openSessionStream } from '@/api/sse'
import type { FeedbackStatus, Recommendation, StreamEvent } from '@/types'

import css from './HomePage.module.less'

export function HomePage() {
  const create = useCreateSession()
  const cont = useContinueSession()
  const feedback = useSubmitFeedback()

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [events, setEvents] = useState<StreamEvent[]>([])
  const [activeCycle, setActiveCycle] = useState<number | null>(null)
  const [streamDone, setStreamDone] = useState(false)
  const conversationEndRef = useRef<HTMLDivElement | null>(null)

  const session = useSession(sessionId ?? undefined)

  useEffect(() => {
    if (!sessionId) return
    setEvents([])
    setStreamDone(false)
    const close = openSessionStream(sessionId, (evt) => {
      setEvents((prev) => [...prev, evt])
      if (typeof evt.data.cycle === 'number') {
        setActiveCycle(evt.data.cycle as number)
      }
      if (evt.type === 'recommendations_ready' || evt.type === 'error') {
        setStreamDone(true)
      }
    })
    return close
  }, [sessionId])

  useEffect(() => {
    conversationEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [events.length, session.data?.recommendations.length, session.data?.prompts?.length])

  const status = session.data?.status
  const inProgress =
    Boolean(sessionId) &&
    !streamDone &&
    (status === 'pending' || status === 'running' || (status === undefined && !!sessionId))

  const handleSubmit = async (text: string) => {
    if (!sessionId) {
      setStreamDone(false)
      setActiveCycle(0)
      const result = await create.mutateAsync({ prompt: text })
      setSessionId(result.session_id)
    } else {
      setStreamDone(false)
      const nextCycle = session.data?.prompts?.length ?? 1
      setActiveCycle(nextCycle)
      await cont.mutateAsync({ sessionId, body: { prompt: text } })
    }
  }

  const handleFeedback = (rec: Recommendation, next: FeedbackStatus) => {
    if (!sessionId) return
    feedback.mutate({ id: rec.id, feedback: next, sessionId })
  }

  const errorMessage =
    status === 'error' ? (session.data?.error_message ?? 'Something went wrong.') : undefined

  const hasContent = !!session.data
  const recCount = session.data?.recommendations.length ?? 0

  // Placeholder strategy:
  // - No session yet: cycle through INITIAL_PLACEHOLDERS.
  // - Session exists: prefer the latest follow-up suggestion from a recent
  //   `recommendations_ready` SSE event (most current); fall back to the
  //   persisted suggestion list on the session object.
  const liveSuggestion = (() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const evt = events[i]
      if (
        evt.type === 'recommendations_ready' &&
        typeof evt.data.follow_up_suggestion === 'string' &&
        evt.data.follow_up_suggestion.trim()
      ) {
        return evt.data.follow_up_suggestion as string
      }
    }
    return null
  })()
  const persistedSuggestion =
    [...(session.data?.follow_up_suggestions ?? [])]
      .reverse()
      .find((s): s is string => typeof s === 'string' && s.trim().length > 0) ?? null
  const placeholder: string | readonly string[] = sessionId
    ? liveSuggestion ?? persistedSuggestion ?? 'something a little weirder…'
    : INITIAL_PLACEHOLDERS

  // Catalog loading state: the system signals when Plex data is being
  // pulled into Postgres on cold start. We show this in the eyebrow + a
  // dedicated panel below the wordmark, so the user sees that the system
  // is doing something before the library is queryable.
  const catalog = useCatalog()
  const catalogLoading = catalog.data?.loading ?? null
  const libraryEmpty = (catalog.data?.count ?? 0) === 0
  // Show the loading panel whenever a refresh or embedding sync is active.
  // On cold boot we also show it when the catalog is empty even before the
  // backend has set a phase (the warm task fires within a few hundred ms).
  const showLibraryLoading =
    catalogLoading !== null || (libraryEmpty && !catalog.isError)

  // Stateful eyebrow: drives the top-bar dot+label so the page reflects
  // what's happening — library loading wins over everything else (the user
  // can't do anything useful until it's populated), then thinking, then
  // result count, then the idle title.
  type Phase = 'loading' | 'thinking' | 'results' | 'initial'
  const phase: Phase = showLibraryLoading
    ? 'loading'
    : inProgress
      ? 'thinking'
      : recCount > 0
        ? 'results'
        : 'initial'
  const eyebrowText =
    phase === 'loading'
      ? 'LOADING LIBRARY…'
      : phase === 'thinking'
        ? 'THINKING…'
        : phase === 'results'
          ? `${recCount} RESULT${recCount === 1 ? '' : 'S'}`
          : 'MISE-EN-SCÈNE'

  return (
    <div className={css.root}>
      <div className={css.body}>
        <LobbyTitle
          eyebrow={eyebrowText}
          eyebrowPulsing={phase === 'thinking' || phase === 'loading'}
          rightLinks={[{ to: '/history', label: 'History' }]}
        />

        {showLibraryLoading && catalogLoading && (
          <LibraryLoading
            loading={catalogLoading}
            count={catalog.data?.count ?? 0}
          />
        )}

        {!hasContent && !showLibraryLoading && (
          <div className={css.empty}>
            <p className={css.emptyText}>
              Tell me what you're in the mood for. I'll comb through your Plex library
              and pull a programme together. Send a follow-up to refine.
            </p>
          </div>
        )}

        {hasContent && (
          <Conversation
            session={session.data!}
            liveEvents={events}
            liveCycle={activeCycle}
            inProgress={inProgress}
            onFeedback={handleFeedback}
            feedbackPending={feedback.isPending}
          />
        )}

        {inProgress && (
          <div className={css.statusRow}>
            <LinearProgress
              sx={{
                height: 2,
                borderRadius: 1,
                backgroundColor: 'var(--lobby-border)',
                '& .MuiLinearProgress-bar': { backgroundColor: 'var(--lobby-accent)' },
              }}
            />
          </div>
        )}
        {errorMessage && !inProgress && (
          <div className={css.statusRow}>
            <div className={css.errorAlert}>{errorMessage}</div>
          </div>
        )}
        <div ref={conversationEndRef} />
      </div>

      <ChatPanel
        onSubmit={handleSubmit}
        isPending={
          create.isPending ||
          cont.isPending ||
          inProgress ||
          (libraryEmpty && catalogLoading !== null)
        }
        isFollowUp={Boolean(sessionId)}
        placeholder={placeholder}
      />
    </div>
  )
}
