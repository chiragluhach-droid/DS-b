import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { requireAuth, requireRole } from '../../middleware/auth';
import * as controller from './restaurant.controller';

const router = Router();
const guard = [requireAuth, requireRole('restaurant')];

// Public
router.get('/', controller.listPublic);
router.get('/qr/:token', controller.resolveQr);

// Restaurant dashboard — declared before /:slug so they are not shadowed.
router.get('/me', ...guard, controller.getMine);
router.patch('/me', ...guard, validate(controller.updateProfileSchema), controller.updateMine);
router.get('/me/qr', ...guard, controller.getQr);
router.get('/me/donations', ...guard, controller.listDonations);
router.get('/me/analytics', ...guard, controller.analytics);
router.get('/me/ngos', ...guard, controller.listPartnerNgos);
router.post('/me/ngos', ...guard, validate(controller.partnerSchema), controller.addPartner);
router.patch(
  '/me/ngos/:ngoId',
  ...guard,
  validate(controller.partnerUpdateSchema),
  controller.updatePartner
);

router.get('/:slug', controller.getPublicBySlug);

export default router;
