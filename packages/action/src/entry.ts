import * as core from '@actions/core';
import { run } from './main.js';

run().catch((err: Error) => core.setFailed(`testwitness failed: ${err.stack ?? err.message}`));
