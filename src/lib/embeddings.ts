import { pipeline } from '@huggingface/transformers';

const MODEL_ID = 'Xenova/bge-small-en-v1.5';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let extractor: Promise<any> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getExtractor(): Promise<any> {
  if (!extractor) {
    extractor = pipeline('feature-extraction', MODEL_ID);
  }
  return extractor;
}

export async function embed(text: string): Promise<number[]> {
  const ext = await getExtractor();
  const out = await ext(text, { pooling: 'mean', normalize: true });
  return Array.from(out.data as Float32Array);
}

export async function embedMany(texts: string[]): Promise<number[][]> {
  return Promise.all(texts.map(embed));
}

export function vectorLiteral(v: number[]): string {
  return `[${v.join(',')}]`;
}

export function buildEmbeddingText(m: {
  title: string;
  year: number | null;
  genres: string[];
  summary: string;
  directors: string[];
  topCast: string[];
}): string {
  const parts = [
    `${m.title}${m.year ? ` (${m.year})` : ''}`,
    m.genres.length ? `Genres: ${m.genres.join(', ')}` : null,
    m.directors.length ? `Directed by ${m.directors.join(', ')}` : null,
    m.topCast.length ? `Starring ${m.topCast.slice(0, 5).join(', ')}` : null,
    m.summary,
  ].filter(Boolean);
  return parts.join('. ');
}
