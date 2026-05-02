'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

export function FollowUpForm({
  sessionId,
  placeholder,
}: {
  sessionId: string;
  placeholder?: string;
}) {
  const router = useRouter();
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      if (!res.ok) throw new Error(`failed (${res.status})`);
      setPrompt('');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ marginTop: 32 }}>
      <input
        type="text"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={placeholder ?? 'refine — try "shorter", "more upbeat", "hidden gems only"'}
        disabled={busy}
      />
    </form>
  );
}
