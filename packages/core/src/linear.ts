/**
 * String helpers that replace regular expressions which were quadratic on hostile input (docs/threat-model.md,
 * "ReDoS"). Each does one pass.
 */

/** Remove the trailing run of characters that are in `chars`. Same result as `s.replace(/[chars]+$/, '')`. */
export function trimEndChars(s: string, chars: string): string {
  let end = s.length;
  while (end > 0 && chars.includes(s[end - 1]!)) end--;
  return end === s.length ? s : s.slice(0, end);
}

/**
 * Replace every `open ... close` span (shortest, not nested) by `replacement`. Same result as the global lazy regex
 * `open[\s\S]*?close`, which rescans to the end of the text from every opener once no closer is left.
 */
export function replaceDelimited(text: string, open: string, close: string, replacement: string): string {
  let out = '';
  let pos = 0;
  for (;;) {
    const start = text.indexOf(open, pos);
    if (start < 0) break;
    const end = text.indexOf(close, start + open.length);
    if (end < 0) break;
    out += text.slice(pos, start) + replacement;
    pos = end + close.length;
  }
  return pos === 0 ? text : out + text.slice(pos);
}

/** Lines of a text as `.` and `$` see them: split at LF, CR, U+2028 and U+2029. */
export function regexLines(text: string): string[] {
  return text.split(/[\n\r\u2028\u2029]/);
}
