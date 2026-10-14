/**
 * One spelling per person. A mobile number is typed as "+91 98765 43210",
 * "098765-43210" or "9876543210" by the same donor on different days, and all
 * three have to land on the same donations, so every entry point normalises
 * through here before it touches the database.
 */
export function normalizePhone(value: string): string {
  return value.trim().replace(/[\s-]/g, '').replace(/^(\+91|0)/, '');
}

export const INDIAN_MOBILE = /^[6-9]\d{9}$/;
