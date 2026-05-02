'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

export default function NewSessionForm() {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      if (!res.ok) throw new Error(`failed (${res.status})`);
      const { session_id } = (await res.json()) as { session_id: string };
      router.push(`/sessions/${session_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
          }
        }}
        rows={4}
        placeholder="what's the vibe? e.g. moody slow-burn sci-fi about memory and grief"
        autoFocus
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
        <span className="faint" style={{ fontSize: 12 }}>
          enter to submit · shift-enter for newline
        </span>
        <button type="submit" disabled={!prompt.trim() || busy}>
          {busy ? 'starting…' : 'recommend'}
        </button>
      </div>
      {error && (
        <div className="banner warn" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}
    </form>
  );
}
