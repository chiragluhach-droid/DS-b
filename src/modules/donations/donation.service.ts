import mongoose from 'mongoose';
import {
  Donation,
  DonationEvent,
  MenuItem,
  Restaurant,
  Ngo,
  RestaurantNgoRelationship,
  IDonation,
  IDonationItemSnapshot,
  DONATION_STATUSES,
  DonationStatus,
  AnyDonationStatus,
  STATUS_ACTOR,
  splitPrice,
  Role,
} from '../../models';
import { ApiError } from '../../utils/ApiError';
import { generateDonationId } from '../../utils/ids';
import { CreateDonationInput } from './donation.schema';

const STATUS_INDEX = new Map<string, number>(DONATION_STATUSES.map((s, i) => [s, i]));

const EVENT_COPY: Record<DonationStatus, { title: string; note: string }> = {
  DONATED: {
    title: 'Donation received',
    note: 'Your contribution was received and the restaurant has been notified.',
  },
  HANDED_OVER: {
    title: 'Handed over to NGO',
    note: 'The kitchen cooked your dishes and handed them to the NGO.',
  },
  NGO_CONFIRMED: {
    title: 'Confirmed by NGO',
    note: 'The NGO verified what they received. Your donation is complete.',
  },
};

/**
 * A donation may only move forward one step at a time, and only by a role
 * permitted to make that particular move.
 */
export function assertValidTransition(
  current: AnyDonationStatus,
  next: DonationStatus,
  role: Role
): void {
  if (current === 'CANCELLED' || current === 'REFUNDED') {
    throw ApiError.badRequest(`This donation is ${current.toLowerCase()} and can no longer change.`);
  }
  const currentIdx = STATUS_INDEX.get(current);
  const nextIdx = STATUS_INDEX.get(next);
  if (currentIdx === undefined || nextIdx === undefined) {
    throw ApiError.badRequest('Unknown donation status.');
  }
  if (nextIdx <= currentIdx) {
    throw ApiError.badRequest('A donation can never move backwards in its lifecycle.');
  }
  if (nextIdx !== currentIdx + 1) {
    throw ApiError.badRequest(
      `The next step for this donation is "${DONATION_STATUSES[currentIdx + 1]}", not "${next}".`
    );
  }
  if (!STATUS_ACTOR[next].includes(role)) {
    throw ApiError.forbidden(`A ${role} cannot move a donation to ${next}.`);
  }
}

interface AppendEventArgs {
  donation: IDonation;
  status: AnyDonationStatus;
  note?: string;
  actorId?: string;
  actorRole?: Role | 'system';
  actorName?: string;
  metadata?: Record<string, unknown>;
}

export async function appendEvent({
  donation,
  status,
  note,
  actorId,
  actorRole = 'system',
  actorName = 'DaanSetu',
  metadata,
}: AppendEventArgs) {
  const copy = EVENT_COPY[status as DonationStatus];
  return DonationEvent.create({
    donation: donation._id,
    status,
    title: copy?.title ?? status,
    note: note ?? copy?.note,
    actor: actorId,
    actorRole,
    actorName,
    metadata,
  });
}

export async function createDonation(input: CreateDonationInput, donorUserId?: string) {
  const restaurant = await Restaurant.findOne({ slug: input.restaurantSlug });
  if (!restaurant) throw ApiError.notFound('We could not find that restaurant.');
  if (restaurant.approvalStatus !== 'approved') {
    throw ApiError.badRequest('This restaurant is not yet live on DaanSetu.');
  }
  if (!restaurant.isAcceptingDonations) {
    throw ApiError.badRequest('This restaurant has paused donations for now.');
  }

  const itemIds = input.items.map((i) => i.menuItemId);
  const menuItems = await MenuItem.find({
    _id: { $in: itemIds },
    restaurant: restaurant._id,
    isAvailable: true,
  });

  if (menuItems.length !== new Set(itemIds).size) {
    throw ApiError.badRequest('One of the dishes you selected is no longer available.');
  }

  const byId = new Map(menuItems.map((m) => [m._id.toString(), m]));

  // Prices and the split come from the database, never from the client.
  const snapshots: IDonationItemSnapshot[] = input.items.map((line) => {
    const item = byId.get(line.menuItemId)!;
    const { customerPaysPaise, restaurantPaysPaise } = splitPrice(
      item.mrpPaise,
      item.customerSharePercent
    );
    return {
      menuItem: item._id,
      name: item.name,
      image: item.image,
      quantity: line.quantity,
      mrpPaise: item.mrpPaise,
      customerSharePercent: item.customerSharePercent,
      customerPaysPaise,
      restaurantPaysPaise,
      lineCustomerPaise: customerPaysPaise * line.quantity,
      lineRestaurantPaise: restaurantPaysPaise * line.quantity,
      lineFoodValuePaise: item.mrpPaise * line.quantity,
    };
  });

  const totalPortions = snapshots.reduce((sum, s) => sum + s.quantity, 0);
  const customerPaidPaise = snapshots.reduce((sum, s) => sum + s.lineCustomerPaise, 0);
  const restaurantContributionPaise = snapshots.reduce((sum, s) => sum + s.lineRestaurantPaise, 0);
  const totalFoodValuePaise = customerPaidPaise + restaurantContributionPaise;

  // Route to the restaurant's primary NGO partner.
  const partnership = await RestaurantNgoRelationship.findOne({
    restaurant: restaurant._id,
    status: 'active',
  }).sort({ isPrimary: -1, createdAt: 1 });

  // Guests are not given an account. A donation is reachable by its id, and
  // the confirmation goes to the mobile number they left.
  const donation = await Donation.create({
    donationId: generateDonationId(),
    restaurant: restaurant._id,
    ngo: partnership?.ngo,
    donor: donorUserId,
    donorSnapshot: {
      // No name given means the donor stays anonymous on the public wall.
      name: input.donor.name?.trim() || 'Anonymous',
      phone: input.donor.phone,
      isAnonymous: !input.donor.name?.trim(),
      message: input.donor.message || undefined,
    },
    items: snapshots,
    totalPortions,
    customerPaidPaise,
    restaurantContributionPaise,
    totalFoodValuePaise,
    status: 'DONATED',
    isPaid: false,
    timestamps_: {},
  });

  return { donation, restaurant };
}

