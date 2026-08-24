import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { afterEach, expect, it } from 'vitest';
import { checkChainStatus } from '../src/status/chain-status.js';
let server: http.Server | undefined;
afterEach(() => server?.close());
function rpcServer(handler: (method: string) => unknown): Promise<string> { return new Promise((resolve) => { server = http.createServer((req, res) => { let body=''; req.on('data', c => body += c); req.on('end', () => { const method = JSON.parse(body).method; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: handler(method) })); }); }).listen(0, '127.0.0.1', () => { const addr = server!.address(); if (typeof addr === 'object' && addr) resolve(`http://127.0.0.1:${addr.port}`); }); }); }

it('reports a reachable rail from getVersion without asserting cluster identity', async () => {
  const url = await rpcServer(() => ({ 'solana-core': '1.18.22' }));
  const status = await checkChainStatus({ chain: 'solana', rpcUrl: url, timeoutMs: 1000 });
  expect(status.ok).toBe(true);
  expect(status.rpcReachable).toBe(true);
  expect(status.chainMatched).toBe(false);
});

it('returns an unreachable rail as not ok', async () => {
  const status = await checkChainStatus({ chain: 'solana', rpcUrl: 'http://127.0.0.1:1', timeoutMs: 1000 });
  expect(status.ok).toBe(false);
  expect(status.rpcReachable).toBe(false);
  expect(status.error).toBeTruthy();
});

it('CLI invalid chain exits nonzero', () => { expect(() => execFileSync('node', ['dist/cli/index.js', 'status', '--chain', 'bad'], { encoding: 'utf8', stdio: 'pipe' })).toThrow(); });
it('CLI rejects the removed robinhood rail', () => { expect(() => execFileSync('node', ['dist/cli/index.js', 'status', '--chain', 'robinhood'], { encoding: 'utf8', stdio: 'pipe' })).toThrow(); });
it('CLI missing intent args exits nonzero', () => { expect(() => execFileSync('node', ['dist/cli/index.js', 'intent', 'build'], { encoding: 'utf8', stdio: 'pipe' })).toThrow(); });
it('CLI verify missing signature exits nonzero', () => { expect(() => execFileSync('node', ['dist/cli/index.js', 'verify'], { encoding: 'utf8', stdio: 'pipe' })).toThrow(); });
