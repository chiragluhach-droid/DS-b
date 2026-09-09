import { Router } from 'express';
import { validate } from '../../middleware/validate';
import * as controller from './payment.controller';

const router = Router();

router.get('/config', controller.config);
router.post('/order', validate(controller.createOrderSchema), controller.createOrder);
router.post('/verify', validate(controller.verifySchema), controller.verify);

export default router;
