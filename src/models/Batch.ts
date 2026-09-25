import { Schema, model, Document, Types } from 'mongoose';
import { BATCH_STATUSES, BatchStatus } from './types';

/**
 * Funded portions of one dish, collected for one NGO, cooked and sent together.
 * Quantities only ever change through atomic updates in batch.service.
 */
export interface IBatch extends Document {
  _id: Types.ObjectId;
  batchId: string;
  restaurant: Types.ObjectId;
  ngo: Types.ObjectId;
  menuItem: Types.ObjectId;
  /** Snapshot of the dish name, so the batch still reads correctly if the dish is deleted. */
  itemName: string;
  targetQuantity: number;
  collectedQuantity: number;
  donationCount: number;
  dispatchedQuantity: number;
  receivedQuantity: number;
  status: BatchStatus;
  readyAt?: Date;
  dispatchedAt?: Date;
  receivedAt?: Date;
  dispatchNote?: string;
  receiptNote?: string;
  resolution?: {
    note: string;
    resolvedBy: Types.ObjectId;
    resolvedAt: Date;
  };
  createdAt: Date;
  updatedAt: Date;
}

const batchSchema = new Schema<IBatch>(
  {
    batchId: { type: String, required: true, unique: true, index: true },
    restaurant: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    ngo: { type: Schema.Types.ObjectId, ref: 'Ngo', required: true, index: true },
    menuItem: { type: Schema.Types.ObjectId, ref: 'MenuItem', required: true, index: true },
    itemName: { type: String, required: true },
    targetQuantity: { type: Number, required: true, min: 1 },
    collectedQuantity: { type: Number, default: 0, min: 0 },
    donationCount: { type: Number, default: 0, min: 0 },
    dispatchedQuantity: { type: Number, default: 0, min: 0 },
    receivedQuantity: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: BATCH_STATUSES,
      default: 'IN_PROGRESS',
      index: true,
    },
    readyAt: { type: Date },
    dispatchedAt: { type: Date },
    receivedAt: { type: Date },
    dispatchNote: { type: String, maxlength: 500 },
    receiptNote: { type: String, maxlength: 500 },
    resolution: {
      note: { type: String, maxlength: 800 },
      resolvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      resolvedAt: { type: Date },
    },
  },
  { timestamps: true }
);

// At most one batch per dish and NGO may be collecting at a time. This is what
// makes concurrent payments land in the same batch instead of racing to open two.
batchSchema.index(
  { restaurant: 1, ngo: 1, menuItem: 1 },
  { unique: true, partialFilterExpression: { status: 'IN_PROGRESS' }, name: 'one_collecting_batch' }
);
batchSchema.index({ createdAt: -1 });

export const Batch = model<IBatch>('Batch', batchSchema);
