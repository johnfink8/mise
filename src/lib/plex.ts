export interface PlexMovie {
  ratingKey: string;
  title: string;
  year: number | null;
  summary: string;
  audienceRating: number | null;
  contentRating: string | null;
  durationMin: number | null;
  genres: string[];
  directors: string[];
  topCast: string[];
  collections: string[];
  viewCount: number;
  addedAt: Date | null;
  lastViewedAt: Date | null;
  thumb: string | null;
}

interface PlexMetadata {
  ratingKey: string;
  title: string;
  year?: number;
  summary?: string;
  audienceRating?: number;
  rating?: number;
  contentRating?: string;
  duration?: number;
  viewCount?: number;
  addedAt?: number;
  lastViewedAt?: number;
  thumb?: string;
  Genre?: { tag: string }[];
  Director?: { tag: string }[];
  Role?: { tag: string }[];
  Collection?: { tag: string }[];
}

interface PlexSection {
  key: string;
  type: string;
  title: string;
  totalSize?: number;
}

const baseUrl = () => {
  const u = process.env.PLEX_BASE_URL;
  if (!u) throw new Error('PLEX_BASE_URL not set');
  return u.replace(/\/+$/, '');
};

const token = () => {
  const t = process.env.PLEX_TOKEN;
  if (!t) throw new Error('PLEX_TOKEN not set');
  return t;
};

async function plexGet<T>(path: string, query: Record<string, string | number> = {}): Promise<T> {
  const url = new URL(baseUrl() + path);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'X-Plex-Token': token() },
  });
  if (!res.ok) throw new Error(`plex ${path} ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

function tsToDate(s: number | undefined): Date | null {
  return s ? new Date(s * 1000) : null;
}

function normalize(m: PlexMetadata): PlexMovie {
  return {
    ratingKey: String(m.ratingKey),
    title: m.title,
    year: m.year ?? null,
    summary: m.summary ?? '',
    audienceRating: m.audienceRating ?? m.rating ?? null,
    contentRating: m.contentRating ?? null,
    durationMin: m.duration ? Math.round(m.duration / 60_000) : null,
    genres: (m.Genre ?? []).map((g) => g.tag),
    directors: (m.Director ?? []).map((d) => d.tag),
    topCast: (m.Role ?? []).slice(0, 10).map((r) => r.tag),
    collections: (m.Collection ?? []).map((c) => c.tag),
    viewCount: m.viewCount ?? 0,
    addedAt: tsToDate(m.addedAt),
    lastViewedAt: tsToDate(m.lastViewedAt),
    thumb: m.thumb ?? null,
  };
}

export interface PlexCollection {
  name: string;
  size: number;
  ratingKeys: string[];
}

export async function listCollections(): Promise<PlexCollection[]> {
  const sections = await listMovieSections();
  const collections: PlexCollection[] = [];
  for (const section of sections) {
    const data = await plexGet<{
      MediaContainer: { Metadata?: { ratingKey: string; title: string; childCount?: string }[] };
    }>(`/library/sections/${section.key}/collections`);
    const list = data.MediaContainer.Metadata ?? [];
    for (const c of list) {
      const items = await plexGet<{
        MediaContainer: { Metadata?: { ratingKey: string }[] };
      }>(`/library/collections/${c.ratingKey}/children`);
      const ratingKeys = (items.MediaContainer.Metadata ?? []).map((m) => String(m.ratingKey));
      collections.push({ name: c.title, size: ratingKeys.length, ratingKeys });
    }
  }
  return collections;
}

export async function listMovieSections(): Promise<PlexSection[]> {
  const data = await plexGet<{ MediaContainer: { Directory?: PlexSection[] } }>('/library/sections');
  return (data.MediaContainer.Directory ?? []).filter((d) => d.type === 'movie');
}

export async function listMovies(opts: { limit?: number } = {}): Promise<PlexMovie[]> {
  const sections = await listMovieSections();
  const movies: PlexMovie[] = [];
  const pageSize = 200;
  for (const section of sections) {
    let start = 0;
    for (;;) {
      const data = await plexGet<{ MediaContainer: { Metadata?: PlexMetadata[] } }>(
        `/library/sections/${section.key}/all`,
        { type: 1, 'X-Plex-Container-Start': start, 'X-Plex-Container-Size': pageSize },
      );
      const page = data.MediaContainer.Metadata ?? [];
      for (const m of page) {
        movies.push(normalize(m));
        if (opts.limit && movies.length >= opts.limit) return movies;
      }
      if (page.length < pageSize) break;
      start += page.length;
    }
  }
  return movies;
}

export async function fetchThumb(ratingKey: string): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const data = await plexGet<{ MediaContainer: { Metadata?: PlexMetadata[] } }>(
    `/library/metadata/${ratingKey}`,
  );
  const item = data.MediaContainer.Metadata?.[0];
  if (!item?.thumb) throw new Error(`no thumb for ${ratingKey}`);
  const url = new URL(baseUrl() + item.thumb);
  url.searchParams.set('X-Plex-Token', token());
  const res = await fetch(url);
  if (!res.ok) throw new Error(`plex thumb ${ratingKey} ${res.status}`);
  return {
    bytes: await res.arrayBuffer(),
    contentType: res.headers.get('content-type') ?? 'image/jpeg',
  };
}
