import Link from 'next/link';
import { listSessions } from '@/lib/sessions/queries';

export const dynamic = 'force-dynamic';

function relTime(d: Date): string {
  const ms = Date.now() - d.getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

export default async function HistoryPage() {
  const { sessions, total } = await listSessions({ limit: 50 });

  if (sessions.length === 0) {
    return (
      <main>
        <p className="muted">no sessions yet — start one from the home page.</p>
      </main>
    );
  }

  return (
    <main>
      <p className="faint" style={{ fontSize: 13, marginBottom: 16 }}>
        {total} session{total === 1 ? '' : 's'}
      </p>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {sessions.map((s) => (
          <li
            key={s.id}
            style={{
              display: 'flex',
              gap: 16,
              alignItems: 'baseline',
              padding: '14px 0',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <span className={`pill ${s.status}`}>{s.status}</span>
            <Link
              href={`/sessions/${s.id}`}
              style={{ flex: 1, fontWeight: 500 }}
            >
              {s.userPrompt}
            </Link>
            <span className="faint" style={{ fontSize: 12 }}>
              {relTime(new Date(s.createdAt))}
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}
