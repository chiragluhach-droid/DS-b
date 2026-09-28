import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { optionalAuth, requireAuth } from '../../middleware/auth';
import { createDonationSchema } from './donation.schema';
import * as controller from './donation.controller';

const router = Router();

/**
 * A donation's status is never set by hand. Payment verification starts it and
 * the batches its dishes are cooked in carry it the rest of the way, so there is
 * no endpoint for a restaurant or NGO to move a donation directly.
 */
router.post('/', optionalAuth, validate(createDonationSchema), controller.create);
router.get('/mine', requireAuth, controller.myDonations);
router.get('/:donationId/track', controller.track);

export default router;
