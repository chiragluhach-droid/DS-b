import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const isProd = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

/** Values that look like they were copied from .env.example and never filled in. */
const PLACEHOLDER = /^(replace_me|changeme|secret)$|<[^>]+>|daansetu_dev_/i;

const problems: string[] = [];

/**
 * Secrets have a development fallback so the API boots with zero setup
 * locally, but production refuses to start on a missing or weak value — a
 * guessable JWT secret would let anyone mint an admin session.
 */
function secret(key: string, devFallback: string): string {
  const value = process.env[key];
  if (!isProd) return value || devFallback;
  if (!value || PLACEHOLDER.test(value) || value.length < 32) {
    problems.push(`${key} must be set to a random value of at least 32 characters`);
  }
  return value ?? '';
}

/**
 * Atlas connection strings are pasted from the dashboard with a <db_username>
 * placeholder. Locally, fall back to a local instance and say so loudly; in
 * production that would silently write to nowhere, so it is an error.
 */
function resolveMongoUri(): { uri: string; usingFallback: boolean } {
  const primary = process.env.MONGODB_URI ?? '';
  const fallback = process.env.MONGODB_URI_LOCAL ?? 'mongodb://127.0.0.1:27017/daansetu';
  const unresolved = !primary || /<[^>]+>/.test(primary);

  if (unresolved && isProd) problems.push('MONGODB_URI must be set to your Atlas connection string');
  if (unresolved) return { uri: fallback, usingFallback: true };
  return { uri: primary, usingFallback: false };
}

const mongo = resolveMongoUri();

const razorpay = {
  keyId: process.env.RAZORPAY_KEY_ID ?? '',
  keySecret: process.env.RAZORPAY_KEY_SECRET ?? '',
  webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? '',
};

/** When Razorpay keys are absent the platform runs a self-contained mock gateway. */
export const paymentsAreLive = Boolean(razorpay.keyId && razorpay.keySecret);

// Mock payments accept any signature. That is the point locally and a free
// donation button in production, so production needs an explicit opt-in.
const allowMockPayments = process.env.ALLOW_MOCK_PAYMENTS === 'true';
if (isProd && !paymentsAreLive && !allowMockPayments) {
  problems.push(
    'RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set (or ALLOW_MOCK_PAYMENTS=true for a demo deployment)'
  );
}

const sameSite = (process.env.COOKIE_SAMESITE ?? 'lax').toLowerCase();
if (!['lax', 'strict', 'none'].includes(sameSite)) {
  problems.push('COOKIE_SAMESITE must be one of lax, strict, none');
}

if (isProd && !process.env.APP_PUBLIC_URL) {
  problems.push('APP_PUBLIC_URL must be set — QR codes point at it');
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd,
  isTest,
  port: Number(process.env.PORT ?? 5001),
  mongoUri: mongo.uri,
  mongoUsingFallback: mongo.usingFallback,
  jwtSecret: secret('JWT_SECRET', 'daansetu_dev_access_secret'),
  jwtRefreshSecret: secret('JWT_REFRESH_SECRET', 'daansetu_dev_refresh_secret'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '1d',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  appPublicUrl: (process.env.APP_PUBLIC_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
  /**
   * daansetu.in and api.daansetu.in are the same *site*, so Lax cookies are sent
   * on API calls. Only set COOKIE_SAMESITE=none if the web app and API live on
   * unrelated domains (e.g. *.vercel.app and *.up.railway.app).
   */
  cookieSameSite: sameSite as 'lax' | 'strict' | 'none',
  cookieDomain: process.env.COOKIE_DOMAIN || undefined,
  razorpay,
  allowMockPayments,
};

if (problems.length > 0) {
  throw new Error(`Invalid production configuration:\n  - ${problems.join('\n  - ')}`);
}
