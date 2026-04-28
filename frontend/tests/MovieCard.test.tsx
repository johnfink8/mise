import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { MovieCard } from '@/components/MovieCard'
import type { Recommendation } from '@/types'

const rec: Recommendation = {
  id: '00000000-0000-0000-0000-000000000001',
  session_id: '00000000-0000-0000-0000-000000000002',
  cycle: 0,
  position: 1,
  plex_rating_key: '42',
  title: 'Inception',
  year: 2010,
  reasoning: 'Mind-bending heist that fits a thoughtful mood.',
  group: null,
  feedback: 'none',
  feedback_at: null,
  created_at: '2026-04-01T12:00:00Z',
  genres: ['sci-fi', 'action'],
  synopsis: 'A thief who enters dreams.',
  directors: ['Christopher Nolan'],
  cast: ['Leonardo DiCaprio', 'Joseph Gordon-Levitt'],
  runtime_min: 148,
  content_rating: 'PG-13',
  audience_rating: 8.8,
}

describe('MovieCard', () => {
  it('renders title, year, synopsis, and the why-this-pick reasoning', () => {
    render(<MovieCard rec={rec} />)
    expect(screen.getByRole('heading', { name: /Inception/ })).toBeInTheDocument()
    expect(screen.getByText(/\(2010\)/)).toBeInTheDocument()
    expect(screen.getByText(/A thief who enters dreams/i)).toBeInTheDocument()
    expect(screen.getByText(/mind-bending heist/i)).toBeInTheDocument()
  })

  it('uses the proxied thumbnail URL', () => {
    render(<MovieCard rec={rec} />)
    const img = screen.getByRole('img', { name: 'Inception' }) as HTMLImageElement
    expect(img.src).toContain('/api/thumbs/42')
  })

  it('renders director and runtime in the mono caption', () => {
    render(<MovieCard rec={rec} />)
    // Director name is in a bold inner span so the "DIR." prefix stays light
    // — these are separate text nodes.
    expect(screen.getByText('CHRISTOPHER NOLAN')).toBeInTheDocument()
    expect(screen.getByText(/148 MIN/)).toBeInTheDocument()
  })

  it('fires the feedback callback on thumbs up', async () => {
    const user = userEvent.setup()
    const onFeedback = vi.fn()
    render(<MovieCard rec={rec} onFeedback={onFeedback} />)
    await user.click(screen.getByRole('button', { name: /good pick/i }))
    expect(onFeedback).toHaveBeenCalledWith('up')
  })

  it('toggles feedback off when same button is clicked again', async () => {
    const user = userEvent.setup()
    const onFeedback = vi.fn()
    render(<MovieCard rec={{ ...rec, feedback: 'up' }} onFeedback={onFeedback} />)
    await user.click(screen.getByRole('button', { name: /good pick/i }))
    expect(onFeedback).toHaveBeenCalledWith('none')
  })

  it('renders a Play link to Plex when play_url is provided', () => {
    render(<MovieCard rec={{ ...rec, play_url: 'https://app.plex.tv/desktop' }} />)
    const link = screen.getByRole('link', {
      name: /open in plex web/i,
    }) as HTMLAnchorElement
    expect(link.href).toBe('https://app.plex.tv/desktop')
    expect(link.target).toBe('_blank')
    expect(link).toHaveTextContent(/play/i)
  })

  it('hides the Play link when play_url is missing', () => {
    render(<MovieCard rec={{ ...rec, play_url: null }} />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
