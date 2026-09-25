import { Request, Response } from 'express';
import mongoose from 'mongoose';
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
  APPROVAL_STATUSES,
} from '../../models';

export const approvalSchema = z.object({
  approvalStatus: z.enum(APPROVAL_STATUSES),
  note: z.string().max(500).optional(),
});

export const resolveDiscrepancySchema = z.object({
  resolutionNote: z.string().min(5, 'Describe how this was resolved').max(800),
});

export const overview = asyncHandler(async (_req: Request, res: Response) => {
  const [
    restaurantCount,
    pendingRestaurants,
    ngoCount,
    pendingNgos,
    userCount,
    donationAgg,
    discrepancies,
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
    Donation.countDocuments({ 'discrepancy.hasDiscrepancy': true, 'discrepancy.resolvedAt': null }),
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

  const byStatus = await Donation.aggregate([
    { $match: { isPaid: true } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);

  res.json({
    success: true,
    data: {
      counts: {
        restaurants: restaurantCount,
        pendingRestaurants,
        ngos: ngoCount,
        pendingNgos,
        users: userCount,
        openDiscrepancies: discrepancies,
      },
      totals: donationAgg[0] ?? {
        donations: 0,
        portions: 0,
        customerPaise: 0,
        restaurantPaise: 0,
        foodValuePaise: 0,
      },
      daily,
      byStatus: Object.fromEntries(byStatus.map((r) => [r._id, r.count])),
    },
  });
});

export const listRestaurants = asyncHandler(async (req: Request, res: Response) => {
  const { status } = req.query as Record<string, string>;
  const query = status && status !== 'all' ? { approvalStatus: status } : {};
  const restaurants = await Restaurant.find(query).sort({ createdAt: -1 }).limit(200).lean();
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
  const { status } = req.query as Record<string, string>;
  const query = status && status !== 'all' ? { approvalStatus: status } : {};
  const ngos = await Ngo.find(query).sort({ createdAt: -1 }).limit(200).lean();
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

export const listUsers = asyncHandler(async (req: Request, res: Response) => {
  const { role, q } = req.query as Record<string, string>;
  const query: Record<string, unknown> = {};
  if (role && role !== 'all') query.role = role;
  if (q) query.$or = [{ name: new RegExp(q, 'i') }, { email: new RegExp(q, 'i') }];
  const users = await User.find(query).sort({ createdAt: -1 }).limit(200).lean();
  res.json({ success: true, data: { users } });
});

export const listDonations = asyncHandler(async (req: Request, res: Response) => {
  const { status, flagged } = req.query as Record<string, string>;
  const query: Record<string, unknown> = { isPaid: true };
  if (status && status !== 'all') query.status = status;
  if (flagged === 'true') query['discrepancy.hasDiscrepancy'] = true;

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
    .populate({ path: 'donation', select: 'donationId customerPaidPaise donorSnapshot.name status' })
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
  res.json({ success: true, data: { payments } });
});

export const resolveDiscrepancy = asyncHandler(async (req: Request, res: Response) => {
  const batch = await Batch.findOne({ batchId: req.params.batchId });
  if (!batch) throw ApiError.notFound('Batch not found.');
  if (batch.status !== 'RECONCILIATION_REQUIRED') {
    throw ApiError.badRequest('This batch has no open discrepancy.');
  }
  
  batch.resolution = {
    note: req.body.resolutionNote,
    resolvedBy: new mongoose.Types.ObjectId(req.user!.id),
    resolvedAt: new Date()
  };
  batch.status = 'COMPLETED';
  await batch.save();

  await recordAudit({
    req,
    action: 'discrepancy.resolve',
    entityType: 'Batch',
    entityId: batch.batchId,
    after: { resolutionNote: req.body.resolutionNote, status: 'COMPLETED' },
  });
  res.json({ success: true, data: { batch } });
});

export const listAuditLogs = asyncHandler(async (req: Request, res: Response) => {
  const { entityType, action } = req.query as Record<string, string>;
  const query: Record<string, unknown> = {};
  if (entityType && entityType !== 'all') query.entityType = entityType;
  if (action) query.action = new RegExp(action, 'i');
  const logs = await AuditLog.find(query).sort({ createdAt: -1 }).limit(200).lean();
  res.json({ success: true, data: { logs } });
});
