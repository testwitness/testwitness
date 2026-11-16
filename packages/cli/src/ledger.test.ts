import { describe, expect, it } from "vitest";
import {
  buildLedger,
  claimsTestsPass,
  isMasked,
  isNarrowed,
  readClaude,
  readCodex,
  readTranscript,
  renderLedger,
  summary,
  testRunner,
  type SessionEvent,
} from "./ledger.js";

const cmd = (
  seq: number,
  command: string,
  output: string,
  exit?: number,
): SessionEvent => ({ kind: "command", seq, command, output, exit });
const edit = (seq: number, path: string): SessionEvent => ({
  kind: "edit",
  seq,
  path,
});
const say = (seq: number, text: string): SessionEvent => ({
  kind: "message",
  seq,
  text,
});

describe("testRunner", () => {
  it.each([
    ["pytest", "pytest"],
    ["python -m pytest -q tests", "pytest"],
    ["cd lib && npx vitest run", "vitest"],
    ["pnpm test", "npm test"],
    ["npm run test:unit", "npm test"],
    ["mvn -q test", "maven"],
    ["./gradlew test", "gradle"],
    ["go test ./...", "go test"],
    ["CI=1 npx jest --ci", "jest"],
    ["timeout 300 pytest -x", "pytest"],
  ])("%s is a %s run", (c, r) => expect(testRunner(c)).toBe(r));
  it.each([
    "grep -r pytest .",
    "cat jest.config.js",
    "git log --grep vitest",
    "ls tests",
    "pip install pytest",
    "echo run pytest",
  ])("%s is not a run", (c) => {
    expect(testRunner(c)).toBeUndefined();
  });
});

describe("narrowed and masked", () => {
  it("a test file, -k, -t or a node id narrows the run", () => {
    expect(isNarrowed("pytest tests/test_dates.py", "pytest")).toBe(true);
    expect(isNarrowed("pytest -k parse", "pytest")).toBe(true);
    expect(isNarrowed("pytest tests/test_x.py::test_y", "pytest")).toBe(true);
    expect(isNarrowed("npx vitest run src/slugify.test.ts", "vitest")).toBe(
      true,
    );
    expect(isNarrowed('npx jest -t "parses dates"', "jest")).toBe(true);
    expect(isNarrowed("mvn test -Dtest=StringUtilsTest", "maven")).toBe(true);
  });
  it("the whole suite or the tests folder is a full run", () => {
    expect(isNarrowed("pytest", "pytest")).toBe(false);
    expect(isNarrowed("pytest -q tests", "pytest")).toBe(false);
    expect(isNarrowed("npx vitest run", "vitest")).toBe(false);
    expect(isNarrowed("go test ./...", "go test")).toBe(false);
  });
  it("a pipe into tail, || true or ; echo hides the exit status, unless pipefail is set", () => {
    expect(isMasked("pytest 2>&1 | tail -20")).toBe(true);
    expect(isMasked("npm test || true")).toBe(true);
    expect(isMasked("npx vitest run; echo done")).toBe(true);
    expect(isMasked("set -o pipefail; pytest | tail -5")).toBe(false);
    expect(isMasked("pytest -q")).toBe(false);
    expect(isMasked("pytest && echo ok")).toBe(false);
  });
});

describe("summary", () => {
  it("reads pytest, vitest, jest and surefire summaries", () => {
    expect(summary("==== 2 failed, 120 passed in 3.2s ====")).toMatchObject({
      passed: 120,
      failed: 2,
      zero: false,
    });
    expect(summary(" Tests  1 failed | 40 passed (41)")).toMatchObject({
      passed: 40,
      failed: 1,
    });
    expect(summary("Tests:       41 passed, 41 total")).toMatchObject({
      passed: 41,
      failed: 0,
    });
    expect(
      summary(
        "Tests run: 3, Failures: 0, Errors: 0\nTests run: 12, Failures: 1, Errors: 1, Skipped: 0",
      ),
    ).toMatchObject({ passed: 10, failed: 2 });
  });
  it("knows when nothing was collected", () => {
    expect(summary("==== no tests ran in 0.01s ====").zero).toBe(true);
    expect(summary("No test files found, exiting with code 1").zero).toBe(true);
  });
});

describe("claimsTestsPass", () => {
  it.each([
    "All tests pass.",
    "The test suite passes now.",
    "All 120 tests passed.",
    "Tests are green.",
    "Done, the tests are passing.",
  ])("%s is a claim", (t) => expect(claimsTestsPass(t)).toBe(true));
  it.each([
    "Two tests still fail.",
    "Not all tests pass yet.",
    "I fixed the parser.",
    "The tests do not pass on Windows.",
    "",
  ])("%s is not a claim", (t) => expect(claimsTestsPass(t)).toBe(false));
});

