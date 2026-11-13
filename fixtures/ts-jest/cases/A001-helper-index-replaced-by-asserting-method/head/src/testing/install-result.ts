import { install } from '../installer';

export class InstallResult {
  constructor(readonly filesCreated: string[], readonly code: number) {}

  hasCreated(path: string): void {
    expect(this.filesCreated).toContain(path);
  }
}

export function runInstall(name: string): InstallResult {
  const raw = install(name);
  return new InstallResult(raw.filesCreated, raw.code);
}
