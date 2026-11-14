import { constants, lstatSync, unlinkSync } from 'node:fs';
import { open } from 'node:fs/promises';

/**
 * Write an output file without following a symbolic link at the destination. The report, the history and the hook
 * state are written into a checkout that a pull request controls: a committed link named `testwitness.json` that
 * points at a file elsewhere on the runner would otherwise be written through. A link at the destination is removed
 * and a regular file is created in its place; O_NOFOLLOW closes the window between the check and the open where the
 * platform has it (not on Windows, where creating a link needs a privilege a checkout does not have by default).
 * Only the last path segment is guarded: the directory is the one the caller chose.
 */
export async function writeFileNoFollow(path: string, data: string): Promise<void> {
  try {
    if (lstatSync(path).isSymbolicLink()) unlinkSync(path);
  } catch {
    /* nothing there yet */
  }
  const fh = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0), 0o644);
  try {
    await fh.writeFile(data);
  } finally {
    await fh.close();
  }
}
