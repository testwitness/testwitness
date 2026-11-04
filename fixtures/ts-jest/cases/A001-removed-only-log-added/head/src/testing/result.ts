import { install } from '../installer';

export class TestResult {
  constructor(readonly filesCreated: string[], readonly code: number) {}

  didCreate(path: string): void {
    if (!this.filesCreated.includes(path)) throw new Error(`${path} not created: ${this.filesCreated.join(', ')}`);
  }
}

export function runInstall(name: string): TestResult {
  const raw = install(name);
  return new TestResult(raw.filesCreated, raw.code);
}
