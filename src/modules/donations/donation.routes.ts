import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { validate } from '../../middleware/validate';
import { optionalAuth, requireAuth } from '../../middleware/auth';
import { env } from '../../config/env';
import {
  createDonationSchema,
  requestHistoryOtpSchema,
  donorHistorySchema,
} from './donation.schema';
import * as controller from './donation.controller';

const router = Router();

/**
 * Far tighter than the API-wide limit. These two routes are the only way to
 * reach a donation history without an account, so they are the ones worth
 * grinding at — both to guess a code and to probe which numbers have donated.
 */
const historyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: env.isTest ? 100_000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again in a few minutes.' },
  },
});

/**
 * A donation's status is never set by hand. Payment verification starts it and
 * the batches its dishes are cooked in carry it the rest of the way, so there is
 * no endpoint for a restaurant or NGO to move a donation directly.
 */
router.post('/', optionalAuth, validate(createDonationSchema), controller.create);
router.get('/mine', requireAuth, controller.myDonations);

// A guest donor's own history, unlocked by the mobile number they donated
// under rather than by an account.
router.post(
  '/history/otp',
  historyLimiter,
  validate(requestHistoryOtpSchema),
  controller.requestHistoryOtp
);
router.post('/history', historyLimiter, validate(donorHistorySchema), controller.donorHistory);
router.get('/:donationId/track', controller.track);

export default router;
