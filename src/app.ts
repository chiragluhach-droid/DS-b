import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import routes from './routes';
import { notFoundHandler, errorHandler } from './middleware/error';
import { ApiError } from './utils/ApiError';
import { webhook } from './modules/payments/payment.controller';

/**
 * The session cookie travels on cross-origin requests, so anything that changes
 * state must arrive as JSON. A browser cannot send a cross-site JSON body from a
 * plain HTML form without a CORS preflight this API would refuse, which is what
 * stops another site from acting as a signed-in user.
 */
function requireJsonBody(req: Request, _res: Response, next: NextFunction): void {
  const writes = ['POST', 'PUT', 'PATCH', 'DELETE'];
  const hasBody = Number(req.headers['content-length'] ?? 0) > 0 || Boolean(req.headers['transfer-encoding']);
  if (!writes.includes(req.method) || !hasBody) return next();

  const type = req.headers['content-type'] ?? '';
  if (!type.toLowerCase().includes('application/json')) {
    return next(new ApiError(415, 'This API accepts JSON request bodies only.', 'UNSUPPORTED_MEDIA_TYPE'));
  }
  next();
}

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || env.corsOrigins.includes('*') || env.corsOrigins.includes(origin)) {
          return callback(null, true);
        }
        callback(new Error(`Origin ${origin} is not allowed by CORS`));
      },
      credentials: true,
    })
  );

  // The webhook needs the raw body for signature verification, so it is
  // mounted before the JSON parser.
  app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), webhook);

  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  if (!env.isProd && !env.isTest) app.use(morgan('dev'));

  app.use(
    '/api',
    rateLimit({
      windowMs: 60 * 1000,
      max: env.isTest ? 100_000 : 300,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        success: false,
        error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' },
      },
    })
  );

  app.use('/api', requireJsonBody);
  app.use('/api', routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
