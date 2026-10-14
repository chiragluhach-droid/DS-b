import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { DonorOtp } from '../../models';
import { ApiError } from '../../utils/ApiError';
import { env } from '../../config/env';

/** Long enough to read a text, short enough that a shoulder-surfed code dies. */
const CODE_TTL_MS = 5 * 60 * 1000;
/** Six digits is a million guesses; five tries makes brute force pointless. */
const MAX_ATTEMPTS = 5;

/**
 * crypto, not Math.random: this code is the only thing standing between a
 * phone number and somebody else's donation history.
 */
function generateCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * Issues a code for a number, replacing any code still live for it. The
 * caller decides what to do with it — today that means handing it straight
 * back to the browser, because no SMS provider is configured.
 */
export async function issueOtp(phone: string): Promise<{ code: string; expiresAt: Date }> {
  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);

  await DonorOtp.findOneAndUpdate(
    { phone },
    { phone, codeHash: await bcrypt.hash(code, 10), expiresAt, attempts: 0 },
    { upsert: true }
  );

  return { code, expiresAt };
}

/**
 * Checks a code and spends it. A correct code is deleted rather than left
 * usable, so a history can only be opened once per code — and a wrong one
 * costs an attempt, so guessing runs out before it gets anywhere.
 */
export async function consumeOtp(phone: string, code: string): Promise<void> {
  const record = await DonorOtp.findOne({ phone });

  // Expired rows are swept by the TTL index, but a reader can arrive before
  // the sweep does, so the deadline is checked here too.
  if (!record || record.expiresAt.getTime() < Date.now()) {
    throw new ApiError(400, 'That code has expired. Ask for a new one.', 'OTP_EXPIRED');
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    await record.deleteOne();
    throw new ApiError(429, 'Too many wrong codes. Ask for a new one.', 'OTP_LOCKED');
  }

  if (!(await bcrypt.compare(code, record.codeHash))) {
    record.attempts += 1;
    await record.save();
    throw new ApiError(400, 'That code is not right. Check it and try again.', 'OTP_INVALID');
  }

  await record.deleteOne();
}

/**
 * Whether the code may travel back to the browser. True only while there is no
 * SMS provider — see config/env, which refuses to boot in production unless
 * someone has opted into it knowingly.
 */
export const otpIsDummy = !env.isProd || env.allowDummyOtp;
