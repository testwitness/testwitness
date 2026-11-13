/**
 * Line endings. Windows repositories commit CRLF, and a PR may convert a file between CRLF and LF. Everything that
 * reads source text works on LF: CRLF and LF give the same lines, so line numbers do not change, and snippets,
 * assertion text and hashes come out the same whichever line endings a file was committed with.
 */

/** CRLF to LF. A lone CR (classic Mac OS) is left alone: it is not a line ending git or the parsers split on. */
export function toLf(text: string): string {
  return text.includes('\r') ? text.replace(/\r\n/g, '\n') : text;
}
