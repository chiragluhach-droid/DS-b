import { Router } from 'express';
import * as batchController from './batch.controller';
import { requireAuth, requireRole } from '../../middleware/auth';

const router = Router();

// Require user to be authenticated for all batch routes
router.use(requireAuth);

router.get('/restaurant', requireRole('restaurant', 'admin'), batchController.getRestaurantBatchesHandler);
router.get('/ngo', requireRole('ngo', 'admin'), batchController.getNgoBatchesHandler);

router.post(
  '/:batchId/dispatch',
  requireRole('restaurant', 'admin'),
  batchController.dispatchBatchHandler
);

router.post(
  '/:batchId/confirm',
  requireRole('ngo', 'admin'),
  batchController.confirmBatchReceiptHandler
);

export default router;
