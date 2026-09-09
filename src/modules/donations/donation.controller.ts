import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { recordAudit } from '../../utils/audit';
import { Donation, User, DONATION_STATUSES } from '../../models';
import * as service from './donation.service';

const POPULATE = [
  { path: 'restaurant', select: 'name slug city address logoImage coverImage phone tagline' },
  { path: 'ngo', select: 'name slug logoImage address mission website' },
];

async function actorFrom(req: Request) {
  const user = await User.findById(req.user!.id).select('name role');
  if (!user) throw ApiError.unauthorized();
  return { id: user._id.toString(), role: user.role, name: user.name };
}

export const create = asyncHandler(async (req: Request, res: Response) => {
  const { donation, restaurant } = await service.createDonation(req.body, req.user?.id);
  await recordAudit({
    req,
    action: 'donation.create',
    entityType: 'Donation',
    entityId: donation.donationId,
    after: {
      portions: donation.totalPortions,
      customerPaid: donation.customerPaidPaise,
      foodValue: donation.totalFoodValuePaise,
    },
  });
  res.status(201).json({
    success: true,
    data: {
      donation: donation.toObject(),
      restaurant: { name: restaurant.name, slug: restaurant.slug },
    },
  });
});

/** Public tracking — donation id alone is enough, it is unguessable and non-sequential. */
export const track = asyncHandler(async (req: Request, res: Response) => {
  const donation = await Donation.findOne({ donationId: req.params.donationId })
    .populate(POPULATE)
    .lean();
  if (!donation) throw ApiError.notFound('We could not find a donation with that ID.');

  const timeline = await service.getTimeline(donation._id as mongoose.Types.ObjectId);

  res.json({
    success: true,
    data: {
      donation: {
        ...donation,
        // The tracking page is public — the donor's contact details never leave
        // the server with it.
        donorSnapshot: {
          name: donation.donorSnapshot.isAnonymous
            ? 'Anonymous donor'
            : donation.donorSnapshot.name,
          isAnonymous: donation.donorSnapshot.isAnonymous,
          message: donation.donorSnapshot.message,
        },
      },
      timeline,
      lifecycle: DONATION_STATUSES,
    },
  });
});

export const myDonations = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findById(req.user!.id).select('email phone');
  const match: Record<string, unknown>[] = [{ donor: req.user!.id }];
  if (user?.email) match.push({ 'donorSnapshot.email': user.email });
  if (user?.phone) match.push({ 'donorSnapshot.phone': user.phone });

  const donations = await Donation.find({ $or: match })
    .populate(POPULATE)
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  const totals = donations.reduce(
    (acc, d) => {
      if (!d.isPaid) return acc;
      acc.portions += d.totalPortions;
      acc.customerPaidPaise += d.customerPaidPaise;
      acc.foodValuePaise += d.totalFoodValuePaise;
      acc.count += 1;
      if (d.status === 'NGO_CONFIRMED') acc.completed += 1;
      return acc;
    },
    { portions: 0, customerPaidPaise: 0, foodValuePaise: 0, count: 0, completed: 0 }
  );

  res.json({ success: true, data: { donations, totals } });
});

export const advance = asyncHandler(async (req: Request, res: Response) => {
  const actor = await actorFrom(req);
  const before = await Donation.findOne({ donationId: req.params.donationId }).select('status');

  const donation = await service.advanceStatus(
    req.params.donationId,
    req.body.status,
    actor,
    req.body.note
  );

  await recordAudit({
    req,
    action: 'donation.status_change',
    entityType: 'Donation',
    entityId: donation.donationId,
    before: { status: before?.status },
    after: { status: donation.status },
  });

  res.json({ success: true, data: { donation } });
});

export const confirmByNgo = asyncHandler(async (req: Request, res: Response) => {
  const actor = await actorFrom(req);
  const donation = await service.ngoConfirm(
    req.params.donationId,
    req.body.portionsReceived,
    actor,
    req.body.note
  );
  await recordAudit({
    req,
    action: 'donation.ngo_confirm',
    entityType: 'Donation',
    entityId: donation.donationId,
    after: { portionsReceived: donation.portionsReceived },
  });
  res.json({ success: true, data: { donation } });
});

export const assignNgo = asyncHandler(async (req: Request, res: Response) => {
  const donation = await service.assignNgo(req.params.donationId, req.body.ngoId);
  await recordAudit({
    req,
    action: 'donation.assign_ngo',
    entityType: 'Donation',
    entityId: donation.donationId,
    after: { ngo: req.body.ngoId },
  });
  res.json({ success: true, data: { donation } });
});
