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

let cachedMachineId: string | null = null;

export async function getMachineIdentifier(): Promise<string | null> {
  if (cachedMachineId) return cachedMachineId;
  try {
    const data = await plexGet<{ MediaContainer: { machineIdentifier?: string } }>(
      '/identity',
    );
    const id = data.MediaContainer.machineIdentifier;
    if (id) cachedMachineId = id;
    return cachedMachineId;
  } catch {
    return null;
  }
}

export function buildPlayUrl(machineId: string, ratingKey: string): string {
  return (
    `https://app.plex.tv/desktop/#!/server/${machineId}` +
    `/details?key=%2Flibrary%2Fmetadata%2F${ratingKey}`
  );
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

/**
 * Fetch the full metadata for one movie from /library/metadata/{ratingKey}.
 *
 * The bulk `/library/sections/{id}/all` endpoint returns abbreviated metadata:
 * cast is hard-capped at 3 entries regardless of `includeAdvanced` / `includeMeta`
 * flags. This per-movie endpoint returns the complete `<Role>` list.
 *
 * Returns `null` if the movie has been deleted between the bulk fetch and
 * this call, so callers can fall back to whatever bulk data they have.
 */
export async function fetchMovieMetadata(ratingKey: string): Promise<PlexMovie | null> {
  try {
    const data = await plexGet<{ MediaContainer: { Metadata?: PlexMetadata[] } }>(
      `/library/metadata/${ratingKey}`,
    );
    const item = data.MediaContainer.Metadata?.[0];
    return item ? normalize(item) : null;
  } catch {
    return null;
  }
}

/**
 * Enrich a bulk-fetched list of movies with full metadata (notably the
 * complete cast). Runs `concurrency` per-movie fetches in parallel; the
 * default of 16 keeps Plex happy on typical hardware. Per-movie failures
 * fall back to the bulk record.
 */
export async function enrichWithFullMetadata(
  movies: PlexMovie[],
  opts: {
    concurrency?: number;
    onProgress?: (done: number, total: number) => void;
  } = {},
): Promise<PlexMovie[]> {
  const concurrency = opts.concurrency ?? 16;
  const result: PlexMovie[] = new Array(movies.length);
  let nextIdx = 0;
  let done = 0;

  async function worker(): Promise<void> {
    while (true) {
      const idx = nextIdx++;
      if (idx >= movies.length) return;
      const orig = movies[idx];
      const full = await fetchMovieMetadata(orig.ratingKey);
      result[idx] = full ?? orig;
      done += 1;
      opts.onProgress?.(done, movies.length);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return result;
}

/**
 * Create a new Plex video playlist with the given items (in order). Returns
 * the playlist's ratingKey and a deep-link the user can open in any Plex
 * client.
 *
 * Plex playlists are per-account, not per-section, so they show up wherever
 * the user is signed in (TV apps, web, mobile). To surface one on the home
 * screen the user pins it manually from the Plex client — that's a per-app
 * setting Plex doesn't expose via API.
 */
export async function createMoviePlaylist(opts: {
  title: string;
  summary?: string | null;
  ratingKeys: string[];
}): Promise<{ ratingKey: string; deepLink: string | null; title: string }> {
  if (opts.ratingKeys.length === 0) {
    throw new Error('cannot create an empty playlist');
  }
  const machineId = await getMachineIdentifier();
  if (!machineId) throw new Error('plex machineIdentifier unavailable');

  const itemUri =
    `server://${machineId}/com.plexapp.plugins.library/library/metadata/` +
    opts.ratingKeys.join(',');

  const url = new URL(baseUrl() + '/playlists');
  url.searchParams.set('type', 'video');
  url.searchParams.set('title', opts.title);
  url.searchParams.set('smart', '0');
  url.searchParams.set('uri', itemUri);

  const res = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'X-Plex-Token': token() },
  });
  if (!res.ok) {
    throw new Error(`plex playlist create ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as {
    MediaContainer?: { Metadata?: { ratingKey?: string; title?: string }[] };
  };
  const created = data.MediaContainer?.Metadata?.[0];
  if (!created?.ratingKey) {
    throw new Error('plex playlist create returned no metadata');
  }
  const ratingKey = String(created.ratingKey);

  // Plex's POST /playlists doesn't accept a summary param, so set it via the
  // standard metadata edit endpoint after creation.
  if (opts.summary && opts.summary.trim().length > 0) {
    await setPlaylistSummary(ratingKey, opts.summary);
  }

  const deepLink =
    `https://app.plex.tv/desktop/#!/server/${machineId}/playlist?key=` +
    encodeURIComponent(`/playlists/${ratingKey}`);
  return { ratingKey, deepLink, title: created.title ?? opts.title };
}

function playlistDeepLink(machineId: string, ratingKey: string): string {
  return (
    `https://app.plex.tv/desktop/#!/server/${machineId}/playlist?key=` +
    encodeURIComponent(`/playlists/${ratingKey}`)
  );
}

/**
 * Title prefix used to identify playlists that mise owns. We never create a
 * playlist without this prefix, so any match is something we made (or
 * something the user duplicated). Renaming away from this prefix is the
 * user's escape hatch: the renamed playlist is no longer managed by mise.
 */
const MISE_PLAYLIST_PREFIX = 'mise · ';

async function listAllPlaylists(): Promise<
  { ratingKey: string; title: string }[]
> {
  const data = await plexGet<{
    MediaContainer: { Metadata?: { ratingKey: string; title: string }[] };
  }>('/playlists?playlistType=video');
  return (data.MediaContainer.Metadata ?? []).map((p) => ({
    ratingKey: String(p.ratingKey),
    title: p.title,
  }));
}

async function deletePlaylist(ratingKey: string): Promise<void> {
  const url = new URL(baseUrl() + `/playlists/${ratingKey}`);
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Accept: 'application/json', 'X-Plex-Token': token() },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`plex playlist delete ${res.status} ${res.statusText}`);
  }
}

