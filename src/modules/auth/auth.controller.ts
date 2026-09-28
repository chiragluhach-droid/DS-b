import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { verifyRefreshToken } from '../../utils/jwt';
import { durationToMs } from '../../utils/duration';
import { recordAudit } from '../../utils/audit';
import { env } from '../../config/env';
import { isSameSite } from '../../utils/site';
import { User } from '../../models';
import * as service from './auth.service';

/**
 * How the session cookie must be written depends on where the request came from,
 * not on a setting someone has to remember:
 *
 * - daansetu.in calling api.daansetu.in is one site, so a Lax cookie is sent and
 *   no other site can use it.
 * - a Vercel URL calling a Railway URL is two sites, and a Lax cookie would
 *   simply never be sent back — the browser drops it, the user appears signed in
 *   until the next request, then lands back on the sign-in page. Those need
 *   SameSite=None, which browsers only honour on a Secure cookie.
 *
 * COOKIE_SAMESITE overrides this when a deployment needs something specific.
 */
function cookieOptions(req: Request) {
  const origin = req.headers.origin;
  const apiHost = req.headers.host ?? '';
  const isHttps = req.secure || req.get('x-forwarded-proto') === 'https';

  let sameSite = env.cookieSameSite;
  if (!sameSite) {
    let originHost = '';
    try {
      originHost = origin ? new URL(origin).hostname : '';
    } catch {
      originHost = '';
    }
    // No Origin header means a same-origin or non-browser caller.
    sameSite = !originHost || isSameSite(originHost, apiHost) ? 'lax' : 'none';
  }

  // A None cookie without Secure is discarded, and a Secure cookie is ignored
  // over plain http — so on an insecure origin, Lax is the only thing that works.
  if (sameSite === 'none' && !isHttps) sameSite = 'lax';

  return {
    httpOnly: true as const,
    sameSite,
    secure: sameSite === 'none' || (env.isProd && isHttps),
    domain: env.cookieDomain,
    path: '/',
  };
}

function setAuthCookies(req: Request, res: Response, accessToken: string, refreshToken: string) {
  const base = cookieOptions(req);
  res.cookie('accessToken', accessToken, { ...base, maxAge: durationToMs(env.jwtExpiresIn) });
  res.cookie('refreshToken', refreshToken, {
    ...base,
    maxAge: durationToMs(env.jwtRefreshExpiresIn),
  });
}

export const register = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.register(req.body);
  setAuthCookies(req, res, result.accessToken, result.refreshToken);
  await recordAudit({ req, action: 'auth.register', entityType: 'User', entityId: result.user.id });
  res.status(201).json({ success: true, data: result });
});

/** A kitchen applies to join. Usable at once; the public page waits for approval. */
export const registerRestaurant = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.registerRestaurant(req.body);
  setAuthCookies(req, res, result.accessToken, result.refreshToken);
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
  setAuthCookies(req, res, result.accessToken, result.refreshToken);
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
  setAuthCookies(req, res, result.accessToken, result.refreshToken);
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
  setAuthCookies(req, res, result.accessToken, result.refreshToken);
  res.json({ success: true, data: result });
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  // Clearing a cookie only works when the attributes match how it was set.
  const base = cookieOptions(req);
  res.clearCookie('accessToken', base);
  res.clearCookie('refreshToken', base);
  res.json({ success: true, data: { message: 'Signed out.' } });
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findById(req.user!.id);
  if (!user) throw ApiError.notFound('Account not found.');
  res.json({ success: true, data: { user: service.publicUser(user) } });
});
