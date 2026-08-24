import { pair } from '../cli/commands/pair.js';
console.log(JSON.stringify(pair({ chain: 'solana', fixture: true }), null, 2));
