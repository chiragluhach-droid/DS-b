import { Schema, model, Document, Types } from 'mongoose';
import { ApiError } from '../utils/ApiError';

/**
 * Switches that apply to the whole platform rather than to one kitchen.
 *
 * It is a single document, found by a fixed key. A collection with exactly one
 * row looks odd until you need the second switch — and the alternative, an
 * environment variable, cannot be flipped by an admin without a redeploy,
 * which is the whole point of this one.
 */
export interface IPlatformSettings extends Document {
  key: 'platform';
  /**
   * The master tap for giving. False leaves the site up and browsable — the
   * menus, the tracking pages, the dashboards all keep working — and refuses
   * only the two steps that take money: starting a donation and opening a
   * payment for one.
   */
  donationsEnabled: boolean;
  /** Shown to guests in place of the usual call to action. */
  donationsPausedNote?: string;
  updatedBy?: Types.ObjectId;
  updatedAt: Date;
}

const platformSettingsSchema = new Schema<IPlatformSettings>(
  {
    key: { type: String, required: true, unique: true, default: 'platform' },
    donationsEnabled: { type: Boolean, default: true },
    donationsPausedNote: { type: String, maxlength: 240 },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: false, updatedAt: true } }
);

export const PlatformSettings = model<IPlatformSettings>(
  'PlatformSettings',
  platformSettingsSchema
);

/**
 * The settings, creating them on first read. Donations default to on, so a
 * fresh database behaves exactly as it did before this switch existed.
 */
export async function getPlatformSettings(): Promise<IPlatformSettings> {
  return PlatformSettings.findOneAndUpdate(
    { key: 'platform' },
    { $setOnInsert: { key: 'platform', donationsEnabled: true } },
    { upsert: true, new: true }
  );
}

/** Throws the message a guest should see when giving is paused. */
export async function assertDonationsOpen(): Promise<void> {
  const settings = await getPlatformSettings();
  if (settings.donationsEnabled) return;
  throw new ApiError(
    503,
    settings.donationsPausedNote?.trim() ||
      'Donations are currently off. Please check back shortly.',
    'DONATIONS_PAUSED'
  );
}
