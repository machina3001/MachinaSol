import type { ReceiptVerification } from '../adapters/shared/types.js';
export function assertReceiptVerification(value: ReceiptVerification): ReceiptVerification { if (!value.chain || !value.id || !value.status) throw new Error('invalid receipt verification'); return value; }
