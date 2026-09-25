import { Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { recordAudit } from '../../utils/audit';
import { imageRef } from '../../utils/imageRef';
import { Ngo, Donation, RestaurantNgoRelationship } from '../../models';

export const updateNgoSchema = z.object({
  name: z.string().min(2).max(140).optional(),
  mission: z.string().max(2000).optional(),
  website: z.string().url('Enter a full URL including https://').optional().or(z.literal('')),
  phone: z.string().max(20).optional(),
  dailyCapacity: z.number().int().min(1).max(100000).optional(),
  beneficiaryFocus: z.array(z.string().max(60)).max(10).optional(),
  logoImage: imageRef.optional(),
  coverImage: imageRef.optional(),
});

export const listPublic = asyncHandler(async (_req: Request, res: Response) => {
  const ngos = await Ngo.find({ approvalStatus: 'approved' })
    .select('name slug mission logoImage coverImage address beneficiaryFocus stats dailyCapacity website')
    .sort({ 'stats.portionsReceived': -1 })
    .lean();
  res.json({ success: true, data: { ngos } });
});

export const getMine = asyncHandler(async (req: Request, res: Response) => {
  const ngo = await Ngo.findById(req.user!.ngo).lean();
  if (!ngo) throw ApiError.notFound('No NGO is linked to this account.');
  res.json({ success: true, data: { ngo } });
});

export const updateMine = asyncHandler(async (req: Request, res: Response) => {
  const ngo = await Ngo.findByIdAndUpdate(req.user!.ngo, req.body, { new: true, runValidators: true });
  if (!ngo) throw ApiError.notFound('No NGO is linked to this account.');
  await recordAudit({ req, action: 'ngo.update', entityType: 'Ngo', entityId: ngo._id.toString() });
  res.json({ success: true, data: { ngo } });
});

export const incomingDonations = asyncHandler(async (req: Request, res: Response) => {
  const { status } = req.query as Record<string, string>;
  const query: Record<string, unknown> = { ngo: req.user!.ngo, isPaid: true };
  if (status && status !== 'all') query.status = status;

  const donations = await Donation.find(query)
    .populate({ path: 'restaurant', select: 'name slug logoImage address phone coverImage' })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  const open = donations.filter((d) => d.status === 'ASSIGNED_TO_BATCH');
  const summary = {
    awaitingConfirmation: 0,
    beingPrepared: donations.filter((d) => d.status === 'ASSIGNED_TO_BATCH').length,
    portionsExpected: open.reduce((sum, d) => sum + d.totalPortions, 0),
    foodValueExpectedPaise: open.reduce((sum, d) => sum + d.totalFoodValuePaise, 0),
  };

  res.json({ success: true, data: { donations, summary } });
});

export const partners = asyncHandler(async (req: Request, res: Response) => {
  const relationships = await RestaurantNgoRelationship.find({ ngo: req.user!.ngo })
    .populate({ path: 'restaurant', select: 'name slug logoImage address stats' })
    .lean();
  res.json({ success: true, data: { relationships } });
});
