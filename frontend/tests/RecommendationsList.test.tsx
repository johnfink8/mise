import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { RecommendationsList } from '@/components/RecommendationsList'
import type { Recommendation } from '@/types'

function makeRec(overrides: Partial<Recommendation>): Recommendation {
  return {
    id: overrides.id ?? '1',
    session_id: 'sess',
    cycle: 0,
    position: 1,
    plex_rating_key: '42',
    title: 'A Movie',
    year: 2020,
    reasoning: 'Because.',
    group: null,
    feedback: 'none',
    feedback_at: null,
    created_at: '2026-04-01T00:00:00Z',
    ...overrides,
  }
}

describe('RecommendationsList', () => {
  it('renders flat when no rec has a group', () => {
    const recs = [
      makeRec({ id: '1', title: 'Alpha', plex_rating_key: '1' }),
      makeRec({ id: '2', title: 'Beta', plex_rating_key: '2' }),
    ]
    render(<RecommendationsList recommendations={recs} />)
    expect(screen.getByRole('heading', { name: /Alpha/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Beta/ })).toBeInTheDocument()
    // No section labels should appear in flat mode
    expect(screen.queryByText(/━━━/)).not.toBeInTheDocument()
  })

  it('renders sections when recs have groups, preserving first-seen order', () => {
    const recs = [
      makeRec({ id: '1', title: 'Alpha', plex_rating_key: '1', group: 'Cerebral sci-fi' }),
      makeRec({ id: '2', title: 'Beta', plex_rating_key: '2', group: 'Pulpy popcorn' }),
      makeRec({ id: '3', title: 'Gamma', plex_rating_key: '3', group: 'Cerebral sci-fi' }),
    ]
    render(<RecommendationsList recommendations={recs} />)
    expect(screen.getByText(/CEREBRAL SCI-FI · 2/)).toBeInTheDocument()
    expect(screen.getByText(/PULPY POPCORN · 1/)).toBeInTheDocument()
    const sections = screen.getAllByText(/━━━/)
    expect(sections[0].textContent).toMatch(/CEREBRAL SCI-FI/)
    expect(sections[1].textContent).toMatch(/PULPY POPCORN/)
  })

  it('puts ungrouped picks into an "Other picks" bucket when mixed', () => {
    const recs = [
      makeRec({ id: '1', title: 'Alpha', plex_rating_key: '1', group: 'Heists' }),
      makeRec({ id: '2', title: 'Beta', plex_rating_key: '2', group: null }),
    ]
    render(<RecommendationsList recommendations={recs} />)
    expect(screen.getByText(/HEISTS · 1/)).toBeInTheDocument()
    expect(screen.getByText(/OTHER PICKS · 1/)).toBeInTheDocument()
  })
})
