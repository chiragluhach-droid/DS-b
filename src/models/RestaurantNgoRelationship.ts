import { Schema, model, Document, Types } from 'mongoose';

export interface IRestaurantNgoRelationship extends Document {
  _id: Types.ObjectId;
  restaurant: Types.ObjectId;
  ngo: Types.ObjectId;
  status: 'pending' | 'active' | 'paused' | 'ended';
  isPrimary: boolean;
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IRestaurantNgoRelationship>(
  {
    restaurant: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    ngo: { type: Schema.Types.ObjectId, ref: 'Ngo', required: true, index: true },
    status: { type: String, enum: ['pending', 'active', 'paused', 'ended'], default: 'active' },
    isPrimary: { type: Boolean, default: false },
    note: { type: String },
  },
  { timestamps: true }
);

schema.index({ restaurant: 1, ngo: 1 }, { unique: true });

export const RestaurantNgoRelationship = model<IRestaurantNgoRelationship>(
  'RestaurantNgoRelationship',
  schema
);
