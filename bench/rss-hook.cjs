// Preloaded into the benchmarked CLI process with `node -r`. On exit it writes
// the process resource usage (peak RSS in kilobytes, CPU time in microseconds)
// as JSON to the file named by TW_BENCH_USAGE_FILE, which bench/run.ts reads
// after the child exits. A file works the same on Linux, macOS and Windows,
// which an extra stdio pipe does not. The CLI itself is untouched and still
// starts the way a user would start it.
'use strict';
const fs = require('node:fs');
process.on('exit', () => {
  const file = process.env.TW_BENCH_USAGE_FILE;
  if (!file) return;
  try {
    const u = process.resourceUsage();
    fs.writeFileSync(file, JSON.stringify({ maxRSSKb: u.maxRSS, userCpuUs: u.userCPUTime, systemCpuUs: u.systemCPUTime }));
  } catch {
    // unwritable: the parent reports the usage as unknown
  }
});
