import { Schema, model, Document, Types } from 'mongoose';
import { APPROVAL_STATUSES, ApprovalStatus } from './types';

export interface IRestaurant extends Document {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  tagline?: string;
  description?: string;
  cuisine: string[];
  email: string;
  phone: string;
  address: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    pincode: string;
  };
  coverImage?: string;
  logoImage?: string;
  fssaiLicense?: string;
  gstin?: string;
  approvalStatus: ApprovalStatus;
  isAcceptingDonations: boolean;
  qrToken: string;
  owner?: Types.ObjectId;
  stats: {
    totalDonations: number;
    totalPortions: number;
    customerContributionPaise: number;
    restaurantContributionPaise: number;
    totalFoodValuePaise: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const restaurantSchema = new Schema<IRestaurant>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, index: true },
    tagline: { type: String, trim: true },
    description: { type: String, trim: true },
    cuisine: [{ type: String, trim: true }],
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, required: true, trim: true },
    address: {
      line1: { type: String, required: true },
      line2: { type: String },
      city: { type: String, required: true },
      state: { type: String, required: true },
      pincode: { type: String, required: true },
    },
    coverImage: { type: String },
    logoImage: { type: String },
    fssaiLicense: { type: String },
    gstin: { type: String },
    approvalStatus: { type: String, enum: APPROVAL_STATUSES, default: 'pending', index: true },
    isAcceptingDonations: { type: Boolean, default: true },
    qrToken: { type: String, required: true, unique: true, index: true },
    owner: { type: Schema.Types.ObjectId, ref: 'User' },
    stats: {
      totalDonations: { type: Number, default: 0 },
      totalPortions: { type: Number, default: 0 },
      customerContributionPaise: { type: Number, default: 0 },
      restaurantContributionPaise: { type: Number, default: 0 },
      totalFoodValuePaise: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

export const Restaurant = model<IRestaurant>('Restaurant', restaurantSchema);
