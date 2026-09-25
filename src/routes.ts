import { Router } from 'express';
import authRoutes from './modules/auth/auth.routes';
import restaurantRoutes from './modules/restaurants/restaurant.routes';
import menuRoutes from './modules/menu/menu.routes';
import donationRoutes from './modules/donations/donation.routes';
import paymentRoutes from './modules/payments/payment.routes';
import ngoRoutes from './modules/ngos/ngo.routes';
import adminRoutes from './modules/admin/admin.routes';
import batchRoutes from './modules/batches/batch.routes';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', service: 'daansetu-api', time: new Date() } });
});

router.use('/auth', authRoutes);
router.use('/restaurants', restaurantRoutes);
router.use('/menu', menuRoutes);
router.use('/donations', donationRoutes);
router.use('/payments', paymentRoutes);
router.use('/ngos', ngoRoutes);
router.use('/admin', adminRoutes);
router.use('/batches', batchRoutes);

export default router;
