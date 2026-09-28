import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { recordAudit } from '../../utils/audit';
import { imageRef } from '../../utils/imageRef';
import { Ngo, Donation, RestaurantNgoRelationship, DONATION_STATUSES } from '../../models';
import { batchSummary } from '../batches/batch.service';

export const updateNgoSchema = z.object({
  name: z.string().trim().min(2).max(140).optional(),
  mission: z.string().trim().max(2000).optional(),
  website: z.string().trim().url('Enter a full URL including https://').optional().or(z.literal('')),
  phone: z.string().trim().max(20).optional(),
  dailyCapacity: z.number().int().min(1).max(100000).optional(),
  beneficiaryFocus: z.array(z.string().trim().min(1).max(60)).max(10).optional(),
  logoImage: imageRef.optional(),
  coverImage: imageRef.optional(),
});

/** The NGO linked to the signed-in account. */
function ownNgoId(req: Request): string {
  const id = req.user!.ngo;
  if (!id) throw ApiError.forbidden('This account is not linked to an NGO yet.');
  return id;
}

export const listPublic = asyncHandler(async (_req: Request, res: Response) => {
  const ngos = await Ngo.find({ approvalStatus: 'approved' })
    .select(
      'name slug mission logoImage coverImage address beneficiaryFocus stats dailyCapacity website'
    )
    .sort({ 'stats.portionsReceived': -1 })
    .lean();
  res.json({ success: true, data: { ngos } });
});

export const getMine = asyncHandler(async (req: Request, res: Response) => {
  const ngo = await Ngo.findById(ownNgoId(req)).lean();
  if (!ngo) throw ApiError.notFound('No NGO is linked to this account.');
  res.json({ success: true, data: { ngo } });
});

export const updateMine = asyncHandler(async (req: Request, res: Response) => {
  const ngo = await Ngo.findByIdAndUpdate(ownNgoId(req), req.body, {
    new: true,
    runValidators: true,
  });
  if (!ngo) throw ApiError.notFound('No NGO is linked to this account.');
  await recordAudit({ req, action: 'ngo.update', entityType: 'Ngo', entityId: ngo._id.toString() });
  res.json({ success: true, data: { ngo } });
});

/**
 * Every donation routed to this NGO. The batches endpoint is what the NGO acts
 * on; this is the record of the individual gifts behind those batches.
 */
export const incomingDonations = asyncHandler(async (req: Request, res: Response) => {
  const { status } = req.query as Record<string, string>;
  const ngoId = ownNgoId(req);

  const filter: Record<string, unknown> = { ngo: ngoId, isPaid: true };
  if (status && status !== 'all') {
    if (!(DONATION_STATUSES as readonly string[]).includes(status)) {
      throw ApiError.badRequest('Unknown donation status filter.');
    }
    filter.status = status;
  }

  const donations = await Donation.find(filter)
    .populate({ path: 'restaurant', select: 'name slug logoImage address phone coverImage' })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  const batches = await batchSummary({ ngo: new Types.ObjectId(ngoId) });

  const onTheWay = donations.filter((d) => d.status === 'DISPATCHED');
  const inKitchen = donations.filter((d) => d.status === 'ASSIGNED_TO_BATCH');

  res.json({
    success: true,
    data: {
      donations,
      summary: {
        // Batches sitting with this NGO, waiting to be counted.
        awaitingConfirmation: batches.inTransit,
        flagged: batches.flagged,
        beingPrepared: inKitchen.length,
        portionsExpected: [...onTheWay, ...inKitchen].reduce((sum, d) => sum + d.totalPortions, 0),
        portionsOnTheWay: batches.portionsInTransit,
        foodValueExpectedPaise: [...onTheWay, ...inKitchen].reduce(
          (sum, d) => sum + d.totalFoodValuePaise,
          0
        ),
      },
    },
  });
});

export const partners = asyncHandler(async (req: Request, res: Response) => {
  const relationships = await RestaurantNgoRelationship.find({ ngo: ownNgoId(req) })
    .populate({ path: 'restaurant', select: 'name slug logoImage address stats' })
    .sort({ isPrimary: -1, createdAt: 1 })
    .lean();
  res.json({ success: true, data: { relationships } });
});
