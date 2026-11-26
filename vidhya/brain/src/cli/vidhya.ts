#!/usr/bin/env node
/** The `vidhya` admin command: dispatches to subcommands. */
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { runMigrateCli } from './migrate.js';
import { runMockCli } from './mock.js';

const USAGE = `vidhya <command>
  migrate <db-path> <backup-dir>      backup, then apply pending migrations
  mock close <form_version>           close the mock for everyone (keys unlock)
  mock reset <student_hash> --reason  reopen an attempt an outage covered (audited)`;

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'migrate':
      return runMigrateCli(rest);
    case 'mock':
      return runMockCli(rest);
    default:
      console.error(cmd ? `unknown command: ${cmd}\n${USAGE}` : USAGE);
      return cmd === undefined || cmd === 'help' || cmd === '--help' ? 0 : 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
