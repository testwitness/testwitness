// @ts-nocheck
import type { LanguageFrontEnd } from '@testwitness/core';
import { javaFrontEnd } from '@testwitness/lang-java';
import { tsFrontEnd, jsFrontEnd } from '@testwitness/lang-ts';
import { pythonFrontEnd } from '@testwitness/lang-python';

export function allFrontEnds(): LanguageFrontEnd[] {
  return [javaFrontEnd, tsFrontEnd, jsFrontEnd, pythonFrontEnd];
}
