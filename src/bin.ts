#!/usr/bin/env node
import os from 'node:os';
import { createProgram } from './cli.js';
import { integrations } from './integrations/index.js';
import { defaultRunner } from './steam/running.js';

const program = createProgram({
  platform: process.platform,
  home: os.homedir(),
  env: process.env,
  runner: defaultRunner,
  fetchFn: fetch,
  integrations,
  log: (message) => console.log(message),
});

program.parseAsync(process.argv).catch((error: unknown) => {
  const code = (error as { exitCode?: number }).exitCode;
  if (code === undefined) console.error(`Error: ${(error as Error).message}`);
  process.exit(code ?? 1);
});
