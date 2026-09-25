import { Schema, model, Document, Types } from 'mongoose';
import { BatchStatus, BATCH_STATUSES, ROLES, Role } from './types';

/** Append-only trail of a batch's status changes. */
export interface IBatchEvent extends Document {
  _id: Types.ObjectId;
  batch: Types.ObjectId;
  fromStatus?: BatchStatus;
  toStatus: BatchStatus;
  actorType: Role | 'system';
  actorId?: Types.ObjectId;
  actorName: string;
  note?: string;
  createdAt: Date;
}

const batchEventSchema = new Schema<IBatchEvent>(
  {
    batch: { type: Schema.Types.ObjectId, ref: 'Batch', required: true, index: true },
    fromStatus: { type: String, enum: BATCH_STATUSES },
    toStatus: { type: String, enum: BATCH_STATUSES, required: true },
    actorType: { type: String, enum: [...ROLES, 'system'], required: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User' },
    actorName: { type: String, default: 'DaanSetu' },
    note: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const BatchEvent = model<IBatchEvent>('BatchEvent', batchEventSchema);