async function setPlaylistTitle(ratingKey: string, title: string): Promise<void> {
  const url = new URL(baseUrl() + `/library/metadata/${ratingKey}`);
  url.searchParams.set('title.value', title);
  url.searchParams.set('title.locked', '1');
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Accept: 'application/json', 'X-Plex-Token': token() },
  });
  if (!res.ok) {
    throw new Error(`plex playlist rename ${res.status} ${res.statusText}`);
  }
}

async function setPlaylistSummary(ratingKey: string, summary: string): Promise<void> {
  const url = new URL(baseUrl() + `/library/metadata/${ratingKey}`);
  url.searchParams.set('summary.value', summary);
  url.searchParams.set('summary.locked', '1');
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Accept: 'application/json', 'X-Plex-Token': token() },
  });
  if (!res.ok) {
    throw new Error(`plex playlist summary ${res.status} ${res.statusText}`);
  }
}

interface PlexPlaylistItem {
  playlistItemID: string;
}

async function listPlaylistItems(ratingKey: string): Promise<PlexPlaylistItem[]> {
  const data = await plexGet<{
    MediaContainer: { Metadata?: PlexPlaylistItem[] };
  }>(`/playlists/${ratingKey}/items`);
  return data.MediaContainer.Metadata ?? [];
}

async function clearPlaylistItems(ratingKey: string): Promise<void> {
  // Plex has no bulk-clear endpoint; iterate per item. Fast enough for our
  // playlist sizes (<=25). Run in parallel — order doesn't matter for clear.
  const items = await listPlaylistItems(ratingKey);
  await Promise.all(
    items.map(async (it) => {
      const url = new URL(
        baseUrl() + `/playlists/${ratingKey}/items/${it.playlistItemID}`,
      );
      const res = await fetch(url, {
        method: 'DELETE',
        headers: { Accept: 'application/json', 'X-Plex-Token': token() },
      });
      if (!res.ok) {
        throw new Error(`plex playlist item delete ${res.status}`);
      }
    }),
  );
}

async function addPlaylistItems(
  ratingKey: string,
  movieRatingKeys: string[],
  machineId: string,
): Promise<void> {
  const itemUri =
    `server://${machineId}/com.plexapp.plugins.library/library/metadata/` +
    movieRatingKeys.join(',');
  const url = new URL(baseUrl() + `/playlists/${ratingKey}/items`);
  url.searchParams.set('uri', itemUri);
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Accept: 'application/json', 'X-Plex-Token': token() },
  });
  if (!res.ok) {
    throw new Error(`plex playlist add items ${res.status} ${res.statusText}`);
  }
}

/**
 * Create-or-update mise's singleton Plex playlist.
 *
 * Discovery is by title prefix (`mise · `): we list all playlists, keep the
 * first one whose title starts with the prefix, delete any others (cleaning
 * up duplicates from prior single-per-session runs), and update the kept one
 * in place. The kept one's ratingKey is preserved across calls so any
 * home-screen pinning the user did stays intact.
 *
 * If no managed playlist exists, a fresh one is created with the supplied
 * title (which the caller is responsible for prefixing).
 *
 * Returns the (possibly-new) ratingKey, a deep link, and whether this call
 * created a new playlist or updated an existing one.
 */
export async function upsertMoviePlaylist(opts: {
  title: string;
  summary?: string | null;
  ratingKeys: string[];
}): Promise<{
  ratingKey: string;
  deepLink: string | null;
  title: string;
  created: boolean;
}> {
  if (opts.ratingKeys.length === 0) {
    throw new Error('cannot save an empty playlist');
  }
  const machineId = await getMachineIdentifier();
  if (!machineId) throw new Error('plex machineIdentifier unavailable');

  const all = await listAllPlaylists();
  const managed = all.filter((p) => p.title.startsWith(MISE_PLAYLIST_PREFIX));

  if (managed.length === 0) {
    const created = await createMoviePlaylist({
      title: opts.title,
      summary: opts.summary,
      ratingKeys: opts.ratingKeys,
    });
    return { ...created, created: true };
  }

  // Keep the first match, delete any others. Order isn't meaningful (Plex
  // returns by addedAt by default); keeping `[0]` is stable enough.
  const [keep, ...drop] = managed;
  if (drop.length > 0) {
    await Promise.all(drop.map((p) => deletePlaylist(p.ratingKey)));
  }

  await setPlaylistTitle(keep.ratingKey, opts.title);
  if (opts.summary && opts.summary.trim().length > 0) {
    await setPlaylistSummary(keep.ratingKey, opts.summary);
  }
  await clearPlaylistItems(keep.ratingKey);
  await addPlaylistItems(keep.ratingKey, opts.ratingKeys, machineId);
  return {
    ratingKey: keep.ratingKey,
    deepLink: playlistDeepLink(machineId, keep.ratingKey),
    title: opts.title,
    created: false,
  };
}

export async function fetchThumb(ratingKey: string): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const data = await plexGet<{ MediaContainer: { Metadata?: PlexMetadata[] } }>(
    `/library/metadata/${ratingKey}`,
  );
  const item = data.MediaContainer.Metadata?.[0];
  if (!item?.thumb) throw new Error(`no thumb for ${ratingKey}`);
  const url = new URL(baseUrl() + item.thumb);
  const res = await fetch(url, { headers: { 'X-Plex-Token': token() } });
  if (!res.ok) throw new Error(`plex thumb ${ratingKey} ${res.status}`);
  return {
    bytes: await res.arrayBuffer(),
    contentType: res.headers.get('content-type') ?? 'image/jpeg',
  };
}
