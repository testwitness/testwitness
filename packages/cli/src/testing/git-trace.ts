// Test helper: reads the lines git writes to GIT_TRACE about programs it starts, and tells git's own transport helpers
// apart from everything else (hooks, fsmonitor, filter and textconv drivers, core.sshCommand, aliases, any command
// taken from a repository's config).
//
// Two line formats matter, both written by run-command.c:
//
//   trace: run_command: unset GIT_CONFIG_COUNT GIT_DIR; GIT_PROTOCOL=version=2 'git-upload-pack '\''/r/widgets.git'\'''
//   trace: run_command: git pack-objects --revs --thin --stdout --delta-base-offset
//       Every git version: the command as git asked for it, with the environment changes in front.
//
//   trace: start_command: /bin/sh -c 'git-upload-pack '\''/r/widgets.git'\''' 'git-upload-pack '\''/r/widgets.git'\'''
//   trace: start_command: /usr/lib/git-core/git pack-objects --revs --stdout --thin --delta-base-offset
//       Newer git also logs the command as it is about to be executed: a shell command wrapped in "sh -c", and the
//       program resolved on PATH, where git puts its exec path first. Git 2.43 (Ubuntu 24.04's own package) does not
//       write these lines; the GitHub runners do (Git 2.56.1 on ubuntu-latest, image 20261111; Git 2.56.0 on
//       macos-latest, macOS 26, image 20261102), which is why this classifier exists.
//
// Arguments are quoted the way sq_quote_argv_pretty does it: plain words as they are, anything else in single quotes,
// a single quote inside written as '\'' and an exclamation mark as '\!'.
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/** git's own helpers for the fetch and clone transport. Anything else is a failure. */
export const GIT_TRANSPORT_HELPERS: readonly string[] = ['upload-pack', 'pack-objects', 'index-pack', 'unpack-objects', 'rev-list', 'fetch-pack'];

export interface TraceCommand {
  kind: 'run_command' | 'start_command' | 'exec' | 'alias expansion';
  /** `cd <dir>;` in front of a run_command line (hooks run this way), when present. */
  cd?: string;
  /** Environment variables set for the child (run_command lines). */
  env: Record<string, string>;
  argv: string[];
}

/** Splits sq_quote_argv_pretty output back into words. */
export function splitQuoted(text: string): string[] {
  const words: string[] = [];
  let cur = '';
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "'") {
      const end = text.indexOf("'", i + 1);
      if (end < 0) throw new Error(`unbalanced quote in trace line: ${text}`);
      cur += text.slice(i + 1, end);
      i = end;
      inWord = true;
    } else if (c === '\\' && i + 1 < text.length) {
      cur += text[++i];
      inWord = true;
    } else if (c === ' ') {
      if (inWord) words.push(cur);
      cur = '';
      inWord = false;
    } else {
      cur += c;
      inWord = true;
    }
  }
  if (inWord) words.push(cur);
  return words;
}

export function parseTraceCommand(line: string): TraceCommand | undefined {
  const m = /trace: (run_command|start_command|exec|alias expansion): ?(.*)$/.exec(line);
  if (!m) return undefined;
  const kind = m[1] as TraceCommand['kind'];
  const words = splitQuoted(m[2]!);
  const out: TraceCommand = { kind, env: {}, argv: [] };
  let i = 0;
  if (kind === 'run_command') {
    if (words[i] === 'cd' && words[i + 1]?.endsWith(';')) {
      out.cd = words[i + 1]!.slice(0, -1);
      i += 2;
    }
    if (words[i] === 'unset') {
      while (i < words.length && !words[i]!.endsWith(';')) i++;
      i++;
    }
    for (let a: RegExpExecArray | null; i < words.length && (a = /^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/.exec(words[i]!)); i++) out.env[a[1]!] = a[2]!;
  }
  out.argv = words.slice(i);
  return out;
}

export interface GitInstall {
  /** `git --exec-path`, and its real path. */
  execPaths: string[];
  /** Paths the git program itself can show up under: git's exec path, the git found on PATH, their real paths. */
  gitPrograms: string[];
}

export function gitInstall(): GitInstall {
  const real = (p: string): string => {
    try {
      return realpathSync(p);
    } catch {
      return p;
    }
  };
  const execPath = execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim();
  const execPaths = [...new Set([execPath, real(execPath)])];
  const onPath = (process.env['PATH'] ?? '')
    .split(process.platform === 'win32' ? ';' : ':')
    .filter(Boolean)
    .map((d) => join(d, 'git'));
  const gitPrograms = [...new Set([...execPaths.map((d) => join(d, 'git')), ...onPath].flatMap((p) => [p, real(p)]))];
  return { execPaths, gitPrograms };
}

/**
 * Why a traced command is not one of git's own transport helpers, or undefined when it is. `uploadPackPaths` are the
 * repository paths upload-pack may be started on (the local stand in for GitHub).
 */
export function notGitTransport(cmd: TraceCommand, install: GitInstall, uploadPackPaths: readonly string[]): string | undefined {
  if (cmd.kind === 'alias expansion') return 'an alias from git config';
  if (cmd.cd !== undefined) return `a command run in ${cmd.cd} (hooks run this way)`;
  const extraEnv = Object.keys(cmd.env).filter((k) => k !== 'GIT_PROTOCOL');
  if (extraEnv.length) return `a command with ${extraEnv.join(', ')} set`;
  const [prog, ...args] = cmd.argv;
  if (prog === undefined) return 'an empty command';
  const isUploadPack = (s: string): boolean => uploadPackPaths.some((p) => s === `git-upload-pack '${p}'`);

  // git asked for one of its own subcommands: "git pack-objects ..." or "/usr/lib/git-core/git pack-objects ...".
  if (prog === 'git' || install.gitPrograms.includes(prog)) {
    return GIT_TRANSPORT_HELPERS.includes(args[0] ?? '') ? undefined : `git ${args[0] ?? ''}, not a transport helper`;
  }
  // A dashed program from git's exec path: "git-upload-pack" or "/usr/lib/git-core/git-index-pack".
  const dashed = /^git-(.+)$/.exec(basename(prog));
  if (dashed && (prog === basename(prog) || install.execPaths.includes(dirname(prog)))) {
    return GIT_TRANSPORT_HELPERS.includes(dashed[1]!) ? undefined : `${prog}, not a transport helper`;
  }
  // The local transport's upload-pack, as a shell command: one word on the run_command line, "sh -c" on start_command.
  if (args.length === 0 && isUploadPack(prog)) return undefined;
  if (basename(prog) === 'sh' && args[0] === '-c' && args.length === 3 && isUploadPack(args[1]!) && args[2] === args[1]) return undefined;
  return `${prog} is not one of git's transport helpers`;
}

/** The traced lines that are not git's own transport helpers, each with the reason. */
export function foreignGitCommands(lines: readonly string[], uploadPackPaths: readonly string[], install: GitInstall = gitInstall()): string[] {
  return lines.flatMap((line) => {
    const cmd = parseTraceCommand(line);
    if (!cmd) return [];
    const why = notGitTransport(cmd, install, uploadPackPaths);
    return why ? [`${why}: ${line.replace(/^.*?trace: /, 'trace: ')}`] : [];
  });
}
