import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { toLf } from './eol.js';
import { showFile, type GitOptions } from './git.js';

/**
 * Reads many blobs through one long lived `git cat-file --batch` process instead of one `git show` per file.
 * On a 5,000 file PR the per file spawns were about 45 percent of the run, and process start up is slower still on
 * Windows. Requests are answered in order, so they are queued and matched first in, first out.
 *
 * Paths come from git's own diff and tree output, but a name with a newline cannot be written to the batch protocol;
 * those, and any reader failure, fall back to `git show` for that file.
 */
export class BlobReader {
  private proc: ChildProcessWithoutNullStreams | undefined;
  private queue: Array<{
    resolve: (v: string | undefined) => void;
    reject: (e: Error) => void;
  }> = [];
  private buf: Buffer = Buffer.alloc(0);
  private failed: Error | undefined;

  constructor(private readonly opts: GitOptions) {}

  private start(): ChildProcessWithoutNullStreams {
    if (this.proc) return this.proc;
    const proc = spawn('git', ['cat-file', '--batch'], {
      cwd: this.opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(this.opts.env ? { env: this.opts.env } : {}),
    });
    proc.stdout.on('data', (chunk: Buffer) => {
      this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
      this.drain();
    });
    const fail = (e: Error): void => {
      this.failed = e;
      for (const q of this.queue.splice(0)) q.reject(e);
    };
    proc.on('error', fail);
    proc.on('close', (code) => {
      if (this.queue.length)
        fail(
          new Error(`git cat-file --batch exited with ${code ?? 'a signal'}`),
        );
      this.proc = undefined;
    });
    proc.stdin.on('error', fail);
    this.proc = proc;
    return proc;
  }

  /** Parse as many complete answers as the buffer holds. */
  private drain(): void {
    for (;;) {
      const nl = this.buf.indexOf(0x0a);
      if (nl < 0 || !this.queue.length) return;
      const header = this.buf.subarray(0, nl).toString('utf8');
      if (header.endsWith(' missing') || header.endsWith(' ambiguous')) {
        this.buf = this.buf.subarray(nl + 1);
        this.queue.shift()!.resolve(undefined);
        continue;
      }
      // <sha> <type> <size>
      const parts = header.split(' ');
      const size = Number(parts[2]);
      if (parts.length !== 3 || !Number.isFinite(size)) {
        const e = new Error(
          `unexpected git cat-file header: ${header.slice(0, 120)}`,
        );
        this.failed = e;
        for (const q of this.queue.splice(0)) q.reject(e);
        this.proc?.kill();
        return;
      }
      if (this.buf.length < nl + 1 + size + 1) return;
      const body = this.buf.subarray(nl + 1, nl + 1 + size);
      this.buf = this.buf.subarray(nl + 1 + size + 1);
      const q = this.queue.shift()!;
      // A path that names a tree (a directory) is not a file.
      q.resolve(parts[1] === 'blob' ? toLf(body.toString('utf8')) : undefined);
    }
  }

  /** Same contract as showFile: LF text, or undefined when the path does not exist at the ref. */
  async read(ref: string, path: string): Promise<string | undefined> {
    if (this.failed || /[\n\r]/.test(path) || /[\n\r]/.test(ref))
      return showFile(ref, path, this.opts);
    try {
      const proc = this.start();
      const answer = new Promise<string | undefined>((resolve, reject) =>
        this.queue.push({ resolve, reject }),
      );
      proc.stdin.write(`${ref}:${path}\n`);
      return await answer;
    } catch {
      return showFile(ref, path, this.opts);
    }
  }

  close(): void {
    const p = this.proc;
    this.proc = undefined;
    if (p) p.stdin.end();
  }
}
