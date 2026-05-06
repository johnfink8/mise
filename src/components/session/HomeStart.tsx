'use client';

import { useRouter } from 'next/navigation';
import { LobbyInput } from './LobbyInput';
import { startSessionAction } from '@/app/actions/sessions';

export function HomeStart() {
  const router = useRouter();

  async function onSubmit(text: string) {
    const { sessionId } = await startSessionAction({ prompt: text });
    router.push(`/sessions/${sessionId}`);
  }

  return <LobbyInput variant="initial" onSubmit={onSubmit} sticky autoFocus />;
}
