import type { RuntimeChain, ReceiptExpectation } from '../../adapters/shared/types.js';
import { verifySolanaReceipt, type SolanaVerifyOptions } from '../../adapters/solana/receipts.js';

export async function verify(args: {
  chain?: RuntimeChain;
  id: string;
  fixture?: boolean;
  expectation?: ReceiptExpectation;
  rpcUrl?: string;
  timeoutMs?: number;
}) {
  const options: SolanaVerifyOptions = {
    ...(args.fixture === undefined ? {} : { fixture: args.fixture }),
    ...(args.expectation === undefined ? {} : { expectation: args.expectation }),
    ...(args.rpcUrl === undefined ? {} : { rpcUrl: args.rpcUrl }),
    ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
  };
  return verifySolanaReceipt(args.id, options);
}
