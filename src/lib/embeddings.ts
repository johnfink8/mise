import { pipeline } from '@huggingface/transformers';

const MODEL_ID = 'Xenova/bge-small-en-v1.5';

// Narrow type for the bits of `feature-extraction` we actually use.
// `@huggingface/transformers`' own typings are pathologically deep and trigger
// "Expression produces a union type that is too complex to represent" (TS2590).
type FeatureExtractor = (
  text: string,
  options: { pooling: 'mean' | 'cls' | 'none'; normalize: boolean },
) => Promise<{ data: Float32Array }>;

let extractor: Promise<FeatureExtractor> | null = null;

function getExtractor(): Promise<FeatureExtractor> {
  if (extractor) return extractor;
  // @ts-expect-error — '@huggingface/transformers' overloads `pipeline()`
  // exhaustively per task; the inferred return for 'feature-extraction' is
  // too deep to represent (TS2590). The runtime-correct return matches
  // FeatureExtractor.
  const ext: Promise<FeatureExtractor> = pipeline('feature-extraction', MODEL_ID);
  extractor = ext;
  return ext;
}

export async function embed(text: string): Promise<number[]> {
  const ext = await getExtractor();
  const out = await ext(text, { pooling: 'mean', normalize: true });
  return Array.from(out.data);
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