/** Called once payment is verified — this is what actually starts the lifecycle. */
export async function markDonationPaid(donation: IDonation) {
  if (donation.isPaid) return donation;

  donation.isPaid = true;
  donation.status = 'DONATED';
  donation.timestamps_ = { ...donation.timestamps_, DONATED: new Date() };
  await donation.save();

  await appendEvent({ donation, status: 'DONATED' });

  await Restaurant.findByIdAndUpdate(donation.restaurant, {
    $inc: {
      'stats.totalDonations': 1,
      'stats.totalPortions': donation.totalPortions,
      'stats.customerContributionPaise': donation.customerPaidPaise,
      'stats.restaurantContributionPaise': donation.restaurantContributionPaise,
      'stats.totalFoodValuePaise': donation.totalFoodValuePaise,
    },
  });

  return donation;
}

export async function advanceStatus(
  donationId: string,
  next: DonationStatus,
  actor: { id: string; role: Role; name: string },
  note?: string
) {
  const donation = await Donation.findOne({ donationId });
  if (!donation) throw ApiError.notFound('Donation not found.');
  if (!donation.isPaid) throw ApiError.badRequest('This donation has not been paid for yet.');

  assertValidTransition(donation.status, next, actor.role);

  donation.status = next;
  donation.timestamps_ = { ...donation.timestamps_, [next]: new Date() };
  await donation.save();

  await appendEvent({
    donation,
    status: next,
    note,
    actorId: actor.id,
    actorRole: actor.role,
    actorName: actor.name,
  });

  return donation;
}

export async function ngoConfirm(
  donationId: string,
  portionsReceived: number,
  actor: { id: string; role: Role; name: string },
  note?: string
) {
  const donation = await Donation.findOne({ donationId });
  if (!donation) throw ApiError.notFound('Donation not found.');
  if (donation.status !== 'HANDED_OVER') {
    throw ApiError.badRequest('This donation must be handed over before it can be confirmed.');
  }

  const hasDiscrepancy = portionsReceived !== donation.totalPortions;

  donation.portionsReceived = portionsReceived;
  donation.status = 'NGO_CONFIRMED';
  donation.timestamps_ = { ...donation.timestamps_, NGO_CONFIRMED: new Date() };
  if (hasDiscrepancy) {
    donation.discrepancy = {
      hasDiscrepancy: true,
      reportedBy: new mongoose.Types.ObjectId(actor.id),
      note: note ?? `Expected ${donation.totalPortions} portions, received ${portionsReceived}.`,
      reportedAt: new Date(),
    };
  }
  await donation.save();

  await appendEvent({
    donation,
    status: 'NGO_CONFIRMED',
    note:
      note ??
      (hasDiscrepancy
        ? `Received ${portionsReceived} of ${donation.totalPortions} expected portions. Flagged for review.`
        : `All ${portionsReceived} portions were received and served.`),
    actorId: actor.id,
    actorRole: actor.role,
    actorName: actor.name,
    metadata: { portionsReceived, expected: donation.totalPortions, hasDiscrepancy },
  });

  if (donation.ngo) {
    await Ngo.findByIdAndUpdate(donation.ngo, {
      $inc: { 'stats.portionsReceived': portionsReceived, 'stats.donationsConfirmed': 1 },
    });
  }

  return donation;
}

export async function assignNgo(donationId: string, ngoId: string) {
  const ngo = await Ngo.findById(ngoId);
  if (!ngo) throw ApiError.notFound('NGO not found.');
  if (ngo.approvalStatus !== 'approved') throw ApiError.badRequest('That NGO is not approved yet.');

  const donation = await Donation.findOneAndUpdate({ donationId }, { ngo: ngo._id }, { new: true });
  if (!donation) throw ApiError.notFound('Donation not found.');
  return donation;
}

export async function getTimeline(donationObjectId: mongoose.Types.ObjectId) {
  return DonationEvent.find({ donation: donationObjectId }).sort({ createdAt: 1 }).lean();
}
