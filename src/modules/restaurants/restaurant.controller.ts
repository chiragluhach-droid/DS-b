import { Request, Response } from 'express';
import QRCode from 'qrcode';
import { Types } from 'mongoose';
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
  Batch,
  RestaurantNgoRelationship,
  DONATION_STATUSES,
} from '../../models';
import { batchSummary } from '../batches/batch.service';
import { assignPendingDonations } from '../donations/donation.service';

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(140).optional(),
  tagline: z.string().trim().max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  phone: z.string().trim().max(20).optional(),
  cuisine: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  coverImage: imageRef.optional(),
  logoImage: imageRef.optional(),
  isAcceptingDonations: z.boolean().optional(),
});

export const partnerSchema = z.object({
  ngoId: z.string().trim().regex(/^[0-9a-fA-F]{24}$/, 'Choose an NGO from the list'),
  isPrimary: z.boolean().default(false),
  note: z.string().trim().max(500).optional(),
});

export const partnerUpdateSchema = z.object({
  status: z.enum(['active', 'paused', 'ended']).optional(),
  isPrimary: z.boolean().optional(),
  note: z.string().trim().max(500).optional(),
});

/** The restaurant linked to the signed-in account. */
function ownRestaurantId(req: Request): string {
  const id = req.user!.restaurant;
  if (!id) throw ApiError.forbidden('This account is not linked to a restaurant yet.');
  return id;
}

