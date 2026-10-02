import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { requireAuth, requireRole } from '../../middleware/auth';
import * as controller from './admin.controller';

const router = Router();
router.use(requireAuth, requireRole('admin'));

router.get('/overview', controller.overview);
router.get('/restaurants', controller.listRestaurants);
router.patch(
  '/restaurants/:id/approval',
  validate(controller.approvalSchema),
  controller.setRestaurantApproval
);
router.get('/ngos', controller.listNgos);
router.patch('/ngos/:id/approval', validate(controller.approvalSchema), controller.setNgoApproval);
router.get('/restaurants/:id/menu', controller.listRestaurantMenu);
router.patch(
  '/menu-items/:itemId/pilot',
  validate(controller.pilotItemSchema),
  controller.setItemPilotState
);
router.get('/users', controller.listUsers);
router.patch('/users/:id/state', validate(controller.userStateSchema), controller.setUserState);
router.get('/donations', controller.listDonations);
router.get('/payments', controller.listPayments);
router.get('/batches', controller.listBatches);
router.patch(
  '/batches/:batchId/resolve',
  validate(controller.resolveBatchSchema),
  controller.resolveBatch
);
router.get('/audit-logs', controller.listAuditLogs);

export default router;
