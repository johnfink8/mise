import Link from 'next/link';

export default function NotFound() {
  return (
    <main>
      <h2 style={{ marginTop: 0, fontSize: 20, fontWeight: 500 }}>not found</h2>
      <p className="muted">that page doesn&apos;t exist.</p>
      <p style={{ marginTop: 16 }}>
        <Link href="/">← back home</Link>
      </p>
    </main>
  );
}
