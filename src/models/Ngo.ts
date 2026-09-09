import { Schema, model, Document, Types } from 'mongoose';
import { APPROVAL_STATUSES, ApprovalStatus } from './types';

export interface INgo extends Document {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  mission?: string;
  email: string;
  phone: string;
  registrationNumber?: string;
  website?: string;
  address: {
    line1: string;
    city: string;
    state: string;
    pincode: string;
  };
  logoImage?: string;
  coverImage?: string;
  beneficiaryFocus: string[];
  dailyCapacity: number;
  approvalStatus: ApprovalStatus;
  owner?: Types.ObjectId;
  stats: { portionsReceived: number; donationsConfirmed: number };
  createdAt: Date;
  updatedAt: Date;
}

const ngoSchema = new Schema<INgo>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, index: true },
    mission: { type: String, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, required: true, trim: true },
    registrationNumber: { type: String, trim: true },
    website: { type: String, trim: true },
    address: {
      line1: { type: String, required: true },
      city: { type: String, required: true },
      state: { type: String, required: true },
      pincode: { type: String, required: true },
    },
    logoImage: { type: String },
    coverImage: { type: String },
    beneficiaryFocus: [{ type: String, trim: true }],
    dailyCapacity: { type: Number, default: 100 },
    approvalStatus: { type: String, enum: APPROVAL_STATUSES, default: 'pending', index: true },
    owner: { type: Schema.Types.ObjectId, ref: 'User' },
    stats: {
      portionsReceived: { type: Number, default: 0 },
      donationsConfirmed: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

export const Ngo = model<INgo>('Ngo', ngoSchema);
