import { Schema, model, Document, Types } from 'mongoose';
import bcrypt from 'bcryptjs';
import { ROLES, Role } from './types';

export interface IUser extends Document {
  _id: Types.ObjectId;
  name: string;
  email: string;
  phone?: string;
  passwordHash?: string;
  role: Role;
  restaurant?: Types.ObjectId;
  ngo?: Types.ObjectId;
  isActive: boolean;
  /** Guest donors are created on first donation without a password. */
  isGuest: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidate: string): Promise<boolean>;
}

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, lowercase: true, trim: true, unique: true, index: true },
    phone: { type: String, trim: true },
    passwordHash: { type: String, select: false },
    role: { type: String, enum: ROLES, default: 'customer', index: true },
    restaurant: { type: Schema.Types.ObjectId, ref: 'Restaurant' },
    ngo: { type: Schema.Types.ObjectId, ref: 'Ngo' },
    isActive: { type: Boolean, default: true },
    isGuest: { type: Boolean, default: false },
    lastLoginAt: { type: Date },
  },
  { timestamps: true }
);

userSchema.methods.comparePassword = function (candidate: string) {
  if (!this.passwordHash) return Promise.resolve(false);
  return bcrypt.compare(candidate, this.passwordHash);
};

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export const User = model<IUser>('User', userSchema);
