export function flag(argv: string[], name: string): string | undefined { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined; }
export function has(argv: string[], name: string): boolean { return argv.includes(name); }
export function required(value: string | undefined, name: string): string { if (!value) throw new Error(`${name} is required`); return value; }
