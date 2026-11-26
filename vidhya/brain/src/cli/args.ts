/** Tiny argument parser: positionals plus `--name value` flags. No dependency needed. */
export interface Parsed {
  pos: string[];
  flags: Record<string, string>;
}

export function parseArgs(argv: string[]): Parsed {
  const pos: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else {
        const v = argv[i + 1];
        if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
        flags[a.slice(2)] = v;
        i++;
      }
    } else pos.push(a);
  }
  return { pos, flags };
}
