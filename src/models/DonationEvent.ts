import { Schema, model, Document, Types } from 'mongoose';
import { DONATION_STATUSES, TERMINAL_STATUSES, AnyDonationStatus, ROLES, Role } from './types';

/** Append-only trail. One row per lifecycle transition — this is what the donor sees. */
export interface IDonationEvent extends Document {
  _id: Types.ObjectId;
  donation: Types.ObjectId;
  status: AnyDonationStatus;
  title: string;
  note?: string;
  actor?: Types.ObjectId;
  actorRole: Role | 'system';
  actorName: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

const donationEventSchema = new Schema<IDonationEvent>(
  {
    donation: { type: Schema.Types.ObjectId, ref: 'Donation', required: true, index: true },
    status: { type: String, enum: [...DONATION_STATUSES, ...TERMINAL_STATUSES], required: true },
    title: { type: String, required: true },
    note: { type: String },
    actor: { type: Schema.Types.ObjectId, ref: 'User' },
    actorRole: { type: String, enum: [...ROLES, 'system'], default: 'system' },
    actorName: { type: String, default: 'DaanSetu' },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const DonationEvent = model<IDonationEvent>('DonationEvent', donationEventSchema);
