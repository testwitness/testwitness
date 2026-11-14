// The classifier behind "check --pr runs no hook and no filter": the trace lines of both git generations it must
// accept, and the lines it must never accept.
import { describe, expect, it } from 'vitest';
import { foreignGitCommands, parseTraceCommand, splitQuoted, type GitInstall } from './git-trace.js';

const install: GitInstall = { execPaths: ['/usr/lib/git-core'], gitPrograms: ['/usr/lib/git-core/git', '/usr/bin/git'] };
const R = '/tmp/tw-remote-x/widgets.git';
const t = (s: string): string => `10:03:29.274040 run-command.c:659       trace: ${s}`;
const foreign = (...lines: string[]): string[] => foreignGitCommands(lines.map(t), [R], install);

describe('splitQuoted', () => {
  it('reads sq_quote_argv_pretty output', () => {
    expect(splitQuoted(`/bin/sh -c 'git-upload-pack '\\''/a b'\\''' x`)).toEqual(['/bin/sh', '-c', "git-upload-pack '/a b'", 'x']);
    expect(splitQuoted(`a 'it'\\!'s' ''`)).toEqual(['a', "it!s", '']);
  });
  it('parses the environment in front of a run_command line', () => {
    expect(parseTraceCommand(t(`run_command: unset GIT_CONFIG_COUNT GIT_DIR; GIT_PROTOCOL=version=2 'git-upload-pack '\\''${R}'\\'''`))).toEqual({
      kind: 'run_command',
      env: { GIT_PROTOCOL: 'version=2' },
      argv: [`git-upload-pack '${R}'`],
    });
  });
});

describe('foreignGitCommands', () => {
  it("accepts git's transport helpers in the Git 2.43 format (run_command only)", () => {
    expect(
      foreign(
        `run_command: unset GIT_CONFIG_COUNT GIT_DIR; GIT_PROTOCOL=version=2 'git-upload-pack '\\''${R}'\\'''`,
        `run_command: git index-pack --stdin --fix-thin '--keep=fetch-pack 2118 on vm' --check-self-contained-and-connected`,
        'run_command: git pack-objects --revs --thin --stdout --delta-base-offset',
        'run_command: git rev-list --objects --stdin --not --all --quiet --alternate-refs',
      ),
    ).toEqual([]);
  });

  it('accepts the start_command lines of the runners (Git 2.56)', () => {
    expect(
      foreign(
        `start_command: /bin/sh -c 'git-upload-pack '\\''${R}'\\''' 'git-upload-pack '\\''${R}'\\'''`,
        'start_command: /usr/lib/git-core/git pack-objects --revs --stdout --thin --delta-base-offset',
        `start_command: /usr/lib/git-core/git index-pack --stdin --fix-thin '--keep=fetch-pack 4021 on runner' --check-self-contained-and-connected`,
        'start_command: /usr/bin/git rev-list --objects --stdin --not --all --quiet --alternate-refs',
        `exec: /usr/lib/git-core/git-upload-pack '${R}'`,
      ),
    ).toEqual([]);
  });

  it.each([
    ['a hook', `run_command: cd /tmp/c; /tmp/c/.git/hooks/reference-transaction prepared`],
    ['a hook, as executed', 'start_command: /tmp/c/.git/hooks/post-checkout 0000 1111 1'],
    ['a hook from core.hooksPath', 'start_command: /tmp/traps/hooks/post-checkout 0000 1111 1'],
    ['a filter driver', "run_command: '/tmp/traps/trap smudge'"],
    ['a filter driver, as executed', "start_command: /bin/sh -c '/tmp/traps/trap smudge' '/tmp/traps/trap smudge'"],
    ['a textconv driver', "start_command: /bin/sh -c '/tmp/traps/trap textconv \"$@\"' '/tmp/traps/trap textconv' /tmp/x"],
    ['core.fsmonitor', "start_command: /bin/sh -c '/tmp/traps/trap fsmonitor \"$@\"' '/tmp/traps/trap fsmonitor' 2 0"],
    ['core.sshCommand', "start_command: /bin/sh -c '/tmp/traps/trap ssh \"$@\"' '/tmp/traps/trap ssh' git@github.com \"git-upload-pack 'acme/widgets.git'\""],
    ['an alias', 'alias expansion: co => checkout'],
    ['a git subcommand that is not transport', 'start_command: /usr/lib/git-core/git checkout -f'],
    ['a git program outside the exec path', 'start_command: /tmp/evil/git pack-objects --stdout'],
    ['a dashed program outside the exec path', 'start_command: /tmp/evil/git-upload-pack /x'],
    ['upload-pack on another repository', "start_command: /bin/sh -c 'git-upload-pack '\\''/elsewhere.git'\\''' 'git-upload-pack '\\''/elsewhere.git'\\'''"],
    ['upload-pack with a command appended', `start_command: /bin/sh -c 'git-upload-pack '\\''${R}'\\''; touch /tmp/x' 'git-upload-pack '\\''${R}'\\''; touch /tmp/x'`],
    ['an extra environment variable', `run_command: GIT_SSH_COMMAND=/tmp/traps/trap 'git-upload-pack '\\''${R}'\\'''`],
  ])('rejects %s', (_label, line) => {
    expect(foreign(line)).toHaveLength(1);
  });
});
