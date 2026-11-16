#!/usr/bin/env node
// Launcher for the plugin's hooks and MCP server. It runs the testwitness CLI that ships next to this plugin (the npm
// package layout), else a `testwitness` on PATH. When neither is there it says so on stderr and exits 0, so a plugin
// installed without the CLI never blocks or breaks the agent. It downloads nothing.
import { spawn } from "node:child_process";
import process from "node:process";
import { existsSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const bundled = join(here, "..", "..", "bin", "testwitness.js");
const exe =
  process.platform === "win32"
    ? ["testwitness.cmd", "testwitness.exe", "testwitness"]
    : ["testwitness"];
const exists = (p) => {
  try {
    return existsSync(p);
  } catch {
    return false;
  }
};
const onPath = (process.env.PATH ?? "")
  .split(delimiter)
  .flatMap((dir) => exe.map((e) => join(dir, e)))
  .find(exists);

let cmd, cmdArgs;
if (exists(bundled)) [cmd, cmdArgs] = [process.execPath, [bundled, ...args]];
else if (onPath) [cmd, cmdArgs] = [onPath, args];
else {
  process.stderr.write(
    "testwitness plugin: the testwitness CLI is not installed, so the guard is off. Install it with: npm i -g testwitness\n",
  );
  process.exit(0);
}
const child = spawn(cmd, cmdArgs, {
  stdio: "inherit",
  shell: process.platform === "win32" && cmd === onPath,
});
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
child.on("error", (err) => {
  process.stderr.write(
    `testwitness plugin: could not start the CLI (${err.message}), so the guard is off for this event.\n`,
  );
  process.exit(0);
});
