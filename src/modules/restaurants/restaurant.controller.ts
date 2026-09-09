import { Request, Response } from 'express';
import QRCode from 'qrcode';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { recordAudit } from '../../utils/audit';
import { imageRef } from '../../utils/imageRef';
import { env } from '../../config/env';
import {
  Restaurant,
  MenuItem,
  Donation,
  Ngo,
  RestaurantNgoRelationship,
  DONATION_STATUSES,
} from '../../models';

export const updateProfileSchema = z.object({
  name: z.string().min(2).max(140).optional(),
  tagline: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  phone: z.string().max(20).optional(),
  cuisine: z.array(z.string()).optional(),
  coverImage: imageRef.optional(),
  logoImage: imageRef.optional(),
  isAcceptingDonations: z.boolean().optional(),
});

/** The page a QR code opens. Public, no auth. */
export const getPublicBySlug = asyncHandler(async (req: Request, res: Response) => {
  const restaurant = await Restaurant.findOne({
    slug: req.params.slug,
    approvalStatus: 'approved',
  }).lean();
  if (!restaurant) throw ApiError.notFound('We could not find that restaurant.');

  const items = await MenuItem.find({ restaurant: restaurant._id, isAvailable: true })
    .sort({ isSignature: -1, sortOrder: 1 })
    .lean();

  const partnerships = await RestaurantNgoRelationship.find({
    restaurant: restaurant._id,
    status: 'active',
  })
    .populate({ path: 'ngo', select: 'name slug logoImage mission address beneficiaryFocus stats website' })
    .lean();

  const recent = await Donation.find({ restaurant: restaurant._id, isPaid: true })
    .sort({ createdAt: -1 })
    .limit(6)
    .select('donationId donorSnapshot totalPortions totalFoodValuePaise createdAt status')
    .lean();

  res.json({
    success: true,
    data: {
      restaurant,
      items,
      partners: partnerships.map((p) => p.ngo),
      recentDonations: recent.map((d) => ({
        donationId: d.donationId,
        totalPortions: d.totalPortions,
        totalFoodValuePaise: d.totalFoodValuePaise,
        createdAt: d.createdAt,
        donorSnapshot: {
          name: d.donorSnapshot.isAnonymous ? 'Anonymous' : d.donorSnapshot.name,
          isAnonymous: d.donorSnapshot.isAnonymous,
          message: d.donorSnapshot.message,
        },
      })),
    },
  });
});

/** Resolves a scanned QR token to its restaurant slug. */
export const resolveQr = asyncHandler(async (req: Request, res: Response) => {
  const restaurant = await Restaurant.findOne({ qrToken: req.params.token }).select('slug name');
  if (!restaurant) throw ApiError.notFound('This QR code is not registered with DaanSetu.');
  res.json({ success: true, data: { slug: restaurant.slug, name: restaurant.name } });
});

export const listPublic = asyncHandler(async (_req: Request, res: Response) => {
  const restaurants = await Restaurant.find({ approvalStatus: 'approved' })
    .select(
      'name slug tagline description coverImage logoImage cuisine address stats isAcceptingDonations createdAt'
    )
    .sort({ 'stats.totalPortions': -1 })
    .limit(24)
    .lean();
  res.json({ success: true, data: { restaurants } });
});

export const getMine = asyncHandler(async (req: Request, res: Response) => {
  const restaurant = await Restaurant.findById(req.user!.restaurant).lean();
  if (!restaurant) throw ApiError.notFound('No restaurant is linked to this account.');
  res.json({ success: true, data: { restaurant } });
});

export const updateMine = asyncHandler(async (req: Request, res: Response) => {
  const restaurant = await Restaurant.findByIdAndUpdate(req.user!.restaurant, req.body, {
    new: true,
    runValidators: true,
  });
  if (!restaurant) throw ApiError.notFound('No restaurant is linked to this account.');
  await recordAudit({
    req,
    action: 'restaurant.update',
    entityType: 'Restaurant',
    entityId: restaurant._id.toString(),
    after: req.body,
  });
  res.json({ success: true, data: { restaurant } });
});

export const getQr = asyncHandler(async (req: Request, res: Response) => {
  const restaurant = await Restaurant.findById(req.user!.restaurant).select('qrToken slug name');
  if (!restaurant) throw ApiError.notFound('No restaurant is linked to this account.');

  const url = `${env.appPublicUrl}/restaurant/${restaurant.slug}`;
  const dataUrl = await QRCode.toDataURL(url, {
    width: 900,
    margin: 1,
    errorCorrectionLevel: 'H',
    color: { dark: '#0B3B2E', light: '#FFFFFF' },
  });

  res.json({
    success: true,
    data: { url, qrToken: restaurant.qrToken, dataUrl, restaurantName: restaurant.name },
  });
});

export const listDonations = asyncHandler(async (req: Request, res: Response) => {
  const { status, limit = '50' } = req.query as Record<string, string>;
  const query: Record<string, unknown> = { restaurant: req.user!.restaurant, isPaid: true };
  if (status && status !== 'all') query.status = status;

  const donations = await Donation.find(query)
    .populate({ path: 'ngo', select: 'name slug logoImage address' })
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(limit) || 50, 200))
    .lean();

  res.json({ success: true, data: { donations } });
});

export const analytics = asyncHandler(async (req: Request, res: Response) => {
  const restaurant = await Restaurant.findById(req.user!.restaurant).select('_id');
  if (!restaurant) throw ApiError.notFound('No restaurant is linked to this account.');
  const match = { restaurant: restaurant._id, isPaid: true };

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const since = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000);

  const [totals, today, byStatus, daily, topItems] = await Promise.all([
    Donation.aggregate([
      { $match: match },
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
    Donation.aggregate([
      { $match: { ...match, createdAt: { $gte: startOfDay } } },
      {
        $group: {
          _id: null,
          donations: { $sum: 1 },
          portions: { $sum: '$totalPortions' },
          foodValuePaise: { $sum: '$totalFoodValuePaise' },
        },
      },
    ]),
    Donation.aggregate([{ $match: match }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    Donation.aggregate([
      { $match: { ...match, createdAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          portions: { $sum: '$totalPortions' },
          foodValuePaise: { $sum: '$totalFoodValuePaise' },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Donation.aggregate([
      { $match: match },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.name',
          quantity: { $sum: '$items.quantity' },
          foodValuePaise: { $sum: '$items.lineFoodValuePaise' },
        },
      },
      { $sort: { quantity: -1 } },
      { $limit: 5 },
    ]),
  ]);

  const statusMap = Object.fromEntries(DONATION_STATUSES.map((s) => [s, 0]));
  byStatus.forEach((row) => {
    statusMap[row._id as string] = row.count;
  });

  res.json({
    success: true,
    data: {
      totals: totals[0] ?? {
        donations: 0,
        portions: 0,
        customerPaise: 0,
        restaurantPaise: 0,
        foodValuePaise: 0,
      },
      today: today[0] ?? { donations: 0, portions: 0, foodValuePaise: 0 },
      byStatus: statusMap,
      daily,
      topItems,
    },
  });
});

export const listPartnerNgos = asyncHandler(async (req: Request, res: Response) => {
  const partnerships = await RestaurantNgoRelationship.find({ restaurant: req.user!.restaurant })
    .populate({ path: 'ngo', select: 'name slug logoImage mission address stats dailyCapacity' })
    .lean();
  const available = await Ngo.find({ approvalStatus: 'approved' })
    .select('name slug logoImage mission address stats dailyCapacity')
    .lean();
  res.json({ success: true, data: { partnerships, available } });
});
