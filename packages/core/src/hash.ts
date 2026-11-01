import { createHash } from 'node:crypto';

/** Short stable hash (first 16 hex chars of sha256). */
export function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

/**
 * Finding fingerprint. Deliberately excludes line numbers so a finding survives
 * line shifts and rebases. The snippet is normalised before hashing.
 */
export function fingerprint(ruleId: string, path: string, subject: string, snippet = ''): string {
  const norm = snippet.replace(/\s+/g, ' ').trim();
  return `${ruleId}:${path}:${subject}` + (norm ? `:${shortHash(norm)}` : '');
}
