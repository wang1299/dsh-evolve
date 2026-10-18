import { digest } from './domain.js';

// Version the full scoring/tokenization contract for reproducible evaluation plans.
const stopWords = new Set(('a an and are as at be been being but by can could did do does for from had has have how i if in into is it its may might of on or our should so than that the their them then there these they this those to was we were what when where which while will with would you your').split(' '));
export const retrievalPolicy = { version: 'bm25-v1', k1: 1.2, b: 0.75, titleWeight: 2,
  minimumAnchors: 2, minimumTitleAnchors: 1, minimumScore: 0.2,
  tokenizer: 'NFKC/camel-snake/ascii-words/cjk-bigrams/v1', stopWords: [...stopWords].sort() } as const;
export const retrievalPolicyDigest = digest(JSON.stringify(retrievalPolicy));
export interface TextDocument { id: string; title: string; strategy: string }
export interface TextMatch { id: string; score: number; rawScore: number; anchors: number; titleAnchors: number;
  reason: 'insufficient_anchors' | 'no_title_anchor' | 'low_bm25' | null }

export function retrievalTokens(text: string): string[] {
  const normalized = text.normalize('NFKC').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return (normalized.match(/[a-z][a-z0-9]*|[\u4e00-\u9fff]+/g) ?? []).flatMap((word) => {
    if (/^[\u4e00-\u9fff]/.test(word)) return Array.from({ length: word.length - 1 }, (_, i) => word.slice(i, i + 2));
    return stopWords.has(word) ? [] : [word];
  });
}

/** Scores only the supplied corpus. Callers enforce source and scope eligibility before indexing. */
export function rankText(query: string, documents: TextDocument[]): TextMatch[] {
  if (new Set(documents.map((d) => d.id)).size !== documents.length) throw new Error('Duplicate retrieval document');
  const q = new Set(retrievalTokens(query)); const df = new Map<string, number>();
  const indexed = documents.map((d) => {
    const title = retrievalTokens(d.title); const strategy = retrievalTokens(d.strategy); const tf = new Map<string, number>();
    for (const token of title) tf.set(token, (tf.get(token) ?? 0) + retrievalPolicy.titleWeight);
    for (const token of strategy) tf.set(token, (tf.get(token) ?? 0) + 1);
    for (const token of tf.keys()) df.set(token, (df.get(token) ?? 0) + 1);
    return { id: d.id, title: new Set(title), tf, length: title.length * retrievalPolicy.titleWeight + strategy.length };
  });
  const averageLength = indexed.reduce((n, d) => n + d.length, 0) / (indexed.length || 1);
  return indexed.map((d): TextMatch => {
    let rawScore = 0; let anchors = 0; let titleAnchors = 0;
    for (const token of q) {
      const frequency = d.tf.get(token); if (!frequency) continue;
      anchors++; if (d.title.has(token)) titleAnchors++;
      const idf = Math.log(1 + (indexed.length - df.get(token)! + 0.5) / (df.get(token)! + 0.5));
      rawScore += idf * frequency * (retrievalPolicy.k1 + 1)
        / (frequency + retrievalPolicy.k1 * (1 - retrievalPolicy.b + retrievalPolicy.b * d.length / averageLength));
    }
    const score = rawScore / (1 + rawScore);
    const reason = anchors < retrievalPolicy.minimumAnchors ? 'insufficient_anchors'
      : titleAnchors < retrievalPolicy.minimumTitleAnchors ? 'no_title_anchor'
        : score < retrievalPolicy.minimumScore ? 'low_bm25' : null;
    return { id: d.id, score, rawScore, anchors, titleAnchors, reason };
  }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
