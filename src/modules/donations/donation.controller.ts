import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { recordAudit } from '../../utils/audit';
import { Donation, DONATION_STATUSES, IDonation } from '../../models';
import { publicDonorSnapshot } from './donor-privacy';
import * as service from './donation.service';
import { issueOtp, consumeOtp, otpIsDummy } from './donor-history.service';

const POPULATE = [
  { path: 'restaurant', select: 'name slug address logoImage coverImage phone tagline' },
  { path: 'ngo', select: 'name slug logoImage address mission website' },
];

/**
 * The tracking page is public — anyone with the ID can open it — so the donor's
 * contact details and internal references never leave the server with it.
 */
function publicDonation(donation: IDonation & { _id: Types.ObjectId }) {
  return {
    _id: donation._id,
    donationId: donation.donationId,
    restaurant: donation.restaurant,
    ngo: donation.ngo,
    items: donation.items.map((item) => ({
      name: item.name,
      image: item.image,
      quantity: item.quantity,
      mrpPaise: item.mrpPaise,
      customerSharePercent: item.customerSharePercent,
      lineCustomerPaise: item.lineCustomerPaise,
      lineRestaurantPaise: item.lineRestaurantPaise,
      lineFoodValuePaise: item.lineFoodValuePaise,
    })),
    totalPortions: donation.totalPortions,
    customerPaidPaise: donation.customerPaidPaise,
    restaurantContributionPaise: donation.restaurantContributionPaise,
    totalFoodValuePaise: donation.totalFoodValuePaise,
    status: donation.status,
    isPaid: donation.isPaid,
    timestamps_: donation.timestamps_,
    createdAt: donation.createdAt,
    donorSnapshot: publicDonorSnapshot(donation.donorSnapshot),
  };
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
      donation: { donationId: donation.donationId, customerPaidPaise: donation.customerPaidPaise },
      restaurant: { name: restaurant.name, slug: restaurant.slug },
    },
  });
});

/** Public tracking — the donation ID is the key, no account needed. */
export const track = asyncHandler(async (req: Request, res: Response) => {
  const donation = await Donation.findOne({
    donationId: req.params.donationId.trim().toUpperCase(),
  }).populate(POPULATE);
  if (!donation) throw ApiError.notFound('We could not find a donation with that ID.');

  const [timeline, batches] = await Promise.all([
    service.getTimeline(donation._id),
    service.getDonationBatches(donation),
  ]);

  res.json({
    success: true,
    data: {
      donation: publicDonation(donation),
      timeline,
      batches,
      lifecycle: DONATION_STATUSES,
    },
  });
});

/**
 * A donor's own history. Matched on the account that made the donation only —
 * matching on a phone number or email would hand someone else's history to
 * anyone who typed their number, since neither is verified.
 */
export const myDonations = asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await historyFor({ donor: req.user!.id }) });
});

/**
 * A guest donation carries no account, so the mobile number given at checkout
 * is the only handle on it. Handing a history out on a typed number alone
 * would let anyone read anyone's, so the number is proved first: this issues
 * the code, and donorHistory below spends it.
 *
 * The reply says nothing about whether that number has ever donated. Telling
 * an unknown number apart from a known one would turn this into a way to find
 * out who gives.
 */
export const requestHistoryOtp = asyncHandler(async (req: Request, res: Response) => {
  const { phone } = req.body as { phone: string };
  const { code, expiresAt } = await issueOtp(phone);

  res.json({
    success: true,
    data: {
      expiresAt,
      // No SMS provider yet, so the code comes back here instead of to the
      // phone. config/env refuses to boot production without an explicit
      // opt-in, so this cannot go live unnoticed.
      ...(otpIsDummy ? { demoCode: code } : {}),
    },
  });
});

/** Every donation made under a mobile number, once that number is proved. */
export const donorHistory = asyncHandler(async (req: Request, res: Response) => {
  const { phone, code } = req.body as { phone: string; code: string };
  await consumeOtp(phone, code);
  res.json({ success: true, data: await historyFor({ 'donorSnapshot.phone': phone }) });
});

/** The shape both histories return: the donations, newest first, and a tally. */
async function historyFor(match: Record<string, unknown>) {
  const donations = await Donation.find({ ...match, isPaid: true })
    .populate(POPULATE)
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  const totals = donations.reduce(
    (acc, d) => {
      acc.count += 1;
      acc.portions += d.totalPortions;
      acc.customerPaidPaise += d.customerPaidPaise;
      acc.foodValuePaise += d.totalFoodValuePaise;
      if (d.status === 'NGO_CONFIRMED') acc.completed += 1;
      return acc;
    },
    { portions: 0, customerPaidPaise: 0, foodValuePaise: 0, count: 0, completed: 0 }
  );

  return { donations, totals };
}
