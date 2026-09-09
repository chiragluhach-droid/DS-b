import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { requireAuth, requireRole } from '../../middleware/auth';
import * as controller from './menu.controller';

const router = Router();
const guard = [requireAuth, requireRole('restaurant')];

router.get('/me', ...guard, controller.listMine);
router.post('/me/items', ...guard, validate(controller.itemSchema), controller.createItem);
router.patch('/me/items/:id', ...guard, validate(controller.itemUpdateSchema), controller.updateItem);
router.delete('/me/items/:id', ...guard, controller.deleteItem);

export default router;
