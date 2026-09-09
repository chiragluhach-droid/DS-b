import crypto from 'crypto';

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function randomCode(length: number): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** Human-quotable donation reference, e.g. DS-7K2P-9QXM. */
export function generateDonationId(): string {
  return `DS-${randomCode(4)}-${randomCode(4)}`;
}

export function generateToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function generateQrToken(): string {
  return crypto.randomBytes(9).toString('base64url');
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}
