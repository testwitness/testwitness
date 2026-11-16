// The run ledger: what an agent session can actually claim about its tests, counted from the session's own record of
// commands, exit codes and edits. No model: every line is a count or a pattern over the transcript.
//
// Reads a Claude Code transcript (the JSONL file a Stop hook names in transcript_path, or `claude -p --output-format
// stream-json`) or a Codex event stream (`codex exec --json`). Never runs anything and never reads the network.

export interface CommandEvent {
  kind: "command";
  seq: number;
  command: string;
  /** Exit status as the agent saw it; undefined when the transcript does not say. */
  exit?: number | undefined;
  output: string;
}
export interface EditEvent {
  kind: "edit";
  seq: number;
  path: string;
}
export interface MessageEvent {
  kind: "message";
  seq: number;
  text: string;
}
export type SessionEvent = CommandEvent | EditEvent | MessageEvent;

export interface TestRun {
  seq: number;
  command: string;
  runner: string;
  /** Selected only some tests: file or directory arguments, -k, -t, --testNamePattern, -Dtest=, --tests, node ids. */
  narrowed: boolean;
  /** The exit status the agent saw belongs to another command: piped into tail, head, grep, tee and the like, or masked with `|| true` or `; echo`. */
  masked: boolean;
  passed?: number | undefined;
  failed?: number | undefined;
  /** The runner said it collected nothing. */
  zeroTests: boolean;
  /** pass, fail or unknown, from the runner's own summary first and the exit status second (unless masked). */
  outcome: "pass" | "fail" | "unknown";
}

export interface Ledger {
  runs: TestRun[];
  /** The last run that was not narrowed, if any. */
  lastFull?: TestRun | undefined;
  /** Files edited after the last full run (or after the last run of any kind when there is no full run). */
  editedAfterLast: string[];
  finalMessage?: string | undefined;
  claimsPass: boolean;
  /** Why a claim that the tests pass is not supported; empty when it is supported or no claim was made. */
  unsupported: string[];
}

