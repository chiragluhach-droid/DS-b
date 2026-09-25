import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { requireAuth, requireRole } from '../../middleware/auth';
import * as controller from './admin.controller';

const router = Router();
router.use(requireAuth, requireRole('admin'));

router.get('/overview', controller.overview);
router.get('/restaurants', controller.listRestaurants);
router.patch('/restaurants/:id/approval', validate(controller.approvalSchema), controller.setRestaurantApproval);
router.get('/ngos', controller.listNgos);
router.patch('/ngos/:id/approval', validate(controller.approvalSchema), controller.setNgoApproval);
router.get('/users', controller.listUsers);
router.get('/donations', controller.listDonations);
router.get('/payments', controller.listPayments);
router.patch(
  '/batches/:batchId/discrepancy',
  validate(controller.resolveDiscrepancySchema),
  controller.resolveDiscrepancy
);
router.get('/audit-logs', controller.listAuditLogs);

export default router;
