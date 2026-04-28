import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  ToolLogList,
  eventsToToolEntries,
  toolCallsToEntries,
} from '@/components/ToolLogList'
import type { StreamEvent, ToolCall } from '@/types'

describe('eventsToToolEntries', () => {
  it('pairs started and completed events on the same cycle', () => {
    const events: StreamEvent[] = [
      {
        type: 'tool_call_started',
        data: {
          cycle: 0,
          turn: 1,
          tool_name: 'search_movies',
          tool_input: { genres: ['comedy'] },
        },
      },
      {
        type: 'tool_call_completed',
        data: {
          cycle: 0,
          turn: 1,
          tool_name: 'search_movies',
          duration_ms: 12,
          tool_output: { results: [{ rating_key: '1' }, { rating_key: '2' }] },
          summary: { count: 2, total_matches: 14 },
        },
      },
    ]
    const entries = eventsToToolEntries(events, 0)
    expect(entries).toHaveLength(1)
    expect(entries[0].state).toBe('done')
    expect(entries[0].toolOutput).toEqual({
      results: [{ rating_key: '1' }, { rating_key: '2' }],
    })
  })

  it('filters by cycle when provided', () => {
    const events: StreamEvent[] = [
      {
        type: 'tool_call_started',
        data: { cycle: 0, turn: 1, tool_name: 'search_movies', tool_input: {} },
      },
      {
        type: 'tool_call_started',
        data: { cycle: 1, turn: 1, tool_name: 'get_user_history', tool_input: {} },
      },
    ]
    expect(eventsToToolEntries(events, 0)).toHaveLength(1)
    expect(eventsToToolEntries(events, 1)).toHaveLength(1)
  })
})

describe('toolCallsToEntries', () => {
  it('derives a count summary from output arrays', () => {
    const tcs: ToolCall[] = [
      {
        id: 'tc1',
        cycle: 0,
        turn: 1,
        tool_name: 'search_movies',
        tool_input: { genres: ['comedy'] },
        tool_output: { results: [1, 2, 3], total_matches: 9 },
        duration_ms: 5,
        created_at: '2026-04-01T00:00:00Z',
      },
    ]
    const entries = toolCallsToEntries(tcs)
    expect(entries[0].summary).toEqual({ total_matches: 9, count: 3 })
  })
})

describe('ToolLogList', () => {
  it('renders nothing when no entries and not in progress', () => {
    const { container } = render(<ToolLogList entries={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('expands on click and reveals INPUT/OUTPUT tabs', async () => {
    const user = userEvent.setup()
    const tcs: ToolCall[] = [
      {
        id: 'tc1',
        cycle: 0,
        turn: 1,
        tool_name: 'search_movies',
        tool_input: { genres: ['comedy'], year_min: 1990 },
        tool_output: { count: 1, total_matches: 14 },
        duration_ms: 5,
        created_at: '2026-04-01T00:00:00Z',
      },
    ]
    const entries = toolCallsToEntries(tcs)
    render(<ToolLogList entries={entries} />)
    // Tabs are not rendered until the card is open.
    expect(screen.queryByText(/^input$/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^output$/i)).not.toBeInTheDocument()
    await user.click(screen.getByText(/search_movies/))
    expect(screen.getByText(/^input$/i)).toBeInTheDocument()
    expect(screen.getByText(/^output$/i)).toBeInTheDocument()
  })
})
