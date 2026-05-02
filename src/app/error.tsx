'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto w-full max-w-[980px] px-7 py-10">
      <div className="rounded-sm border border-mise-down bg-mise-down/10 px-4 py-3 text-mise-down">
        <strong>Something went wrong.</strong>
        <p className="mt-2 mb-0 text-[13px]">{error.message}</p>
        {error.digest && (
          <p className="mt-1 mb-0 text-[11px] text-mise-fg-faint">digest: {error.digest}</p>
        )}
      </div>
      <button
        onClick={reset}
        className="mt-4 cursor-pointer rounded-sm border border-mise-border bg-transparent px-3 py-1.5 text-mise-fg hover:border-mise-accent"
      >
        try again
      </button>
    </main>
  );
}