const RUNNERS: Array<[name: string, re: RegExp]> = [
  ["pytest", /(^|[\s;&|(/])(python3?\s+-m\s+)?pytest(\s|$)/],
  ["tox", /(^|[\s;&|(])(tox|nox)(\s|$)/],
  ["unittest", /python3?\s+-m\s+unittest/],
  ["vitest", /(^|[\s;&|(/])vitest(\s|$)/],
  ["jest", /(^|[\s;&|(/])jest(\s|$)/],
  ["mocha", /(^|[\s;&|(/])mocha(\s|$)/],
  ["ava", /(^|[\s;&|(/])ava(\s|$)/],
  ["node --test", /(^|[\s;&|(])node\s+(--\S+\s+)*--test(\s|$)/],
  ["npm test", /(^|[\s;&|(])(npm|pnpm|yarn|bun)\s+(run\s+)?test(\S*)?(\s|$)/],
  ["maven", /(^|[\s;&|(/])(mvn|mvnw)\s+.*\b(test|verify|install)\b/],
  ["gradle", /(^|[\s;&|(/])(gradle|gradlew)\s+.*\b(test|check|build)\b/],
  ["go test", /(^|[\s;&|(])go\s+test(\s|$)/],
  ["cargo test", /(^|[\s;&|(])cargo\s+(test|nextest)(\s|$)/],
  ["make test", /(^|[\s;&|(])make\s+(\S+\s+)*(test|check)(\s|$)/],
];

const NOT_A_RUN = new Set([
  "cat",
  "less",
  "more",
  "head",
  "tail",
  "grep",
  "rg",
  "sed",
  "awk",
  "ls",
  "echo",
  "printf",
  "git",
  "find",
  "which",
  "man",
  "vim",
  "nano",
  "code",
]);

/** The test runner a shell command invokes, if any. A command that only mentions a runner (grep pytest, cat jest.config.js) is not a run. */
export function testRunner(command: string): string | undefined {
  const segments = command.replace(/\\\n/g, " ").split(/&&|\|\||;|\n/);
  for (const seg of segments) {
    const words = seg
      .trim()
      .replace(/^(\w+=\S*\s+)*/, "")
      .split(/\s+/);
    if (NOT_A_RUN.has(words[0] ?? "")) continue;
    // Installing a runner is not running it.
    if (
      /^(pip3?|uv|pipx|npm|pnpm|yarn|bun|brew|apt(-get)?|poetry)$/.test(
        words[0] ?? "",
      ) &&
      /^(install|add|i|sync)$/.test(words[1] ?? "")
    )
      continue;
    if (
      (words[0] === "python" || words[0] === "python3") &&
      words[1] === "-m" &&
      words[2] === "pip"
    )
      continue;
    const head = (seg.split(/\|(?!\|)/)[0] ?? "").replace(/["'`]/g, " ");
    for (const [name, re] of RUNNERS) if (re.test(` ${head} `)) return name;
  }
  return undefined;
}

/** True when the run selected only part of the suite. A bare test directory (pytest tests) counts as full. */
export function isNarrowed(command: string, runner: string): boolean {
  const c = ` ${command} `;
  if (
    /\s(-k|-t|--testNamePattern|--grep|-g|--filter|--tests|-run)\s|\s-Dtest=|\s--testPathPattern|\s--match\s|::/.test(
      c,
    )
  )
    return true;
  if (runner === "go test")
    return /\s\.\/\S+\/\S+/.test(c) && !/\.\/\.\.\./.test(c);
  // Path arguments that name test files or a subfolder of the tests.
  const args = command.split(/\s+/).filter((a) => !a.startsWith("-"));
  return args.some(
    (a) =>
      /\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_\w+\.py$|_test\.py$|Test\.java$/.test(
        a,
      ) || /^(tests?|__tests__)\/\S+/.test(a),
  );
}

/** True when the exit status the agent saw is not the runner's. */
export function isMasked(command: string): boolean {
  if (/set\s+-o\s+pipefail/.test(command))
    return /\|\|\s*(true|:|exit 0)\b/.test(command);
  return (
    /\|(?!\|)\s*(tail|head|grep|rg|tee|less|more|cat|sed|awk|cut|sort|wc)\b/.test(
      command,
    ) ||
    /\|\|\s*(true|:|echo\b|exit 0)/.test(command) ||
    /;\s*(echo|true|exit 0)\b/.test(command)
  );
}

/** Counts from the runner's own summary line, when the output carries one. */
export function summary(output: string): {
  passed?: number | undefined;
  failed?: number | undefined;
  zero: boolean;
} {
  // eslint-disable-next-line no-control-regex -- strips terminal colour codes from runner output
  const o = output.replace(/\x1b\[[0-9;]*m/g, "");
  const num = (re: RegExp): number | undefined => {
    const m = o.match(re);
    return m ? Number(m[1]) : undefined;
  };
  let passed: number | undefined, failed: number | undefined;
  // pytest: "3 failed, 120 passed in 2.1s", "no tests ran"
  const py = o.match(/=+ (.*?) in [\d.]+s/g);
  if (py) {
    const last = py[py.length - 1] ?? "";
    passed = Number(last.match(/(\d+) passed/)?.[1] ?? 0);
    failed =
      Number(last.match(/(\d+) failed/)?.[1] ?? 0) +
      Number(last.match(/(\d+) errors?/)?.[1] ?? 0);
  }
  // vitest: "Tests  2 failed | 40 passed (42)"; jest: "Tests:       1 failed, 41 passed, 42 total"
  const vt = o.match(/Tests:?\s+((?:\d+ \w+(?: \| |, )?)+)/g);
  if (vt) {
    const last = vt[vt.length - 1] ?? "";
    passed = Number(last.match(/(\d+) passed/)?.[1] ?? 0);
    failed = Number(last.match(/(\d+) failed/)?.[1] ?? 0);
  }
  // maven surefire: "Tests run: 12, Failures: 1, Errors: 0, Skipped: 0" (the last one is the total)
  const mv = o.match(/Tests run: (\d+), Failures: (\d+), Errors: (\d+)/g);
  if (mv) {
    const m = (mv[mv.length - 1] ?? "").match(
      /Tests run: (\d+), Failures: (\d+), Errors: (\d+)/,
    );
    if (m) {
      failed = Number(m[2]) + Number(m[3]);
      passed = Number(m[1]) - failed;
    }
  }
  // node --test and ava
  passed ??= num(/^# pass (\d+)/m) ?? num(/(\d+) tests? passed/);
  failed ??= num(/^# fail (\d+)/m) ?? num(/(\d+) tests? failed/);
  const zero =
    /no tests ran|collected 0 items|No test files found|No tests found|Ran 0 tests|0 passing|# tests 0\b|Tests run: 0,/.test(
      o,
    );
  return { passed, failed, zero };
}

export function testRun(e: CommandEvent): TestRun | undefined {
  const runner = testRunner(e.command);
  if (!runner) return undefined;
  const s = summary(e.output);
  const narrowed = isNarrowed(e.command, runner);
  const masked = isMasked(e.command);
  let outcome: TestRun["outcome"] = "unknown";
  if (s.zero) outcome = "fail";
  else if (s.failed !== undefined && s.failed > 0) outcome = "fail";
  else if (s.passed !== undefined && s.passed > 0 && (s.failed ?? 0) === 0)
    outcome = e.exit !== undefined && e.exit !== 0 && !masked ? "fail" : "pass";
  else if (e.exit !== undefined && !masked)
    outcome = e.exit === 0 ? "pass" : "fail";
  return {
    seq: e.seq,
    command: e.command,
    runner,
    narrowed,
    masked,
    passed: s.passed,
    failed: s.failed,
    zeroTests: s.zero,
    outcome,
  };
}

/** Does the message say the tests pass? Negations ("not all tests pass", "tests still fail") do not count. */
export function claimsTestsPass(text: string | undefined): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  if (/\b(not|n't|never|no longer)\b[^.]{0,30}\b(pass|green)/.test(t))
    return false;
  return (
    /\b(all|the|every|full|whole)?\s*(\d+\s+)?(unit\s+)?(tests?|test suite|suite|specs?|checks?)\b[^.\n]{0,40}\b(pass(es|ed|ing)?|green|succeed(s|ed)?)\b/.test(
      t,
    ) ||
    /\b(tests?|suite) (are|is) (all )?(passing|green)\b/.test(t) ||
    /\ball green\b/.test(t)
  );
}

export function buildLedger(events: SessionEvent[]): Ledger {
  const runs = events
    .filter((e): e is CommandEvent => e.kind === "command")
    .map(testRun)
    .filter((r): r is TestRun => !!r);
  const lastFull = [...runs].reverse().find((r) => !r.narrowed);
  const last = runs[runs.length - 1];
  const ref = lastFull ?? last;
  const editedAfterLast = [
    ...new Set(
      events
        .filter(
          (e): e is EditEvent => e.kind === "edit" && (!ref || e.seq > ref.seq),
        )
        .map((e) => e.path),
    ),
  ];
  const finalMessage = [...events]
    .reverse()
    .find((e): e is MessageEvent => e.kind === "message")?.text;
  const claimsPass = claimsTestsPass(finalMessage);
  const unsupported: string[] = [];
  if (claimsPass) {
    if (runs.length === 0)
      unsupported.push("no test command ran in this session");
    else if (!lastFull)
      unsupported.push(
        `every test run was narrowed to part of the suite (last: ${last?.command})`,
      );
    else {
      if (lastFull.outcome === "fail")
        unsupported.push(
          lastFull.zeroTests
            ? `the last full run collected no tests (${lastFull.command})`
            : `the last full run failed (${lastFull.command}${lastFull.failed ? `, ${lastFull.failed} failed` : ""})`,
        );
      if (lastFull.outcome === "unknown")
        unsupported.push(
          `the last full run's result is unknown${lastFull.masked ? ": its exit status was hidden by a pipe or ||" : ""} (${lastFull.command})`,
        );
      if (
        lastFull.outcome === "pass" &&
        lastFull.masked &&
        lastFull.passed === undefined
      )
        unsupported.push(
          `the last full run's exit status was hidden by a pipe or || (${lastFull.command})`,
        );
      if (editedAfterLast.length > 0)
        unsupported.push(
          `${editedAfterLast.length} file${editedAfterLast.length === 1 ? "" : "s"} changed after the last full run: ${editedAfterLast.slice(0, 5).join(", ")}${editedAfterLast.length > 5 ? ", ..." : ""}`,
        );
    }
  }
  return {
    runs,
    lastFull,
    editedAfterLast,
    finalMessage,
    claimsPass,
    unsupported,
  };
}

/** A short plain text account of what the session can claim. */
export function renderLedger(l: Ledger): string {
  const out: string[] = ["Test run ledger for this session:"];
  if (l.runs.length === 0) out.push("- No test command ran.");
  else {
    const f = l.lastFull;
    out.push(
      `- Test runs: ${l.runs.length} (${l.runs.filter((r) => r.narrowed).length} narrowed to part of the suite).`,
    );
    if (f) {
      const counts =
        f.passed !== undefined || f.failed !== undefined
          ? `, ${f.passed ?? 0} passed, ${f.failed ?? 0} failed`
          : "";
      out.push(
        `- Last full run: \`${f.command}\`: ${f.zeroTests ? "collected no tests" : f.outcome}${counts}${f.masked ? " (exit status hidden by a pipe or ||)" : ""}.`,
      );
    } else
      out.push("- No full run: every run selected only part of the suite.");
    out.push(
      l.editedAfterLast.length
        ? `- Changed after it: ${l.editedAfterLast.join(", ")}.`
        : "- Nothing changed after it.",
    );
  }
  if (l.claimsPass)
    out.push(
      l.unsupported.length
        ? `- The final message says the tests pass, which this session does not show: ${l.unsupported.join("; ")}.`
        : "- The final message says the tests pass, and the last full run supports it.",
    );
  return out.join("\n");
}

// ---- transcript readers ----

function contentText(c: unknown): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c))
    return c
      .map((x) =>
        typeof x === "object" && x && "text" in x
          ? String((x as { text: unknown }).text)
          : "",
      )
      .join("\n");
  return "";
}

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

/** Claude Code transcript JSONL or `--output-format stream-json`. */
export function readClaude(text: string): SessionEvent[] {
  const events: SessionEvent[] = [];
  const pending = new Map<string, { command: string; seq: number }>();
  let seq = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let d: Record<string, unknown>;
    try {
      d = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const msg = d.message as { role?: string; content?: unknown } | undefined;
    if (d.type === "assistant" && msg && Array.isArray(msg.content)) {
      const texts: string[] = [];
      for (const c of msg.content as Array<Record<string, unknown>>) {
        if (c.type === "text" && typeof c.text === "string") texts.push(c.text);
        if (c.type === "tool_use") {
          const input = (c.input ?? {}) as Record<string, unknown>;
          if (c.name === "Bash" && typeof input.command === "string")
            pending.set(String(c.id), { command: input.command, seq: ++seq });
          if (EDIT_TOOLS.has(String(c.name))) {
            const p = input.file_path ?? input.notebook_path;
            if (typeof p === "string")
              events.push({ kind: "edit", seq: ++seq, path: p });
          }
        }
      }
      if (texts.length)
        events.push({ kind: "message", seq: ++seq, text: texts.join("\n") });
    }
    if (d.type === "user" && msg && Array.isArray(msg.content)) {
      for (const c of msg.content as Array<Record<string, unknown>>) {
        if (c.type !== "tool_result") continue;
        const p = pending.get(String(c.tool_use_id));
        if (!p) continue;
        pending.delete(String(c.tool_use_id));
        const body = contentText(c.content);
        const tur = d.toolUseResult as
          { stdout?: string; stderr?: string } | undefined;
        const output =
          tur &&
          typeof tur === "object" &&
          (tur.stdout !== undefined || tur.stderr !== undefined)
            ? `${tur.stdout ?? ""}\n${tur.stderr ?? ""}`
            : body;
        const m = body.match(/^(?:Error: )?Exit code (\d+)/);
        const exit = m ? Number(m[1]) : c.is_error === true ? 1 : 0;
        events.push({
          kind: "command",
          seq: p.seq,
          command: p.command,
          exit,
          output: `${output}\n${body}`,
        });
      }
    }
    if (d.type === "result" && typeof d.result === "string")
      events.push({ kind: "message", seq: ++seq, text: d.result });
  }
  return events.sort((a, b) => a.seq - b.seq);
}

/** Codex `exec --json` event stream (item.completed events). */
export function readCodex(text: string): SessionEvent[] {
  const events: SessionEvent[] = [];
  let seq = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let d: Record<string, unknown>;
    try {
      d = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (d.type !== "item.completed") continue;
    const item = (d.item ?? {}) as Record<string, unknown>;
    const type = item.type ?? item.item_type;
    if (type === "command_execution" && typeof item.command === "string")
      events.push({
        kind: "command",
        seq: ++seq,
        command: item.command,
        exit: typeof item.exit_code === "number" ? item.exit_code : undefined,
        output: String(item.aggregated_output ?? ""),
      });
    if (type === "file_change" && Array.isArray(item.changes))
      for (const ch of item.changes as Array<{ path?: unknown }>)
        if (typeof ch.path === "string")
          events.push({ kind: "edit", seq: ++seq, path: ch.path });
    if (
      (type === "agent_message" || type === "assistant_message") &&
      typeof item.text === "string"
    )
      events.push({ kind: "message", seq: ++seq, text: item.text });
  }
  return events;
}

/** Picks the reader from the first lines. */
export function readTranscript(text: string): SessionEvent[] {
  const head = text.slice(0, 20000);
  if (/"type":\s*"(thread\.started|turn\.started|item\.completed)"/.test(head))
    return readCodex(text);
  return readClaude(text);
}
