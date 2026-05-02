import Link from 'next/link';
import { listSessions } from '@/lib/sessions/queries';
import { LobbyTopBar } from '@/components/session/LobbyTopBar';

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

const STATUS_PILL_COLOR: Record<string, string> = {
  pending: 'text-mise-accent',
  running: 'text-mise-accent',
  complete: 'text-mise-accent',
  error: 'text-mise-down',
};

const STATUS_DOT_COLOR: Record<string, string> = {
  pending: 'bg-mise-accent shadow-[0_0_0_3px_var(--color-mise-accent-soft)]',
  running: 'bg-mise-accent shadow-[0_0_0_3px_var(--color-mise-accent-soft)]',
  complete: 'bg-mise-accent shadow-[0_0_0_3px_var(--color-mise-accent-soft)]',
  error: 'bg-mise-down shadow-[0_0_0_3px_var(--color-mise-down-soft)]',
};

export default async function HistoryPage() {
  const { sessions, total } = await listSessions({ limit: 50 });

  return (
    <div className="flex min-h-screen flex-col">
      <LobbyTopBar status="initial" showHistory={false} showNew />

      <div className="mx-auto w-full max-w-[980px] flex-1 px-5 pb-15 sm:px-7">
        <h2 className="mt-9 mb-2 font-serif text-[48px] font-normal tracking-[-0.03em] text-mise-fg">
          history<span className="text-mise-accent">.</span>
        </h2>

        {sessions.length === 0 ? (
          <p className="mt-4 font-serif text-[18px] italic text-mise-fg-dim">
            no sessions yet — start one from the home page.
          </p>
        ) : (
          <>
            <p className="eyebrow mb-6 mt-0">
              {total} SESSION{total === 1 ? '' : 'S'}
            </p>
            <ul className="m-0 list-none p-0">
              {sessions.map((s) => (
                <li key={s.id} className="border-t border-mise-border py-5">
                  <Link
                    href={`/sessions/${s.id}`}
                    className="flex flex-col gap-2 text-inherit no-underline"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span
                        className={`flex items-center gap-1.5 font-mono text-[11px] tracking-pill uppercase ${
                          STATUS_PILL_COLOR[s.status] ?? 'text-mise-fg-dim'
                        }`}
                      >
                        <span
                          className={`size-1.5 rounded-full ${
                            STATUS_DOT_COLOR[s.status] ?? 'bg-mise-fg-dim'
                          }`}
                        />
                        {s.status}
                      </span>
                      <span className="font-mono text-[11px] text-mise-fg-faint">
                        {relTime(new Date(s.createdAt))}
                      </span>
                    </div>
                    <div className="font-serif text-[22px] italic leading-[1.3] text-mise-fg">
                      &ldquo;{s.userPrompt}&rdquo;
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
