'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main>
      <div className="banner warn">
        <strong>Something went wrong.</strong>
        <p style={{ margin: '8px 0 0', fontSize: 13 }}>{error.message}</p>
        {error.digest && (
          <p className="faint" style={{ margin: '4px 0 0', fontSize: 11 }}>
            digest: {error.digest}
          </p>
        )}
      </div>
      <button onClick={reset} style={{ marginTop: 16 }}>
        try again
      </button>
    </main>
  );
}
