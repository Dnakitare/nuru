// Minimal argument parsing for the fumbo CLI. Supports `--key value`,
// `--flag` (boolean), positionals, and `lo..hi` range values.

export interface Args {
  _: string[]; // positionals (after the subcommand)
  flags: Map<string, string | true>;
}

export function parse(argv: string[]): Args {
  const _: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags.set(key, next);
        i++;
      } else {
        flags.set(key, true);
      }
    } else {
      _.push(a);
    }
  }
  return { _, flags };
}

export function num(args: Args, key: string, fallback: number): number {
  const v = args.flags.get(key);
  if (typeof v === "string") {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`--${key} must be a number`);
    return n;
  }
  return fallback;
}

export function range(args: Args, key: string, fallback: [number, number]): [number, number] {
  const v = args.flags.get(key);
  if (typeof v === "string") {
    const m = /^(\d+)\.\.(\d+)$/.exec(v);
    if (!m) throw new Error(`--${key} must be a range like 8..14`);
    return [Number(m[1]), Number(m[2])];
  }
  return fallback;
}

export function str(args: Args, key: string, fallback: string): string {
  const v = args.flags.get(key);
  return typeof v === "string" ? v : fallback;
}

export function has(args: Args, key: string): boolean {
  return args.flags.has(key);
}
