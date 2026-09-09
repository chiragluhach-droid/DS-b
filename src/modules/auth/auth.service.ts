import { User, hashPassword, IUser } from '../../models';
import { ApiError } from '../../utils/ApiError';
import { signAccessToken, signRefreshToken, JwtPayload } from '../../utils/jwt';
import { RegisterInput, LoginInput } from './auth.schema';

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
    restaurant: user.restaurant?.toString(),
    ngo: user.ngo?.toString(),
  };
  return {
    accessToken: signAccessToken(payload),
    refreshToken: signRefreshToken({ sub: payload.sub }),
  };
}

export async function register(input: RegisterInput) {
  const email = input.email.toLowerCase();
  const existing = await User.findOne({ email }).select('+passwordHash');

  // A guest donor who now wants an account keeps their donation history.
  if (existing && !existing.isGuest) {
    throw ApiError.conflict('An account with this email already exists. Try signing in.');
  }

  const passwordHash = await hashPassword(input.password);
  const user = existing ?? new User({ email, role: 'customer' });
  user.name = input.name;
  user.phone = input.phone ?? user.phone;
  user.passwordHash = passwordHash;
  user.isGuest = false;
  await user.save();

  return { user: publicUser(user), ...tokensFor(user) };
}

export async function login(input: LoginInput) {
  const user = await User.findOne({ email: input.email.toLowerCase() }).select('+passwordHash');
  if (!user || !user.passwordHash) throw ApiError.unauthorized('Incorrect email or password.');
  if (!user.isActive) throw ApiError.forbidden('This account has been deactivated.');

  const ok = await user.comparePassword(input.password);
  if (!ok) throw ApiError.unauthorized('Incorrect email or password.');

  user.lastLoginAt = new Date();
  await user.save();

  return { user: publicUser(user), ...tokensFor(user) };
}

export async function refresh(userId: string) {
  const user = await User.findById(userId);
  if (!user || !user.isActive) throw ApiError.unauthorized('Session is no longer valid.');
  return { user: publicUser(user), ...tokensFor(user) };
}
