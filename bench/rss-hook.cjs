// @ts-nocheck
// Preloaded into the benchmarked CLI process with `node -r`. On exit it writes
// the process resource usage (peak RSS in kilobytes, CPU time in microseconds)
// as JSON to file descriptor 3, which bench/run.ts opens as a pipe. The CLI
// itself is untouched and still starts the way a user would start it.
'use strict';
const fs = require('node:fs');
process.on('exit', () => {
  try {
    const u = process.resourceUsage();
    fs.writeSync(3, JSON.stringify({ maxRSSKb: u.maxRSS, userCpuUs: u.userCPUTime, systemCpuUs: u.systemCPUTime }));
  } catch {
    // fd 3 not open: the parent did not ask for usage
  }
});
