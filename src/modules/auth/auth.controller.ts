import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { verifyRefreshToken } from '../../utils/jwt';
import { recordAudit } from '../../utils/audit';
import { env } from '../../config/env';
import { User } from '../../models';
import * as service from './auth.service';

/**
 * In production the API (Railway) and the web app (Vercel) are different
 * sites, so the session cookie must be SameSite=None or the browser will not
 * send it on API calls — and SameSite=None is only honoured on a Secure
 * cookie. Locally both sides are localhost, where Lax works and Secure would
 * stop the cookie being set over plain http.
 */
const COOKIE_BASE = {
  httpOnly: true as const,
  sameSite: (env.isProd ? 'none' : 'lax') as 'none' | 'lax',
  secure: env.isProd,
  path: '/',
};

function setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
  res.cookie('accessToken', accessToken, { ...COOKIE_BASE, maxAge: 7 * 24 * 60 * 60 * 1000 });
  res.cookie('refreshToken', refreshToken, { ...COOKIE_BASE, maxAge: 30 * 24 * 60 * 60 * 1000 });
}

export const register = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.register(req.body);
  setAuthCookies(res, result.accessToken, result.refreshToken);
  await recordAudit({ req, action: 'auth.register', entityType: 'User', entityId: result.user.id });
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
  const { sub } = verifyRefreshToken(token);
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
