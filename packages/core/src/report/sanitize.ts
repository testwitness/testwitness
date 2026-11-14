/**
 * Untrusted text (test names, file paths, PR text, assertion text, result file contents) on its way to any output.
 * One definition of "characters that must not arrive as they are", shared by the Markdown, text, annotation, hook and
 * MCP writers, so a new output cannot forget one class.
 *
 * Replaced by U+FFFD:
 *   C0 controls (ESC starts ANSI sequences; BEL, BS and CR rewrite a terminal line), DEL and the C1 range (U+009B is
 *   an eight bit CSI), the bidirectional controls (U+061C, U+200E, U+200F, U+202A to U+202E, U+2066 to U+2069: they
 *   reorder what a reviewer reads, "Trojan Source"), the zero width and invisible format characters (U+00AD, U+180E,
 *   U+200B to U+200D, U+2060 to U+2064, U+FEFF: they hide text or split a word a filter looks for), the interlinear
 *   annotation controls (U+FFF9 to U+FFFB), the Unicode tag characters (U+E0000 to U+E007F: invisible ASCII, a way to
 *   pass instructions to a model that reads the output), and unpaired surrogates.
 * Line breaks (CR LF, LF, CR, VT, FF, NEL, U+2028, U+2029) and tabs become a space in `oneLine`; `multiLine` keeps LF
 * and tab for the hook, which quotes several lines of a test.
 */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const LINE_BREAKS = /\r\n|[\n\r\t\u000b\u000c\u0085\u2028\u2029]/g;
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const OTHER_BREAKS = /\r\n?|[\u000b\u000c\u0085\u2028\u2029]/g;
const UNSAFE =
  // eslint-disable-next-line no-control-regex -- matching control and format characters is the point
  /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff\ufff9-\ufffb]|[\u{e0000}-\u{e007f}]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/gu;

export const REPLACEMENT = '�';

/** One line of safe text: line breaks and tabs become spaces, unsafe characters become U+FFFD. */
export function oneLine(s: string): string {
  return s.replace(LINE_BREAKS, ' ').replace(UNSAFE, REPLACEMENT);
}

/** Several lines of safe text: LF and tab stay, every other line break becomes LF, unsafe characters become U+FFFD. */
export function multiLine(s: string): string {
  return s.replace(OTHER_BREAKS, '\n').replace(UNSAFE, REPLACEMENT);
}

/** Cut text to `max` characters with a visible mark, without splitting a surrogate pair. */
export function clipText(s: string, max: number): string {
  if (s.length <= max) return s;
  let end = max - 1;
  const last = s.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end--;
  return `${s.slice(0, end)}…`;
}

/** True when the text holds a character `oneLine` would change. For tests and fuzzers. */
export function hasUnsafe(s: string): boolean {
  UNSAFE.lastIndex = 0;
  LINE_BREAKS.lastIndex = 0;
  const r = UNSAFE.test(s) || LINE_BREAKS.test(s);
  UNSAFE.lastIndex = 0;
  LINE_BREAKS.lastIndex = 0;
  return r;
}
