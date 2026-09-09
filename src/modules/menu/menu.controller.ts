import { Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { recordAudit } from '../../utils/audit';
import { imageRef } from '../../utils/imageRef';
import { MenuItem, DEFAULT_CUSTOMER_SHARE_PERCENT } from '../../models';

export const itemSchema = z.object({
  name: z.string().min(2, 'Give the dish a name').max(140),
  description: z.string().max(600).optional(),
  mrpPaise: z.number().int().min(100, 'Minimum ₹1').max(1_000_000),
  customerSharePercent: z.number().int().min(1).max(100).default(DEFAULT_CUSTOMER_SHARE_PERCENT),
  image: imageRef.optional().or(z.literal('')),
  category: z.string().max(60).default('Dosa'),
  isVeg: z.boolean().default(true),
  servingSize: z.string().max(80).optional(),
  isAvailable: z.boolean().default(true),
  isSignature: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
});

export const itemUpdateSchema = itemSchema.partial();

export const listMine = asyncHandler(async (req: Request, res: Response) => {
  const items = await MenuItem.find({ restaurant: req.user!.restaurant })
    .sort({ sortOrder: 1, createdAt: 1 })
    .lean();
  res.json({ success: true, data: { items } });
});

export const createItem = asyncHandler(async (req: Request, res: Response) => {
  const item = await MenuItem.create({
    ...req.body,
    image: req.body.image || undefined,
    restaurant: req.user!.restaurant,
  });
  await recordAudit({
    req,
    action: 'menu_item.create',
    entityType: 'MenuItem',
    entityId: item._id.toString(),
    after: { name: item.name, mrpPaise: item.mrpPaise },
  });
  res.status(201).json({ success: true, data: { item } });
});

export const updateItem = asyncHandler(async (req: Request, res: Response) => {
  const item = await MenuItem.findOneAndUpdate(
    { _id: req.params.id, restaurant: req.user!.restaurant },
    { ...req.body, ...(req.body.image === '' ? { image: undefined } : {}) },
    { new: true, runValidators: true }
  );
  if (!item) throw ApiError.notFound('That dish does not exist.');
  await recordAudit({
    req,
    action: 'menu_item.update',
    entityType: 'MenuItem',
    entityId: item._id.toString(),
    after: req.body,
  });
  res.json({ success: true, data: { item } });
});

export const deleteItem = asyncHandler(async (req: Request, res: Response) => {
  const item = await MenuItem.findOneAndDelete({
    _id: req.params.id,
    restaurant: req.user!.restaurant,
  });
  if (!item) throw ApiError.notFound('That dish does not exist.');
  await recordAudit({
    req,
    action: 'menu_item.delete',
    entityType: 'MenuItem',
    entityId: req.params.id,
    before: { name: item.name },
  });
  res.json({ success: true, data: { deleted: true } });
});
