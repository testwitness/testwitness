#!/usr/bin/env node
import { main } from '../dist/cli.js';
// A closed pipe on the reading side (testwitness rules | head) is not an error.
process.stdout.on('error', (err) => { if (err.code === 'EPIPE') process.exit(0); throw err; });
main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