function donationStatusFilter(status?: string): Record<string, unknown> {
  if (!status || status === 'all') return {};
  if (!(DONATION_STATUSES as readonly string[]).includes(status)) {
    throw ApiError.badRequest('Unknown donation status filter.');
  }
  return { status };
}

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

  // Primary partner first — it is the NGO this kitchen's food actually goes to.
  const partnerships = await RestaurantNgoRelationship.find({
    restaurant: restaurant._id,
    status: 'active',
  })
    .sort({ isPrimary: -1, createdAt: 1 })
    .populate({
      path: 'ngo',
      select: 'name slug logoImage mission address beneficiaryFocus stats website',
    })
    .lean();

  const recent = await Donation.find({ restaurant: restaurant._id, isPaid: true })
    .sort({ createdAt: -1 })
    .limit(6)
    .select('donorSnapshot totalPortions totalFoodValuePaise createdAt')
    .lean();

  // How full each dish's current batch is — a guest can see they are completing
  // someone else's batch rather than starting from nothing.
  const activeBatches = await Batch.find({
    restaurant: restaurant._id,
    status: 'IN_PROGRESS',
  })
    .select('batchId menuItem itemName targetQuantity collectedQuantity')
    .sort({ collectedQuantity: -1 })
    .lean();

  res.json({
    success: true,
    data: {
      restaurant,
      items,
      partners: partnerships.map((p) => p.ngo).filter(Boolean),
      activeBatches: activeBatches.map((b) => ({
        batchId: b.batchId,
        menuItem: b.menuItem.toString(),
        itemName: b.itemName,
        targetQuantity: b.targetQuantity,
        collectedQuantity: b.collectedQuantity,
      })),
      // A public wall of thanks: no donation IDs, since an ID is the key to a
      // donation's tracking page.
      recentDonations: recent.map((d) => ({
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
  const restaurant = await Restaurant.findById(ownRestaurantId(req)).lean();
  if (!restaurant) throw ApiError.notFound('No restaurant is linked to this account.');
  res.json({ success: true, data: { restaurant } });
});

export const updateMine = asyncHandler(async (req: Request, res: Response) => {
  const restaurant = await Restaurant.findByIdAndUpdate(ownRestaurantId(req), req.body, {
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
  const restaurant = await Restaurant.findById(ownRestaurantId(req)).select('qrToken slug name');
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

  const donations = await Donation.find({
    restaurant: ownRestaurantId(req),
    isPaid: true,
    ...donationStatusFilter(status),
  })
    .populate({ path: 'ngo', select: 'name slug logoImage address' })
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(limit) || 50, 200))
    .lean();

  res.json({ success: true, data: { donations } });
});

export const analytics = asyncHandler(async (req: Request, res: Response) => {
  const restaurantId = new Types.ObjectId(ownRestaurantId(req));
  const match = { restaurant: restaurantId, isPaid: true };

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const since = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000);

  const [totals, today, byStatus, daily, topItems, batches] = await Promise.all([
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
    batchSummary({ restaurant: restaurantId }),
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
      batches,
    },
  });
});

export const listPartnerNgos = asyncHandler(async (req: Request, res: Response) => {
  const partnerships = await RestaurantNgoRelationship.find({ restaurant: ownRestaurantId(req) })
    .populate({ path: 'ngo', select: 'name slug logoImage mission address stats dailyCapacity' })
    .sort({ isPrimary: -1, createdAt: 1 })
    .lean();

  const available = await Ngo.find({
    approvalStatus: 'approved',
    _id: { $nin: partnerships.map((p) => p.ngo) },
  })
    .select('name slug logoImage mission address stats dailyCapacity')
    .lean();

  res.json({ success: true, data: { partnerships, available } });
});

/**
 * Choosing an NGO partner. The first partner a kitchen adds becomes its primary,
 * which is where its donations are routed — and any donation that was paid for
 * before a partner existed is placed into a batch now.
 */
export const addPartner = asyncHandler(async (req: Request, res: Response) => {
  const restaurantId = ownRestaurantId(req);
  const ngo = await Ngo.findById(req.body.ngoId).select('name approvalStatus');
  if (!ngo) throw ApiError.notFound('NGO not found.');
  if (ngo.approvalStatus !== 'approved') {
    throw ApiError.badRequest('That NGO is not approved on DaanSetu yet.');
  }

  const existing = await RestaurantNgoRelationship.findOne({
    restaurant: restaurantId,
    ngo: ngo._id,
  });
  if (existing) throw ApiError.conflict(`${ngo.name} is already one of your partners.`);

  const isFirst = (await RestaurantNgoRelationship.countDocuments({ restaurant: restaurantId })) === 0;
  const isPrimary = req.body.isPrimary || isFirst;

  if (isPrimary) {
    await RestaurantNgoRelationship.updateMany(
      { restaurant: restaurantId },
      { $set: { isPrimary: false } }
    );
  }

  const relationship = await RestaurantNgoRelationship.create({
    restaurant: restaurantId,
    ngo: ngo._id,
    status: 'active',
    isPrimary,
    note: req.body.note,
  });

  const assigned = await assignPendingDonations(new Types.ObjectId(restaurantId));

  await recordAudit({
    req,
    action: 'restaurant.partner_added',
    entityType: 'RestaurantNgoRelationship',
    entityId: relationship._id.toString(),
    after: { ngo: ngo.name, isPrimary, backlogAssigned: assigned },
  });

  res.status(201).json({ success: true, data: { relationship, backlogAssigned: assigned } });
});

export const updatePartner = asyncHandler(async (req: Request, res: Response) => {
  const restaurantId = ownRestaurantId(req);
  const { status, isPrimary, note } = req.body as {
    status?: 'active' | 'paused' | 'ended';
    isPrimary?: boolean;
    note?: string;
  };

  if (isPrimary) {
    await RestaurantNgoRelationship.updateMany(
      { restaurant: restaurantId },
      { $set: { isPrimary: false } }
    );
  }

  const relationship = await RestaurantNgoRelationship.findOneAndUpdate(
    { restaurant: restaurantId, ngo: req.params.ngoId },
    {
      ...(status ? { status } : {}),
      ...(isPrimary === undefined ? {} : { isPrimary }),
      ...(note === undefined ? {} : { note }),
    },
    { new: true }
  ).populate({ path: 'ngo', select: 'name' });

  if (!relationship) throw ApiError.notFound('That partnership does not exist.');

  // Making a partner primary, or bringing one back, can clear a waiting backlog.
  const assigned =
    isPrimary || status === 'active' ? await assignPendingDonations(new Types.ObjectId(restaurantId)) : 0;

  await recordAudit({
    req,
    action: 'restaurant.partner_updated',
    entityType: 'RestaurantNgoRelationship',
    entityId: relationship._id.toString(),
    after: { status, isPrimary, backlogAssigned: assigned },
  });

  res.json({ success: true, data: { relationship, backlogAssigned: assigned } });
});
