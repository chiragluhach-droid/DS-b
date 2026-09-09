import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { requireAuth, requireRole } from '../../middleware/auth';
import * as controller from './restaurant.controller';

const router = Router();

// Public
router.get('/', controller.listPublic);
router.get('/qr/:token', controller.resolveQr);

// Restaurant dashboard — declared before /:slug so they are not shadowed.
router.get('/me', requireAuth, requireRole('restaurant'), controller.getMine);
router.patch(
  '/me',
  requireAuth,
  requireRole('restaurant'),
  validate(controller.updateProfileSchema),
  controller.updateMine
);
router.get('/me/qr', requireAuth, requireRole('restaurant'), controller.getQr);
router.get('/me/donations', requireAuth, requireRole('restaurant'), controller.listDonations);
router.get('/me/analytics', requireAuth, requireRole('restaurant'), controller.analytics);
router.get('/me/ngos', requireAuth, requireRole('restaurant'), controller.listPartnerNgos);

router.get('/:slug', controller.getPublicBySlug);

export default router;
