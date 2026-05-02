'use client';

import { useRouter } from 'next/navigation';
import { LobbyInput } from './LobbyInput';

export function HomeStart() {
  const router = useRouter();

  async function onSubmit(text: string) {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: text }),
    });
    if (!res.ok) throw new Error(`failed (${res.status})`);
    const { session_id } = (await res.json()) as { session_id: string };
    router.push(`/sessions/${session_id}`);
  }

  return <LobbyInput variant="initial" onSubmit={onSubmit} sticky autoFocus />;
}
