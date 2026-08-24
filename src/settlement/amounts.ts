export function normalizeDecimalAmount(amount: string): string {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new Error('amount must be a positive decimal string');
  const parts = trimmed.split('.');
  const whole = parts[0]!;
  const fraction = parts[1] ?? '';
  if (BigInt(whole) === 0n && /^0*$/.test(fraction)) throw new Error('amount must be greater than zero');
  return fraction ? `${whole.replace(/^0+(?=\d)/, '')}.${fraction.replace(/0+$/, '') || '0'}` : whole.replace(/^0+(?=\d)/, '');
}

export function decimalToBaseUnits(amount: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error('invalid decimals');
  const normalized = normalizeDecimalAmount(amount);
  const normalizedParts = normalized.split('.');
  const whole = normalizedParts[0]!;
  const fraction = normalizedParts[1] ?? '';
  if (fraction.length > decimals) throw new Error(`amount has more than ${decimals} decimal places`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals) || '0');
}

export function hexQuantityToBigInt(hex: string): bigint { if (!/^0x[0-9a-fA-F]+$/.test(hex)) throw new Error('invalid hex quantity'); return BigInt(hex); }
export function baseUnitsEqualDecimal(baseUnits: bigint | string, decimal: string, decimals: number): boolean { const actual = typeof baseUnits === 'bigint' ? baseUnits : (/^0x/i.test(baseUnits) ? hexQuantityToBigInt(baseUnits) : BigInt(baseUnits)); return actual === decimalToBaseUnits(decimal, decimals); }
export function compareDecimalAmounts(left: string, right: string, decimals = 18): -1 | 0 | 1 { const l = decimalToBaseUnits(left, decimals); const r = decimalToBaseUnits(right, decimals); return l === r ? 0 : l < r ? -1 : 1; }
export function decimalAmountLte(left: string, right: string, decimals = 18): boolean { return compareDecimalAmounts(left, right, decimals) <= 0; }
export function decimalAmountGt(left: string, right: string, decimals = 18): boolean { return compareDecimalAmounts(left, right, decimals) > 0; }
export function assertPositiveDecimalAmount(amount: string, decimals = 18): void { decimalToBaseUnits(amount, decimals); }

export function toSafeBaseUnit(value: bigint | string | number): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'string') {
    if (!/^\d+$/.test(value)) throw new Error('base-unit value must be an unsigned integer string');
    return BigInt(value);
  }
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('base-unit number exceeds safe integer range');
  return BigInt(value);
}

export function subtractBaseUnits(left: bigint | string | number, right: bigint | string | number): bigint {
  return toSafeBaseUnit(left) - toSafeBaseUnit(right);
}
