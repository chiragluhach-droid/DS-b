import { Schema, model, Document } from 'mongoose';

/**
 * A one-time code proving someone holds the mobile number a donation was made
 * under. Guest donations are not tied to an account, so the number is the only
 * identity a donor has — and an unverified number would hand one person's
 * history to anyone who typed it.
 *
 * Rows clear themselves: expiresAt carries a TTL index, so a code that is
 * never used leaves nothing behind. Only the hash is stored, so a dump of this
 * collection does not let anyone pass the check.
 */
export interface IDonorOtp extends Document {
  phone: string;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  createdAt: Date;
}

const donorOtpSchema = new Schema<IDonorOtp>(
  {
    // One live code per number: asking again replaces the last one rather than
    // leaving a second valid code behind.
    phone: { type: String, required: true, unique: true },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

donorOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const DonorOtp = model<IDonorOtp>('DonorOtp', donorOtpSchema);
