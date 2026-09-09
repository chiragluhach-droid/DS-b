import { Schema, model, Document, Types } from 'mongoose';
import { DEFAULT_CUSTOMER_SHARE_PERCENT } from './types';

export interface IMenuItem extends Document {
  _id: Types.ObjectId;
  restaurant: Types.ObjectId;
  name: string;
  description?: string;
  /** The dish's normal menu price, in paise. This is the food value donated. */
  mrpPaise: number;
  /** Percentage of the MRP the guest pays. The restaurant covers the rest. */
  customerSharePercent: number;
  image?: string;
  category: string;
  isVeg: boolean;
  servingSize?: string;
  isAvailable: boolean;
  isSignature: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const menuItemSchema = new Schema<IMenuItem>(
  {
    restaurant: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    mrpPaise: { type: Number, required: true, min: 100 },
    customerSharePercent: {
      type: Number,
      default: DEFAULT_CUSTOMER_SHARE_PERCENT,
      min: 1,
      max: 100,
    },
    image: { type: String },
    category: { type: String, default: 'Dosa', trim: true },
    isVeg: { type: Boolean, default: true },
    servingSize: { type: String },
    isAvailable: { type: Boolean, default: true },
    isSignature: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const MenuItem = model<IMenuItem>('MenuItem', menuItemSchema);