describe("buildLedger", () => {
  it("supports a claim after a clean full run with nothing changed after it", () => {
    const l = buildLedger([
      edit(1, "src/a.py"),
      cmd(2, "pytest -q", "==== 12 passed in 1s ====", 0),
      say(3, "All tests pass."),
    ]);
    expect(l.claimsPass).toBe(true);
    expect(l.unsupported).toEqual([]);
  });
  it("a stale pass: files changed after the last full run", () => {
    const l = buildLedger([
      cmd(1, "pytest -q", "==== 12 passed in 1s ====", 0),
      edit(2, "src/a.py"),
      edit(3, "src/b.py"),
      say(4, "All tests pass."),
    ]);
    expect(l.unsupported).toEqual([
      "2 files changed after the last full run: src/a.py, src/b.py",
    ]);
  });
  it("only narrowed runs", () => {
    const l = buildLedger([
      cmd(1, "pytest tests/test_a.py", "==== 3 passed in 1s ====", 0),
      say(2, "The tests pass."),
    ]);
    expect(l.unsupported[0]).toMatch(/every test run was narrowed/);
  });
  it("a pipe hides a failing exit status, and the summary still shows the failure", () => {
    const l = buildLedger([
      cmd(1, "pytest 2>&1 | tail -3", "==== 1 failed, 11 passed in 1s ====", 0),
      say(2, "All tests pass."),
    ]);
    expect(l.lastFull?.outcome).toBe("fail");
    expect(l.unsupported[0]).toMatch(/the last full run failed/);
  });
  it("a pipe with no summary in view: the result is unknown", () => {
    const l = buildLedger([
      cmd(1, "npm test | tail -1", "done", 0),
      say(2, "All tests pass."),
    ]);
    expect(l.lastFull?.outcome).toBe("unknown");
    expect(l.unsupported[0]).toMatch(/hidden by a pipe/);
  });
  it("zero tests collected", () => {
    const l = buildLedger([
      cmd(1, "pytest", "==== no tests ran in 0.01s ====", 5),
      say(2, "All tests pass."),
    ]);
    expect(l.unsupported[0]).toMatch(/collected no tests/);
  });
  it("no test run at all", () => {
    expect(
      buildLedger([edit(1, "src/a.ts"), say(2, "All tests pass.")]).unsupported,
    ).toEqual(["no test command ran in this session"]);
  });
  it("no claim, nothing unsupported, and the account still says what ran", () => {
    const l = buildLedger([
      cmd(1, "npx vitest run", " Tests  2 failed | 8 passed (10)", 1),
      say(2, "Two tests still fail; I need your input."),
    ]);
    expect(l.claimsPass).toBe(false);
    expect(renderLedger(l)).toContain(
      "Last full run: `npx vitest run`: fail, 8 passed, 2 failed.",
    );
  });
});

describe("transcript readers", () => {
  it("reads a Claude Code transcript: Bash with its result, edits, the final text", () => {
    const lines = [
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "t1",
              name: "Bash",
              input: { command: "pytest -q" },
            },
          ],
        },
      },
      {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "t1",
              is_error: true,
              content: "Exit code 1\n==== 1 failed, 4 passed in 1s ====",
            },
          ],
        },
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "t2",
              name: "Edit",
              input: {
                file_path: "/repo/src/a.py",
                old_string: "a",
                new_string: "b",
              },
            },
          ],
        },
      },
      {
        type: "user",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "t2", content: "ok" }],
        },
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Fixed. All tests pass." }],
        },
      },
    ];
    const events = readTranscript(
      lines.map((l) => JSON.stringify(l)).join("\n"),
    );
    expect(events.map((e) => e.kind)).toEqual(["command", "edit", "message"]);
    expect(events[0]).toMatchObject({ exit: 1 });
    const l = buildLedger(events);
    expect(l.unsupported).toEqual([
      "the last full run failed (pytest -q, 1 failed)",
      "1 file changed after the last full run: /repo/src/a.py",
    ]);
  });
  it("reads a Codex exec --json stream", () => {
    const lines = [
      { type: "thread.started", thread_id: "x" },
      {
        type: "item.completed",
        item: {
          id: "i1",
          type: "command_execution",
          command: 'bash -lc "npm test"',
          aggregated_output: "Tests:  5 passed, 5 total",
          exit_code: 0,
          status: "completed",
        },
      },
      {
        type: "item.completed",
        item: {
          id: "i2",
          type: "file_change",
          changes: [{ path: "src/a.ts", kind: "update" }],
        },
      },
      {
        type: "item.completed",
        item: {
          id: "i3",
          type: "agent_message",
          text: "Done. The suite is green and all tests pass.",
        },
      },
    ];
    const events = readTranscript(
      lines.map((l) => JSON.stringify(l)).join("\n"),
    );
    expect(events.map((e) => e.kind)).toEqual(["command", "edit", "message"]);
    expect(buildLedger(events).unsupported).toEqual([
      "1 file changed after the last full run: src/a.ts",
    ]);
  });
  it("ignores lines it cannot read", () => {
    expect(readClaude("not json\n{}\n")).toEqual([]);
    expect(
      readCodex(
        '{"type":"item.completed","item":{"type":"reasoning","text":"x"}}',
      ),
    ).toEqual([]);
  });
});
