import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { verifyRefreshToken } from '../../utils/jwt';
import { durationToMs } from '../../utils/duration';
import { recordAudit } from '../../utils/audit';
import { env } from '../../config/env';
import { User } from '../../models';
import * as service from './auth.service';

/**
 * daansetu.in and api.daansetu.in are the same site, so a Lax cookie is sent on
 * API calls and cannot be used by another site. COOKIE_SAMESITE=none is only for
 * a deployment where the web app and API sit on unrelated domains, and browsers
 * only honour it on a Secure cookie.
 */
const COOKIE_BASE = {
  httpOnly: true as const,
  sameSite: env.cookieSameSite,
  secure: env.isProd || env.cookieSameSite === 'none',
  domain: env.cookieDomain,
  path: '/',
};

function setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
  res.cookie('accessToken', accessToken, {
    ...COOKIE_BASE,
    maxAge: durationToMs(env.jwtExpiresIn),
  });
  res.cookie('refreshToken', refreshToken, {
    ...COOKIE_BASE,
    maxAge: durationToMs(env.jwtRefreshExpiresIn),
  });
}

export const register = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.register(req.body);
  setAuthCookies(res, result.accessToken, result.refreshToken);
  await recordAudit({ req, action: 'auth.register', entityType: 'User', entityId: result.user.id });
  res.status(201).json({ success: true, data: result });
});

/** A kitchen applies to join. Usable at once; the public page waits for approval. */
export const registerRestaurant = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.registerRestaurant(req.body);
  setAuthCookies(res, result.accessToken, result.refreshToken);
  await recordAudit({
    req,
    action: 'auth.register_restaurant',
    entityType: 'Restaurant',
    entityId: result.restaurant._id.toString(),
    after: { name: result.restaurant.name, city: result.restaurant.address.city },
  });
  res.status(201).json({ success: true, data: result });
});

export const registerNgo = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.registerNgo(req.body);
  setAuthCookies(res, result.accessToken, result.refreshToken);
  await recordAudit({
    req,
    action: 'auth.register_ngo',
    entityType: 'Ngo',
    entityId: result.ngo._id.toString(),
    after: { name: result.ngo.name, city: result.ngo.address.city },
  });
  res.status(201).json({ success: true, data: result });
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.login(req.body);
  setAuthCookies(res, result.accessToken, result.refreshToken);
  res.json({ success: true, data: result });
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const token = (req.cookies?.refreshToken as string) ?? req.body?.refreshToken;
  if (!token) throw ApiError.unauthorized('No refresh token provided.');

  let sub: string;
  try {
    sub = verifyRefreshToken(token).sub;
  } catch (err) {
    // An expired or tampered refresh token is a signed-out visitor, not a crash.
    if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.TokenExpiredError) {
      throw ApiError.unauthorized('Your session has expired. Please sign in again.');
    }
    throw err;
  }

  const result = await service.refresh(sub);
  setAuthCookies(res, result.accessToken, result.refreshToken);
  res.json({ success: true, data: result });
});

export const logout = asyncHandler(async (_req: Request, res: Response) => {
  res.clearCookie('accessToken', COOKIE_BASE);
  res.clearCookie('refreshToken', COOKIE_BASE);
  res.json({ success: true, data: { message: 'Signed out.' } });
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findById(req.user!.id);
  if (!user) throw ApiError.notFound('Account not found.');
  res.json({ success: true, data: { user: service.publicUser(user) } });
});
