export default function Home() {
  return (
    <main style={{ fontFamily: 'system-ui', padding: 24 }}>
      <h1>mise-ts spike</h1>
      <p>
        Hit <a href="/api/spike">/api/spike</a> to run the Phase 0 checks (embeddings dim,
        pgvector roundtrip, Plex listMovies, Mastra agent).
      </p>
    </main>
  );
}
