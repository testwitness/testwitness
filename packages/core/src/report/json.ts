import type { Report } from '../types.js';

/**
 * JSON.stringify escapes the C0 controls but writes DEL, the C1 range, the line and paragraph separators and the
 * bidirectional controls as they are. They can only occur inside strings, so they are written as \\u escapes: the
 * document parses to the same value, and printing it to a terminal or opening it in an editor cannot be steered by a
 * test name (U+009B is an eight bit CSI; U+202E reverses what a reviewer reads).
 */
const RAW = /[\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g;

export function jsonText(value: unknown, indent?: number): string {
  return JSON.stringify(value, null, indent).replace(RAW, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

export function renderJson(report: Report): string {
  return jsonText(report, 2) + '\n';
}
