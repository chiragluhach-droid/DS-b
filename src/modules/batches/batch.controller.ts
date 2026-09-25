import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as batchService from './batch.service';
import { Role } from '../../models';

const dispatchBatchSchema = z.object({
  dispatchedQuantity: z.number().min(0),
  note: z.string().optional(),
});

const confirmReceiptSchema = z.object({
  receivedQuantity: z.number().min(0),
  note: z.string().optional(),
});

export async function getRestaurantBatchesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const restaurantId = req.user?.restaurant; // Assuming the restaurant user has this field
    if (!restaurantId && req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized.' });
    }
    const targetId = (req.query.restaurantId as string) || restaurantId;
    if (!targetId) return res.status(400).json({ error: 'restaurantId is required.' });

    const batches = await batchService.getBatchesForRestaurant(targetId);
    res.json({ data: batches });
  } catch (error) {
    next(error);
  }
}

export async function getNgoBatchesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const ngoId = req.user?.ngo; // Assuming the NGO user has this field
    if (!ngoId && req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized.' });
    }
    const targetId = (req.query.ngoId as string) || ngoId;
    if (!targetId) return res.status(400).json({ error: 'ngoId is required.' });

    const batches = await batchService.getBatchesForNgo(targetId);
    res.json({ data: batches });
  } catch (error) {
    next(error);
  }
}

export async function dispatchBatchHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { batchId } = req.params;
    const { dispatchedQuantity, note } = dispatchBatchSchema.parse(req.body);

    const restaurantId = req.user?.restaurant;
    if (!restaurantId && req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized.' });
    }

    // In a real app, you'd find the restaurantId based on the batch if admin, or use the logged in user's
    const targetId = (req.query.restaurantId as string) || restaurantId;
    
    if (!targetId) return res.status(400).json({ error: 'restaurantId required.' });

    const actor = { id: req.user!.id, role: req.user!.role as Role, name: req.user!.email };

    const batch = await batchService.dispatchBatch(batchId, targetId, dispatchedQuantity, actor, note);
    res.json({ data: batch });
  } catch (error) {
    next(error);
  }
}

export async function confirmBatchReceiptHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { batchId } = req.params;
    const { receivedQuantity, note } = confirmReceiptSchema.parse(req.body);

    const ngoId = req.user?.ngo;
    if (!ngoId && req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized.' });
    }

    const targetId = (req.query.ngoId as string) || ngoId;
    if (!targetId) return res.status(400).json({ error: 'ngoId required.' });

    const actor = { id: req.user!.id, role: req.user!.role as Role, name: req.user!.email };

    const batch = await batchService.confirmBatchReceipt(batchId, targetId, receivedQuantity, actor, note);
    res.json({ data: batch });
  } catch (error) {
    next(error);
  }
}
