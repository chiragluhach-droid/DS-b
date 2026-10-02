import { Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { recordAudit } from '../../utils/audit';
import {
  Restaurant,
  Ngo,
  User,
  Donation,
  Payment,
  AuditLog,
  Batch,
  MenuItem,
  APPROVAL_STATUSES,
  DONATION_STATUSES,
  BATCH_STATUSES,
} from '../../models';
import * as batchService from '../batches/batch.service';

export const approvalSchema = z.object({
  approvalStatus: z.enum(APPROVAL_STATUSES),
  note: z.string().trim().max(500).optional(),
});

export const resolveBatchSchema = z.object({
  resolutionNote: z.string().trim().min(5, 'Describe how this was resolved').max(800),
});

export const userStateSchema = z.object({
  isActive: z.boolean(),
});

export const pilotItemSchema = z.object({
  activeForDonation: z.boolean(),
});

/** Escapes a user-typed search term so it is matched literally, not as a pattern. */
function searchRegex(term: string): RegExp {
  return new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}

function approvalFilter(status?: string): Record<string, unknown> {
  if (!status || status === 'all') return {};
  if (!(APPROVAL_STATUSES as readonly string[]).includes(status)) {
    throw ApiError.badRequest('Unknown approval status filter.');
  }
  return { approvalStatus: status };
}

export const overview = asyncHandler(async (_req: Request, res: Response) => {
  const [
    restaurantCount,
    pendingRestaurants,
    ngoCount,
    pendingNgos,
    userCount,
    donationAgg,
    batches,
  ] = await Promise.all([
    Restaurant.countDocuments({ approvalStatus: 'approved' }),
    Restaurant.countDocuments({ approvalStatus: 'pending' }),
    Ngo.countDocuments({ approvalStatus: 'approved' }),
    Ngo.countDocuments({ approvalStatus: 'pending' }),
    User.countDocuments({}),
    Donation.aggregate([
      { $match: { isPaid: true } },
      {
        $group: {
          _id: null,
          donations: { $sum: 1 },
          portions: { $sum: '$totalPortions' },
          customerPaise: { $sum: '$customerPaidPaise' },
          restaurantPaise: { $sum: '$restaurantContributionPaise' },
          foodValuePaise: { $sum: '$totalFoodValuePaise' },
        },
      },
    ]),
    batchService.batchSummary({}),
  ]);

  const since = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000);
  const daily = await Donation.aggregate([
    { $match: { isPaid: true, createdAt: { $gte: since } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        portions: { $sum: '$totalPortions' },
        foodValuePaise: { $sum: '$totalFoodValuePaise' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const byStatusRows = await Donation.aggregate([
    { $match: { isPaid: true } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);

  const byStatus = Object.fromEntries(DONATION_STATUSES.map((s) => [s, 0]));
  byStatusRows.forEach((row) => {
    byStatus[row._id as string] = row.count;
  });

  res.json({
    success: true,
    data: {
      counts: {
        restaurants: restaurantCount,
        pendingRestaurants,
        ngos: ngoCount,
        pendingNgos,
        users: userCount,
        openDiscrepancies: batches.flagged,
      },
      totals: donationAgg[0] ?? {
        donations: 0,
        portions: 0,
        customerPaise: 0,
        restaurantPaise: 0,
        foodValuePaise: 0,
      },
      daily,
      byStatus,
      batches,
    },
  });
});

export const listRestaurants = asyncHandler(async (req: Request, res: Response) => {
  const restaurants = await Restaurant.find(approvalFilter(req.query.status as string))
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
  res.json({ success: true, data: { restaurants } });
});

export const setRestaurantApproval = asyncHandler(async (req: Request, res: Response) => {
  const before = await Restaurant.findById(req.params.id).select('approvalStatus').lean();
  const restaurant = await Restaurant.findByIdAndUpdate(
    req.params.id,
    { approvalStatus: req.body.approvalStatus },
    { new: true }
  );
  if (!restaurant) throw ApiError.notFound('Restaurant not found.');
  await recordAudit({
    req,
    action: `restaurant.${req.body.approvalStatus}`,
    entityType: 'Restaurant',
    entityId: restaurant._id.toString(),
    before: before ?? undefined,
    after: { approvalStatus: restaurant.approvalStatus, note: req.body.note },
  });
  res.json({ success: true, data: { restaurant } });
});

export const listNgos = asyncHandler(async (req: Request, res: Response) => {
  const ngos = await Ngo.find(approvalFilter(req.query.status as string))
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
  res.json({ success: true, data: { ngos } });
});

export const setNgoApproval = asyncHandler(async (req: Request, res: Response) => {
  const before = await Ngo.findById(req.params.id).select('approvalStatus').lean();
  const ngo = await Ngo.findByIdAndUpdate(
    req.params.id,
    { approvalStatus: req.body.approvalStatus },
    { new: true }
  );
  if (!ngo) throw ApiError.notFound('NGO not found.');
  await recordAudit({
    req,
    action: `ngo.${req.body.approvalStatus}`,
    entityType: 'Ngo',
    entityId: ngo._id.toString(),
    before: before ?? undefined,
    after: { approvalStatus: ngo.approvalStatus, note: req.body.note },
  });
  res.json({ success: true, data: { ngo } });
});

/** Every dish a kitchen offers, with whether it is approved for the pilot. */
export const listRestaurantMenu = asyncHandler(async (req: Request, res: Response) => {
  const items = await MenuItem.find({ restaurant: req.params.id })
    .select('name category mrpPaise batchTarget isAvailable activeForDonation sortOrder')
    .sort({ sortOrder: 1, name: 1 })
    .lean();
  res.json({ success: true, data: { items } });
});

export const setItemPilotState = asyncHandler(async (req: Request, res: Response) => {
  const item = await MenuItem.findByIdAndUpdate(
    req.params.itemId,
    { activeForDonation: req.body.activeForDonation },
    { new: true }
  ).select('name activeForDonation restaurant');
  if (!item) throw ApiError.notFound('That dish does not exist.');

  await recordAudit({
    req,
    action: req.body.activeForDonation ? 'menu_item.pilot_added' : 'menu_item.pilot_removed',
    entityType: 'MenuItem',
    entityId: item._id.toString(),
    after: { name: item.name, activeForDonation: item.activeForDonation },
  });

  res.json({ success: true, data: { item } });
});

export const listUsers = asyncHandler(async (req: Request, res: Response) => {
  const { role, q } = req.query as Record<string, string>;
  const query: Record<string, unknown> = {};
  if (role && role !== 'all') query.role = role;
  if (q) {
    const term = searchRegex(q);
    query.$or = [{ name: term }, { email: term }];
  }
  const users = await User.find(query)
    .select('name email phone role isActive isGuest lastLoginAt createdAt restaurant ngo')
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
  res.json({ success: true, data: { users } });
});

/** Deactivating an account ends its session on the next request it makes. */
export const setUserState = asyncHandler(async (req: Request, res: Response) => {
  if (req.params.id === req.user!.id) {
    throw ApiError.badRequest('You cannot deactivate your own account.');
  }
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { isActive: req.body.isActive },
    { new: true }
  ).select('name email role isActive');
  if (!user) throw ApiError.notFound('Account not found.');

  await recordAudit({
    req,
    action: req.body.isActive ? 'user.reactivated' : 'user.deactivated',
    entityType: 'User',
    entityId: user._id.toString(),
    after: { isActive: user.isActive },
  });
  res.json({ success: true, data: { user } });
});

export const listDonations = asyncHandler(async (req: Request, res: Response) => {
  const { status } = req.query as Record<string, string>;
  const query: Record<string, unknown> = { isPaid: true };
  if (status && status !== 'all') {
    if (!(DONATION_STATUSES as readonly string[]).includes(status)) {
      throw ApiError.badRequest('Unknown donation status filter.');
    }
    query.status = status;
  }

  const donations = await Donation.find(query)
    .populate({ path: 'restaurant', select: 'name slug' })
    .populate({ path: 'ngo', select: 'name slug' })
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
  res.json({ success: true, data: { donations } });
});

export const listPayments = asyncHandler(async (_req: Request, res: Response) => {
  const payments = await Payment.find({})
    .select('-rawPayload -signature')
    .populate({ path: 'donation', select: 'donationId customerPaidPaise donorSnapshot.name status' })
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
  res.json({ success: true, data: { payments } });
});

/** Batches across the platform, flagged ones first when no filter is given. */
export const listBatches = asyncHandler(async (req: Request, res: Response) => {
  const { status } = req.query as Record<string, string>;
  if (status && status !== 'all' && !(BATCH_STATUSES as readonly string[]).includes(status)) {
    throw ApiError.badRequest('Unknown batch status filter.');
  }

  const batches = await Batch.find(status && status !== 'all' ? { status } : {})
    .populate({ path: 'restaurant', select: 'name slug' })
    .populate({ path: 'ngo', select: 'name slug' })
    .sort({ status: 1, createdAt: -1 })
    .limit(200)
    .lean();

  res.json({ success: true, data: { batches } });
});

export const resolveBatch = asyncHandler(async (req: Request, res: Response) => {
  const batch = await batchService.resolveBatch(req.params.batchId, req.body.resolutionNote, {
    id: req.user!.id,
    role: req.user!.role,
    name: req.user!.name,
  });

  await recordAudit({
    req,
    action: 'batch.discrepancy_resolved',
    entityType: 'Batch',
    entityId: batch.batchId,
    after: { resolutionNote: req.body.resolutionNote },
  });

  res.json({ success: true, data: { batch } });
});

export const listAuditLogs = asyncHandler(async (req: Request, res: Response) => {
  const { entityType, action } = req.query as Record<string, string>;
  const query: Record<string, unknown> = {};
  if (entityType && entityType !== 'all') query.entityType = entityType;
  if (action) query.action = searchRegex(action);
  const logs = await AuditLog.find(query).sort({ createdAt: -1 }).limit(200).lean();
  res.json({ success: true, data: { logs } });
});
