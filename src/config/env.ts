import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function required(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (value === undefined) throw new Error(`Missing required env var: ${key}`);
  return value;
}

/**
 * Atlas connection strings are pasted from the dashboard with a <db_username>
 * placeholder. Rather than fail with a confusing driver error, fall back to the
 * local instance and say so loudly.
 */
function resolveMongoUri(): { uri: string; usingFallback: boolean } {
  const primary = process.env.MONGODB_URI ?? '';
  const fallback = process.env.MONGODB_URI_LOCAL ?? 'mongodb://127.0.0.1:27017/daansetu';
  const unresolved = /<[^>]+>/.test(primary);

  if (!primary || unresolved) return { uri: fallback, usingFallback: true };
  return { uri: primary, usingFallback: false };
}

const mongo = resolveMongoUri();

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT ?? 5001),
  mongoUri: mongo.uri,
  mongoUsingFallback: mongo.usingFallback,
  jwtSecret: required('JWT_SECRET', 'daansetu_dev_access_secret'),
  jwtRefreshSecret: required('JWT_REFRESH_SECRET', 'daansetu_dev_refresh_secret'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  appPublicUrl: process.env.APP_PUBLIC_URL ?? 'http://localhost:3000',
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID ?? '',
    keySecret: process.env.RAZORPAY_KEY_SECRET ?? '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? '',
  },
};

/** When Razorpay keys are absent the platform runs a self-contained mock gateway. */
export const paymentsAreLive = Boolean(env.razorpay.keyId && env.razorpay.keySecret);
