import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { env } from '../../config/env';
import {
  loginSchema,
  registerSchema,
  registerRestaurantSchema,
  registerNgoSchema,
} from './auth.schema';
import * as controller from './auth.controller';

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.isTest ? 100_000 : 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again shortly.' },
  },
});

const router = Router();

router.post('/register', authLimiter, validate(registerSchema), controller.register);
router.post(
  '/register/restaurant',
  authLimiter,
  validate(registerRestaurantSchema),
  controller.registerRestaurant
);
router.post('/register/ngo', authLimiter, validate(registerNgoSchema), controller.registerNgo);
router.post('/login', authLimiter, validate(loginSchema), controller.login);
router.post('/refresh', controller.refresh);
router.post('/logout', controller.logout);
router.get('/me', requireAuth, controller.me);

export default router;
