import { Model } from 'mongoose';
import { User, hashPassword, IUser, Restaurant, Ngo } from '../../models';
import { ApiError } from '../../utils/ApiError';
import { signAccessToken, signRefreshToken, JwtPayload } from '../../utils/jwt';
import { generateQrToken, slugify, generateToken } from '../../utils/ids';
import {
  RegisterInput,
  LoginInput,
  RegisterRestaurantInput,
  RegisterNgoInput,
} from './auth.schema';

export function publicUser(user: IUser) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    restaurantId: user.restaurant?.toString(),
    ngoId: user.ngo?.toString(),
    isGuest: user.isGuest,
    createdAt: user.createdAt,
  };
}

function tokensFor(user: IUser) {
  const payload: JwtPayload = {
    sub: user._id.toString(),
    role: user.role,
    email: user.email,
  };
  return {
    accessToken: signAccessToken(payload),
    refreshToken: signRefreshToken({ sub: payload.sub }),
  };
}

async function assertEmailFree(email: string) {
  if (await User.exists({ email })) {
    throw ApiError.conflict('An account with this email already exists. Try signing in.');
  }
}

/** A unique, readable slug — "dil-dosa", then "dil-dosa-faridabad", then a random suffix. */
async function uniqueSlug(model: Model<any>, name: string, city: string): Promise<string> {
  const base = slugify(name) || 'partner';
  const candidates = [base, `${base}-${slugify(city)}`];
  for (const candidate of candidates) {
    if (!(await model.exists({ slug: candidate }))) return candidate;
  }
  return `${base}-${generateToken(3).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}

export async function register(input: RegisterInput) {
  const email = input.email.toLowerCase();
  await assertEmailFree(email);

  const user = await User.create({
    name: input.name,
    email,
    phone: input.phone,
    passwordHash: await hashPassword(input.password),
    role: 'customer',
  });

  return { user: publicUser(user), ...tokensFor(user) };
}

/**
 * A kitchen applies to join. The account works immediately so the owner can
 * set up the menu, but the donation page stays hidden until an admin approves.
 */
export async function registerRestaurant(input: RegisterRestaurantInput) {
  const email = input.account.email.toLowerCase();
  await assertEmailFree(email);

  const user = await User.create({
    name: input.account.name,
    email,
    phone: input.account.phone,
    passwordHash: await hashPassword(input.account.password),
    role: 'restaurant',
  });

  try {
    const restaurant = await Restaurant.create({
      ...input.restaurant,
      slug: await uniqueSlug(Restaurant, input.restaurant.name, input.restaurant.address.city),
      email,
      approvalStatus: 'pending',
      isAcceptingDonations: true,
      qrToken: generateQrToken(),
      owner: user._id,
    });
    user.restaurant = restaurant._id;
    await user.save();
    return { user: publicUser(user), restaurant, ...tokensFor(user) };
  } catch (err) {
    // No multi-document transaction on a standalone dev database — undo by hand
    // so a failed application never leaves an orphaned login behind.
    await User.deleteOne({ _id: user._id });
    throw err;
  }
}

/** An NGO applies to join. Same shape as a restaurant application. */
export async function registerNgo(input: RegisterNgoInput) {
  const email = input.account.email.toLowerCase();
  await assertEmailFree(email);

  const user = await User.create({
    name: input.account.name,
    email,
    phone: input.account.phone,
    passwordHash: await hashPassword(input.account.password),
    role: 'ngo',
  });

  try {
    const ngo = await Ngo.create({
      ...input.ngo,
      slug: await uniqueSlug(Ngo, input.ngo.name, input.ngo.address.city),
      email,
      approvalStatus: 'pending',
      owner: user._id,
    });
    user.ngo = ngo._id;
    await user.save();
    return { user: publicUser(user), ngo, ...tokensFor(user) };
  } catch (err) {
    await User.deleteOne({ _id: user._id });
    throw err;
  }
}

export async function login(input: LoginInput) {
  const user = await User.findOne({ email: input.email.toLowerCase() }).select('+passwordHash');
  if (!user || !user.passwordHash) throw ApiError.unauthorized('Incorrect email or password.');

  const ok = await user.comparePassword(input.password);
  if (!ok) throw ApiError.unauthorized('Incorrect email or password.');
  if (!user.isActive) throw ApiError.forbidden('This account has been deactivated.');

  user.lastLoginAt = new Date();
  await user.save();

  return { user: publicUser(user), ...tokensFor(user) };
}

export async function refresh(userId: string) {
  const user = await User.findById(userId);
  if (!user || !user.isActive) throw ApiError.unauthorized('Session is no longer valid.');
  return { user: publicUser(user), ...tokensFor(user) };
}
