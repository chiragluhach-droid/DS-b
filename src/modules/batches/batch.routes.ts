import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { requireAuth, requireRole } from '../../middleware/auth';
import * as controller from './batch.controller';

const router = Router();

router.use(requireAuth);

router.get('/restaurant', requireRole('restaurant', 'admin'), controller.listForRestaurant);
router.get('/ngo', requireRole('ngo', 'admin'), controller.listForNgo);
router.get('/:batchId', requireRole('restaurant', 'ngo', 'admin'), controller.detail);

router.post(
  '/:batchId/dispatch',
  requireRole('restaurant', 'admin'),
  validate(controller.dispatchSchema),
  controller.dispatch
);

router.post(
  '/:batchId/confirm',
  requireRole('ngo', 'admin'),
  validate(controller.confirmSchema),
  controller.confirm
);

export default router;
