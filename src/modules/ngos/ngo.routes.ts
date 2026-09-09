import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { requireAuth, requireRole } from '../../middleware/auth';
import * as controller from './ngo.controller';

const router = Router();
const guard = [requireAuth, requireRole('ngo')];

router.get('/', controller.listPublic);
router.get('/me', ...guard, controller.getMine);
router.patch('/me', ...guard, validate(controller.updateNgoSchema), controller.updateMine);
router.get('/me/donations', ...guard, controller.incomingDonations);
router.get('/me/partners', ...guard, controller.partners);

export default router;
