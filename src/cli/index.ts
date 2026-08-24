#!/usr/bin/env node
import { inspect } from './commands/inspect.js';
import { buildIntent } from './commands/intent.js';
import { pair } from './commands/pair.js';
import { status } from './commands/status.js';
import { verify } from './commands/verify.js';
import { flag, has, required } from './args.js';
import type { RuntimeChain } from '../adapters/shared/types.js';
const argv = process.argv.slice(2);
const command = argv[0];
const subcommand = argv[1];
const json = (value: unknown) => console.log(JSON.stringify(value, null, 2));
function parseChain(): RuntimeChain { const value = flag(argv, '--chain') ?? 'solana'; if (value !== 'solana') throw new Error(`invalid --chain ${value}, solana is the only supported rail`); return value; }
async function main(): Promise<void> {
  const chain = parseChain();
  if (command === 'pair') json(pair({ chain, fixture: has(argv, '--fixture'), machineId: flag(argv, '--machine-id'), machineLabel: flag(argv, '--machine-label'), wallet: flag(argv, '--wallet'), operator: flag(argv, '--operator'), policy: flag(argv, '--policy'), role: flag(argv, '--role') }));
  else if (command === 'verify') {
    const id = flag(argv, '--signature') ?? flag(argv, '--tx');
    if (!id) throw new Error('verify requires --signature');
    const rpcUrl = flag(argv, '--rpc-url');
    const result = await verify({
      chain,
      id,
      fixture: has(argv, '--fixture'),
      ...(rpcUrl === undefined ? {} : { rpcUrl }),
      expectation: {
        from: flag(argv, '--from'),
        to: flag(argv, '--to'),
        amount: flag(argv, '--amount'),
        memo: flag(argv, '--memo'),
        sessionId: flag(argv, '--session-id'),
        machineId: flag(argv, '--machine-id')
      }
    });
    if (!result.ok) { console.error(result.error.detail); process.exitCode = 1; }
    json(result);
  }
  else if (command === 'status') { const result = await status(chain, { fixture: has(argv, '--fixture'), rpcUrl: flag(argv, '--rpc-url') }); if (!result.ok) process.exitCode = 1; json(result); }
  else if (command === 'inspect') json(inspect(chain));
  else if (command === 'intent' && subcommand === 'build') json(buildIntent({ chain, source: required(flag(argv, '--source') ?? flag(argv, '--from'), '--source'), recipient: required(flag(argv, '--recipient') ?? flag(argv, '--to'), '--recipient'), amount: required(flag(argv, '--amount'), '--amount'), asset: flag(argv, '--asset'), machineId: required(flag(argv, '--machine-id'), '--machine-id'), sessionId: required(flag(argv, '--session-id'), '--session-id'), policyId: flag(argv, '--policy') ?? 'standard-machine-policy', memo: flag(argv, '--memo'), reference: flag(argv, '--reference'), fixture: has(argv, '--fixture') }));
  else { console.error('machinefi <pair|verify|status|inspect|intent build> [--chain solana]'); process.exitCode = 1; }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'command failed'); process.exitCode = 1; });
