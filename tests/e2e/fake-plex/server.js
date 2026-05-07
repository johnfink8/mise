/**
 * Tiny fake Plex server for e2e tests. Serves the subset of endpoints
 * `refreshFromPlex()` reaches: identity, sections, bulk listing, per-movie
 * metadata, and (empty) collections. Reads its data from seed.json so tests
 * can swap a different seed in by mounting another file at the same path.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 8421);
const HOST = process.env.HOST || '0.0.0.0';
const SEED_PATH = process.env.SEED_PATH || path.join(__dirname, 'seed.json');

const movies = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
const byKey = new Map(movies.map((m) => [String(m.ratingKey), m]));

const SECTION_KEY = '1';
const MACHINE_ID = 'fake-machine-id';

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function listAll(start, size) {
  const slice = movies.slice(start, start + size);
  return {
    MediaContainer: {
      size: slice.length,
      totalSize: movies.length,
      offset: start,
      Metadata: slice,
    },
  };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  if (p === '/identity') {
    return send(res, 200, { MediaContainer: { machineIdentifier: MACHINE_ID } });
  }

  if (p === '/library/sections') {
    return send(res, 200, {
      MediaContainer: {
        Directory: [
          { key: SECTION_KEY, type: 'movie', title: 'Movies', totalSize: movies.length },
        ],
      },
    });
  }

  const allMatch = p.match(/^\/library\/sections\/([^/]+)\/all$/);
  if (allMatch) {
    if (allMatch[1] !== SECTION_KEY) return send(res, 404, { error: 'unknown section' });
    const start = Number(url.searchParams.get('X-Plex-Container-Start') || 0);
    const size = Number(url.searchParams.get('X-Plex-Container-Size') || 200);
    return send(res, 200, listAll(start, size));
  }

  const collectionsMatch = p.match(/^\/library\/sections\/([^/]+)\/collections$/);
  if (collectionsMatch) {
    return send(res, 200, { MediaContainer: { Metadata: [] } });
  }

  const childrenMatch = p.match(/^\/library\/collections\/[^/]+\/children$/);
  if (childrenMatch) {
    return send(res, 200, { MediaContainer: { Metadata: [] } });
  }

  const metadataMatch = p.match(/^\/library\/metadata\/([^/]+)$/);
  if (metadataMatch) {
    const m = byKey.get(metadataMatch[1]);
    if (!m) return send(res, 404, { MediaContainer: { Metadata: [] } });
    return send(res, 200, { MediaContainer: { Metadata: [m] } });
  }

  send(res, 404, { error: `no fake handler for ${req.method} ${p}` });
});

server.listen(PORT, HOST, () => {
  console.log(`fake-plex listening on http://${HOST}:${PORT} with ${movies.length} movies`);
});
