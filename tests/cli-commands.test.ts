import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';

it('CLI pair accepts real machine arguments in fixture mode', () => {
  const out = execFileSync('node', ['dist/cli/index.js', 'pair', '--chain', 'solana', '--fixture', '--machine-id', 'drone-9', '--wallet', '11111111111111111111111111111111', '--operator', 'ops-alpha'], { encoding: 'utf8' });
  expect(JSON.parse(out).machineId).toBe('drone-9');
});

it('CLI defaults to the solana rail when --chain is omitted', () => {
  const out = execFileSync('node', ['dist/cli/index.js', 'pair', '--fixture', '--machine-id', 'drone-9', '--wallet', '11111111111111111111111111111111', '--operator', 'ops-alpha'], { encoding: 'utf8' });
  expect(JSON.parse(out).chain).toBe('solana');
});

it('CLI intent build requires amount and runtime ids', () => {
  const out = execFileSync('node', ['dist/cli/index.js', 'intent', 'build', '--source', '11111111111111111111111111111111', '--recipient', 'Sysvar1111111111111111111111111111111111111', '--amount', '0.5', '--machine-id', 'drone-9', '--session-id', 'session-1', '--fixture'], { encoding: 'utf8' });
  const intent = JSON.parse(out);
  expect(intent.broadcast).toBe(false);
  expect(intent.asset).toBe('SOL');
});
