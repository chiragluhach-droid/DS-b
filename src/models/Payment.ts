import { Schema, model, Document, Types } from 'mongoose';
import { PAYMENT_STATUSES, PaymentStatus } from './types';

export interface IPayment extends Document {
  _id: Types.ObjectId;
  donation: Types.ObjectId;
  provider: 'razorpay' | 'mock';
  orderId: string;
  paymentId?: string;
  signature?: string;
  amountPaise: number;
  currency: string;
  status: PaymentStatus;
  method?: string;
  failureReason?: string;
  rawPayload?: Record<string, unknown>;
  verifiedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const paymentSchema = new Schema<IPayment>(
  {
    donation: { type: Schema.Types.ObjectId, ref: 'Donation', required: true, index: true },
    provider: { type: String, enum: ['razorpay', 'mock'], default: 'mock' },
    orderId: { type: String, required: true, index: true },
    paymentId: { type: String, index: true },
    signature: { type: String },
    amountPaise: { type: Number, required: true },
    currency: { type: String, default: 'INR' },
    status: { type: String, enum: PAYMENT_STATUSES, default: 'created', index: true },
    method: { type: String },
    failureReason: { type: String },
    rawPayload: { type: Schema.Types.Mixed },
    verifiedAt: { type: Date },
  },
  { timestamps: true }
);

export const Payment = model<IPayment>('Payment', paymentSchema);
