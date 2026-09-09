import { Schema, model, Document, Types } from 'mongoose';
import { DONATION_STATUSES, TERMINAL_STATUSES, AnyDonationStatus } from './types';

/**
 * A frozen copy of what was funded. Menu prices change; a receipt must not.
 * Every money field is snapshotted at purchase time.
 */
export interface IDonationItemSnapshot {
  menuItem: Types.ObjectId;
  name: string;
  image?: string;
  quantity: number;
  mrpPaise: number;
  customerSharePercent: number;
  customerPaysPaise: number;
  restaurantPaysPaise: number;
  lineCustomerPaise: number;
  lineRestaurantPaise: number;
  lineFoodValuePaise: number;
}

export interface IDonation extends Document {
  _id: Types.ObjectId;
  donationId: string;
  restaurant: Types.ObjectId;
  ngo?: Types.ObjectId;
  donor?: Types.ObjectId;
  donorSnapshot: {
    name: string;
    /** The donor's mobile — how the confirmation and tracking link reach them. */
    phone: string;
    /** Only present when a registered account made the donation. */
    email?: string;
    isAnonymous: boolean;
    message?: string;
  };
  items: IDonationItemSnapshot[];
  /** Total portions of food, i.e. the sum of item quantities. */
  totalPortions: number;
  /** What the guest was charged. */
  customerPaidPaise: number;
  /** What the restaurant committed to match. */
  restaurantContributionPaise: number;
  /** customerPaid + restaurantContribution — the food value actually donated. */
  totalFoodValuePaise: number;
  status: AnyDonationStatus;
  payment?: Types.ObjectId;
  isPaid: boolean;
  /** Portions the NGO says actually arrived. Undefined until they confirm. */
  portionsReceived?: number;
  discrepancy?: {
    hasDiscrepancy: boolean;
    reportedBy?: Types.ObjectId;
    note?: string;
    reportedAt?: Date;
    resolvedAt?: Date;
    resolutionNote?: string;
  };
  timestamps_: Partial<Record<AnyDonationStatus, Date>>;
  createdAt: Date;
  updatedAt: Date;
}

const snapshotSchema = new Schema<IDonationItemSnapshot>(
  {
    menuItem: { type: Schema.Types.ObjectId, ref: 'MenuItem', required: true },
    name: { type: String, required: true },
    image: { type: String },
    quantity: { type: Number, required: true, min: 1 },
    mrpPaise: { type: Number, required: true },
    customerSharePercent: { type: Number, required: true },
    customerPaysPaise: { type: Number, required: true },
    restaurantPaysPaise: { type: Number, required: true },
    lineCustomerPaise: { type: Number, required: true },
    lineRestaurantPaise: { type: Number, required: true },
    lineFoodValuePaise: { type: Number, required: true },
  },
  { _id: false }
);

const donationSchema = new Schema<IDonation>(
  {
    donationId: { type: String, required: true, unique: true, index: true },
    restaurant: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    ngo: { type: Schema.Types.ObjectId, ref: 'Ngo', index: true },
    donor: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    donorSnapshot: {
      name: { type: String, required: true },
      phone: { type: String, required: true, index: true },
      email: { type: String },
      isAnonymous: { type: Boolean, default: false },
      message: { type: String, maxlength: 400 },
    },
    items: { type: [snapshotSchema], required: true },
    totalPortions: { type: Number, required: true },
    customerPaidPaise: { type: Number, required: true },
    restaurantContributionPaise: { type: Number, required: true },
    totalFoodValuePaise: { type: Number, required: true },
    status: {
      type: String,
      enum: [...DONATION_STATUSES, ...TERMINAL_STATUSES],
      default: 'DONATED',
      index: true,
    },
    payment: { type: Schema.Types.ObjectId, ref: 'Payment' },
    isPaid: { type: Boolean, default: false, index: true },
    portionsReceived: { type: Number },
    discrepancy: {
      hasDiscrepancy: { type: Boolean, default: false },
      reportedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      note: { type: String },
      reportedAt: { type: Date },
      resolvedAt: { type: Date },
      resolutionNote: { type: String },
    },
    timestamps_: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

donationSchema.index({ createdAt: -1 });

export const Donation = model<IDonation>('Donation', donationSchema);
