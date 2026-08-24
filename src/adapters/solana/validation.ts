const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;
export const isBase58 = (value: string): boolean => BASE58.test(value);
export function decodeBase58(value: string): Uint8Array {
  if (!isBase58(value)) throw new Error('invalid base58 string');
  const bytes: number[] = [];
  for (const char of value) {
    let carry = ALPHABET.indexOf(char);
    if (carry < 0) throw new Error('invalid base58 character');
    for (let i = 0; i < bytes.length; i += 1) {
      carry += bytes[i]! * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (const char of value) { if (char === '1') bytes.push(0); else break; }
  return Uint8Array.from(bytes.reverse());
}
export function encodeBase58(value: Readonly<Uint8Array>): string {
  if (value.length === 0) return '';
  const digits: number[] = [0];
  for (const byte of value) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
      carry += digits[i]! * 256;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let leadingZeroes = 0;
  for (const byte of value) {
    if (byte !== 0) break;
    leadingZeroes += 1;
  }
  return '1'.repeat(leadingZeroes) + digits.reverse().map((digit) => ALPHABET[digit]).join('').replace(/^1(?=1*$)/u, '');
}
const withinEncodedLength = (value: string, min: number, max: number): boolean =>
  value.length >= min && value.length <= max;

export const isSolanaAddress = (value: string): boolean => {
  // A 32-byte public key encodes to 32–44 base58 characters. Reject larger
  // input before the quadratic-ish big-integer decode loop.
  if (!withinEncodedLength(value, 32, 44)) return false;
  try { return decodeBase58(value).length === 32; } catch { return false; }
};

export const isSolanaSignature = (value: string): boolean => {
  // A 64-byte signature encodes to 64–88 base58 characters.
  if (!withinEncodedLength(value, 64, 88)) return false;
  try { return decodeBase58(value).length === 64; } catch { return false; }
};
export function assertSolanaAddress(value: string, label = 'address'): void { if (!isSolanaAddress(value)) throw new Error(`invalid Solana ${label}`); }
export function assertSolanaSignature(value: string): void { if (!isSolanaSignature(value)) throw new Error('invalid Solana signature'); }
