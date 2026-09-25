import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt';
import { ApiError } from '../utils/ApiError';
import { Role, User } from '../models';

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  if (req.cookies?.accessToken) return req.cookies.accessToken as string;
  return null;
}

/**
 * The token proves who the caller is; the account record decides what they may
 * do. Reading it on every request means a deactivated account, or a role or
 * restaurant link changed by an admin, takes effect immediately rather than
 * when the token happens to expire.
 */
async function resolveUser(token: string): Promise<Request['user'] | null> {
  let sub: string;
  try {
    sub = verifyAccessToken(token).sub;
  } catch {
    return null;
  }
  const user = await User.findById(sub).select('name email role restaurant ngo isActive').lean();
  if (!user || !user.isActive) return null;
  return {
    id: user._id.toString(),
    role: user.role,
    email: user.email,
    name: user.name,
    restaurant: user.restaurant?.toString(),
    ngo: user.ngo?.toString(),
  };
}

/** Attaches req.user when a valid session is present; never rejects. */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = extractToken(req);
  if (!token) return next();
  try {
    const user = await resolveUser(token);
    if (user) req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = extractToken(req);
  if (!token) return next(ApiError.unauthorized());
  try {
    const user = await resolveUser(token);
    if (!user) return next(ApiError.unauthorized('Your session has expired. Please sign in again.'));
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) return next(ApiError.forbidden());
    next();
  };
}
