import { verifySolanaReceipt } from '../adapters/solana/receipts.js';
console.log(JSON.stringify(await verifySolanaReceipt('5HueCGU8rMjxEXxiPuD5BDuRaRj1hUXQG48GhYnjmQumooWcT3Yr4v7e1i4bnzK7t1Q7Fxx4E2VPu7Y9xV1r5fq', { fixture: true }), null, 2));
