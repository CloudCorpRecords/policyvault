/**
 * Exact NEAR <-> yoctoNEAR conversion using string math only.
 * 1 NEAR = 10^24 yocto. No floats anywhere near money.
 */

const YOCTO_DIGITS = 24;

/** Parse a NEAR decimal string like "1.5" into yocto (bigint). Throws on bad input. */
export function parseNearToYocto(input: string): bigint {
  if (typeof input !== 'string') {
    throw new Error(`NEAR amount must be a string, got ${typeof input}`);
  }
  const s = input.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new Error(`Invalid NEAR amount: ${JSON.stringify(input)}`);
  }
  const [whole, frac = ''] = s.split('.');
  if (frac.length > YOCTO_DIGITS) {
    throw new Error(`NEAR amount has more than ${YOCTO_DIGITS} decimal places: ${JSON.stringify(input)}`);
  }
  const fracPadded = (frac + '0'.repeat(YOCTO_DIGITS)).slice(0, YOCTO_DIGITS);
  return BigInt(whole) * 10n ** 24n + BigInt(fracPadded === '' ? '0' : fracPadded);
}

/** Format yocto (bigint) as a NEAR decimal string, trailing zeros trimmed. */
export function formatYoctoToNear(yocto: bigint): string {
  const negative = yocto < 0n;
  const abs = negative ? -yocto : yocto;
  const digits = abs.toString().padStart(YOCTO_DIGITS + 1, '0');
  const whole = digits.slice(0, digits.length - YOCTO_DIGITS);
  const frac = digits.slice(digits.length - YOCTO_DIGITS).replace(/0+$/, '');
  const out = frac === '' ? whole : `${whole}.${frac}`;
  return negative ? `-${out}` : out;
}
