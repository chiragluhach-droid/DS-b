import { Schema, model, Document, Types } from 'mongoose';

export interface IBatchReceipt extends Document {
  _id: Types.ObjectId;
  batch: Types.ObjectId;
  ngo: Types.ObjectId;
  expectedQuantity: number;
  receivedQuantity: number;
  confirmedBy: Types.ObjectId;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const batchReceiptSchema = new Schema<IBatchReceipt>(
  {
    batch: { type: Schema.Types.ObjectId, ref: 'Batch', required: true, index: true },
    ngo: { type: Schema.Types.ObjectId, ref: 'Ngo', required: true, index: true },
    expectedQuantity: { type: Number, required: true, min: 1 },
    receivedQuantity: { type: Number, required: true, min: 0 },
    confirmedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    notes: { type: String },
  },
  { timestamps: true }
);

export const BatchReceipt = model<IBatchReceipt>('BatchReceipt', batchReceiptSchema);
