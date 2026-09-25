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
  splitPrice,
  Role,
  Batch,
} from '../../models';
import { generateBatchId } from '../../utils/ids';
import { ApiError } from '../../utils/ApiError';
import { generateDonationId } from '../../utils/ids';
import { CreateDonationInput } from './donation.schema';

const STATUS_INDEX = new Map<string, number>(DONATION_STATUSES.map((s, i) => [s, i]));

const EVENT_COPY: Partial<Record<AnyDonationStatus, { title: string; note: string }>> = {
  PENDING_PAYMENT: {
    title: 'Payment Pending',
    note: 'Waiting for payment confirmation.',
  },
  PAYMENT_SUCCESS: {
    title: 'Payment Successful',
    note: 'Your contribution was received successfully.',
  },
  ASSIGNED_TO_BATCH: {
    title: 'Assigned to Batch',
    note: 'Your donation has been assigned to a delivery batch.',
  },
  REFUNDED: {
    title: 'Refunded',
    note: 'Your donation was refunded.',
  },
  FAILED: {
    title: 'Failed',
    note: 'Your payment failed.',
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
    status: 'PENDING_PAYMENT',
    isPaid: false,
    timestamps_: {},
  });

  return { donation, restaurant };
}

/** Called once payment is verified — this is what actually starts the lifecycle. */
export async function markDonationPaid(donation: IDonation) {
  if (donation.isPaid) return donation;

  donation.isPaid = true;
  donation.status = 'PAYMENT_SUCCESS';
  donation.timestamps_ = { ...donation.timestamps_, PAYMENT_SUCCESS: new Date() };
  await donation.save();

  await appendEvent({ donation, status: 'PAYMENT_SUCCESS' });

  await Restaurant.findByIdAndUpdate(donation.restaurant, {
    $inc: {
      'stats.totalDonations': 1,
      'stats.totalPortions': donation.totalPortions,
      'stats.customerContributionPaise': donation.customerPaidPaise,
      'stats.restaurantContributionPaise': donation.restaurantContributionPaise,
      'stats.totalFoodValuePaise': donation.totalFoodValuePaise,
    },
  });

  // Assign to a batch
  const primaryItem = donation.items[0]; // Assuming 1 type of item per donation for V1
  if (primaryItem && donation.ngo) {
    const menuItem = await MenuItem.findById(primaryItem.menuItem);
    const targetQuantity = menuItem?.batchTarget || 40;

    let batch = await Batch.findOne({
      restaurant: donation.restaurant,
      ngo: donation.ngo,
      menuItem: primaryItem.menuItem,
      status: 'IN_PROGRESS',
    });

    if (!batch) {
      batch = await Batch.create({
        batchId: generateBatchId(),
        restaurant: donation.restaurant,
        ngo: donation.ngo,
        menuItem: primaryItem.menuItem,
        itemName: primaryItem.name,
        targetQuantity,
        collectedQuantity: 0,
        donationCount: 0,
      });
    }

    batch.collectedQuantity += donation.totalPortions;
    batch.donationCount = (batch.donationCount || 0) + 1;
    if (batch.collectedQuantity >= batch.targetQuantity) {
      batch.status = 'READY_FOR_DELIVERY';
      batch.readyAt = new Date();
    }
    await batch.save();

    donation.items[0].batch = batch._id;
    donation.status = 'ASSIGNED_TO_BATCH';
    donation.timestamps_ = { ...donation.timestamps_, ASSIGNED_TO_BATCH: new Date() };
    await donation.save();
    
    await appendEvent({ donation, status: 'ASSIGNED_TO_BATCH' });
  }

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


export async function assignNgo(donationId: string, ngoId: string) {
  const ngo = await Ngo.findById(ngoId);
  if (!ngo) throw ApiError.notFound('NGO not found.');
  if (ngo.approvalStatus !== 'approved') throw ApiError.badRequest('That NGO is not approved yet.');

  const donation = await Donation.findOneAndUpdate({ donationId }, { ngo: ngo._id }, { new: true });
  if (!donation) throw ApiError.notFound('Donation not found.');
  return donation;
}

export async function getTimeline(donationObjectId: mongoose.Types.ObjectId) {
  const donation = await Donation.findById(donationObjectId).lean();
  if (!donation) return [];

  const donationEvents = await DonationEvent.find({ donation: donationObjectId }).sort({ createdAt: 1 }).lean();
  
  if (!donation.items[0]?.batch) {
    return donationEvents;
  }

  const batchEvents = await mongoose.model('BatchEvent').find({ batch: donation.items[0].batch }).sort({ createdAt: 1 }).lean();
  
  // Map BatchEvents to DonationEvent shape
  const mappedBatchEvents = batchEvents.map((be: any) => {
    let status = be.toStatus;
    if (status === 'READY_FOR_DELIVERY' || status === 'IN_PROGRESS') status = 'ASSIGNED_TO_BATCH';
    if (status === 'RECONCILIATION_REQUIRED' || status === 'COMPLETED') status = 'NGO_CONFIRMED';
    
    return {
      _id: be._id,
      donation: donationObjectId,
      status,
      title: be.note || status,
      note: be.note,
      actorType: be.actorType,
      actorId: be.actorId,
      createdAt: be.createdAt
    };
  });

  return [...donationEvents, ...mappedBatchEvents].sort((a: any, b: any) => 
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}
