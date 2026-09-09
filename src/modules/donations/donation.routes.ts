import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { optionalAuth, requireAuth, requireRole } from '../../middleware/auth';
import {
  createDonationSchema,
  advanceStatusSchema,
  ngoConfirmSchema,
  assignNgoSchema,
} from './donation.schema';
import * as controller from './donation.controller';

const router = Router();

router.post('/', optionalAuth, validate(createDonationSchema), controller.create);
router.get('/mine', requireAuth, controller.myDonations);
router.get('/:donationId/track', controller.track);

router.patch(
  '/:donationId/status',
  requireAuth,
  requireRole('restaurant', 'ngo', 'admin'),
  validate(advanceStatusSchema),
  controller.advance
);

router.patch(
  '/:donationId/confirm',
  requireAuth,
  requireRole('ngo', 'admin'),
  validate(ngoConfirmSchema),
  controller.confirmByNgo
);

router.patch(
  '/:donationId/ngo',
  requireAuth,
  requireRole('restaurant', 'admin'),
  validate(assignNgoSchema),
  controller.assignNgo
);

export default router;
