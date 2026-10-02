import { Types } from 'mongoose';
import {
  Donation,
  DonationEvent,
  MenuItem,
  Restaurant,
  Ngo,
  RestaurantNgoRelationship,
  Batch,
  BatchEvent,
  IDonation,
  IDonationItemSnapshot,
  DONATION_STATUSES,
  DonationStatus,
  TERMINAL_STATUSES,
  RECEIVED_BATCH_STATUSES,
  DEFAULT_BATCH_TARGET,
  PUBLIC_CONSENT_POLICY_VERSION,
  splitPrice,
  Role,
} from '../../models';
import { ApiError } from '../../utils/ApiError';
import { generateBatchId, generateDonationId } from '../../utils/ids';
import { CreateDonationInput } from './donation.schema';

const STATUS_INDEX = new Map<string, number>(DONATION_STATUSES.map((s, i) => [s, i]));
const isTerminal = (status: string) => (TERMINAL_STATUSES as readonly string[]).includes(status);

/**
 * What the donor reads on the tracking page. Each entry is written once, when
 * the donation first reaches that status.
 */
const EVENT_COPY: Record<DonationStatus, { title: string; note: string }> = {
  PENDING_PAYMENT: {
    title: 'Awaiting payment',
    note: 'Your donation is reserved and waiting for payment to complete.',
  },
  PAYMENT_SUCCESS: {
    title: 'Donation received',
    note: 'Your payment was verified. The kitchen has been notified and matches your half.',
  },
  ASSIGNED_TO_BATCH: {
    title: 'Queued in the kitchen',
    note: 'Your dishes joined the next batch being cooked for the NGO.',
  },
  DISPATCHED: {
    title: 'Cooked and sent',
    note: 'The kitchen cooked the batch and sent it to the NGO.',
  },
  UNDER_REVIEW: {
    title: 'Receipt recorded with a shortfall — under review',
    note: 'The NGO counted fewer portions than the kitchen sent. DaanSetu is reconciling the difference with both of them, and this page will say what was decided.',
  },
  NGO_CONFIRMED: {
    title: 'Confirmed by the NGO',
    note: 'The NGO counted the food on arrival and confirmed it.',
  },
};

interface AppendEventArgs {
  donation: IDonation;
  status: DonationStatus | (typeof TERMINAL_STATUSES)[number];
  title?: string;
  note?: string;
  actorId?: string;
  actorRole?: Role | 'system';
  actorName?: string;
  metadata?: Record<string, unknown>;
}

export async function appendEvent({
  donation,
  status,
  title,
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
    title: title ?? copy?.title ?? status,
    note: note ?? copy?.note,
    actor: actorId,
    actorRole,
    actorName,
    metadata,
  });
}

/** The NGO a restaurant's donations are routed to: its primary active partner. */
export async function primaryPartnerNgoId(
  restaurantId: Types.ObjectId
): Promise<Types.ObjectId | undefined> {
  const partnership = await RestaurantNgoRelationship.findOne({
    restaurant: restaurantId,
    status: 'active',
  })
    .sort({ isPrimary: -1, createdAt: 1 })
    .select('ngo')
    .lean();
  return partnership?.ngo;
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
    activeForDonation: true,
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

  const name = input.donor.name?.trim();
  const message = input.donor.message?.trim();
  // A name is kept on the record either way; consent decides what is shown in
  // public. No consent, or no name, means the donation appears as Anonymous.
  const publicName = Boolean(name) && input.donor.consentPublicName;
  const publicMessage = Boolean(message) && input.donor.consentPublicMessage;

  const donation = await Donation.create({
    donationId: generateDonationId(),
    restaurant: restaurant._id,
    ngo: await primaryPartnerNgoId(restaurant._id),
    donor: donorUserId,
    donorSnapshot: {
      name: name || 'Anonymous',
      phone: input.donor.phone,
      isAnonymous: !publicName,
      message: message || undefined,
      consent: {
        publicName,
        publicMessage,
        ...(publicName || publicMessage
          ? { grantedAt: new Date(), policyVersion: PUBLIC_CONSENT_POLICY_VERSION }
          : {}),
      },
    },
    items: snapshots,
    totalPortions,
    customerPaidPaise,
    restaurantContributionPaise,
    totalFoodValuePaise: customerPaidPaise + restaurantContributionPaise,
    status: 'PENDING_PAYMENT',
    isPaid: false,
    timestamps_: {},
  });

  return { donation, restaurant };
}

/**
 * Called once a payment is verified — by the browser returning from the gateway,
 * by the webhook, or both. The paid flag is claimed in one atomic update so the
 * side effects below (restaurant totals, batch quantities) run exactly once
 * however many times this is called.
 */
export async function markDonationPaid(donationId: Types.ObjectId): Promise<IDonation | null> {
  const claimed = await Donation.findOneAndUpdate(
    { _id: donationId, isPaid: false },
    {
      $set: {
        isPaid: true,
        status: 'PAYMENT_SUCCESS',
        'timestamps_.PAYMENT_SUCCESS': new Date(),
      },
    },
    { new: true }
  );

  if (!claimed) return Donation.findById(donationId);

  await appendEvent({ donation: claimed, status: 'PAYMENT_SUCCESS' });

  await Restaurant.findByIdAndUpdate(claimed.restaurant, {
    $inc: {
      'stats.totalDonations': 1,
      'stats.totalPortions': claimed.totalPortions,
      'stats.customerContributionPaise': claimed.customerPaidPaise,
      'stats.restaurantContributionPaise': claimed.restaurantContributionPaise,
      'stats.totalFoodValuePaise': claimed.totalFoodValuePaise,
    },
  });

  await assignToBatches(claimed);
  return syncDonationStatus(claimed._id);
}

/**
 * Puts every dish in the donation into the batch its kitchen is currently
 * collecting for that NGO — one batch per dish, so a donation of two dishes is
 * cooked in two batches and only counts as delivered when both have gone out.
 */
export async function assignToBatches(donation: IDonation): Promise<void> {
  let ngoId = donation.ngo;
  if (!ngoId) {
    // The restaurant may have gained a partner since the donation was made.
    ngoId = await primaryPartnerNgoId(donation.restaurant);
    if (!ngoId) return; // Still unpartnered — stays at PAYMENT_SUCCESS, picked up later.
    await Donation.updateOne({ _id: donation._id }, { $set: { ngo: ngoId } });
    donation.ngo = ngoId;
  }

  for (const [index, line] of donation.items.entries()) {
    if (line.batch) continue;
    const batchId = await addLineToBatch(donation, index, line, ngoId);
    line.batch = batchId;
  }
}

/**
 * Puts one dish line into the batch collecting for it, counting its portions
 * exactly once.
 *
 * The order matters: the portions are added to the batch only while it is still
 * collecting, and the line is linked to the batch only if no other request has
 * linked it already. If that link loses the race the count is given back, so a
 * repeated call can never inflate a batch or add food to one already sent.
 */
async function addLineToBatch(
  donation: IDonation,
  index: number,
  line: IDonationItemSnapshot,
  ngoId: Types.ObjectId
): Promise<Types.ObjectId | undefined> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const batch = await openBatchFor(donation.restaurant, ngoId, line);

    const counted = await Batch.updateOne(
      { _id: batch._id, status: 'IN_PROGRESS' },
      { $inc: { collectedQuantity: line.quantity, donationCount: 1 } }
    );
    // The kitchen dispatched this batch a moment ago — find or open the next one.
    if (counted.modifiedCount === 0) continue;

    const linked = await Donation.updateOne(
      { _id: donation._id, [`items.${index}.batch`]: { $exists: false } },
      { $set: { [`items.${index}.batch`]: batch._id } }
    );

    if (linked.modifiedCount === 0) {
      await Batch.updateOne(
        { _id: batch._id, status: 'IN_PROGRESS' },
        { $inc: { collectedQuantity: -line.quantity, donationCount: -1 } }
      );
      const current = await Donation.findById(donation._id).select('items').lean();
      return current?.items[index]?.batch;
    }

    await markBatchReadyIfFull(batch._id);
    return batch._id;
  }

  throw ApiError.conflict('Could not add this donation to a batch. Please try again.');
}

/**
 * The batch currently collecting this dish for this NGO, opening one if there is
 * none. The unique partial index on (restaurant, ngo, menuItem) for IN_PROGRESS
 * batches means two payments landing together share a batch rather than opening
 * two — one upsert wins, the loser retries into the winner's batch.
 */
async function openBatchFor(
  restaurantId: Types.ObjectId,
  ngoId: Types.ObjectId,
  line: IDonationItemSnapshot
) {
  const menuItem = await MenuItem.findById(line.menuItem).select('batchTarget').lean();
  const filter = {
    restaurant: restaurantId,
    ngo: ngoId,
    menuItem: line.menuItem,
    status: 'IN_PROGRESS' as const,
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const batch = await Batch.findOneAndUpdate(
        filter,
        {
          $setOnInsert: {
            batchId: generateBatchId(),
            itemName: line.name,
            targetQuantity: menuItem?.batchTarget ?? DEFAULT_BATCH_TARGET,
          },
        },
        { upsert: true, new: true }
      );
      if (batch.collectedQuantity === 0) {
        await BatchEvent.create({
          batch: batch._id,
          toStatus: 'IN_PROGRESS',
          actorType: 'system',
          note: `Batch opened for ${batch.itemName} — collecting ${batch.targetQuantity} portions.`,
        });
      }
      return batch;
    } catch (err) {
      const duplicate = (err as { code?: number }).code === 11000;
      if (!duplicate || attempt === 2) throw err;
    }
  }
  throw ApiError.conflict('Could not open a batch for this dish. Please try again.');
}

/** A batch that has reached its target stops collecting and waits for the kitchen. */
export async function markBatchReadyIfFull(batchId: Types.ObjectId): Promise<void> {
  const result = await Batch.updateOne(
    {
      _id: batchId,
      status: 'IN_PROGRESS',
      $expr: { $gte: ['$collectedQuantity', '$targetQuantity'] },
    },
    { $set: { status: 'READY_FOR_DELIVERY', readyAt: new Date() } }
  );

  if (result.modifiedCount > 0) {
    const batch = await Batch.findById(batchId).select('collectedQuantity itemName').lean();
    await BatchEvent.create({
      batch: batchId,
      fromStatus: 'IN_PROGRESS',
      toStatus: 'READY_FOR_DELIVERY',
      actorType: 'system',
      note: `Target reached — ${batch?.collectedQuantity} portions of ${batch?.itemName} ready to cook.`,
    });
  }
}

/** Where a donation has got to, read from the batches its dishes are in. */
async function deriveStatus(donation: IDonation): Promise<DonationStatus> {
  const batchIds = donation.items.map((i) => i.batch).filter(Boolean) as Types.ObjectId[];
  if (batchIds.length < donation.items.length) return 'PAYMENT_SUCCESS';

  const batches = await Batch.find({ _id: { $in: batchIds } }).select('status').lean();
  if (batches.length < batchIds.length) return 'ASSIGNED_TO_BATCH';

  /**
   * A donation is only as far along as its least advanced dish, and a disputed
   * receipt outranks a settled one — so a donation spanning two batches cannot
   * read as confirmed while either batch is still collecting or under review.
   */
  const ranks = batches.map((b) => {
    if (b.status === 'COMPLETED') return STATUS_INDEX.get('NGO_CONFIRMED')!;
    if (b.status === 'RECONCILIATION_REQUIRED') return STATUS_INDEX.get('UNDER_REVIEW')!;
    if (b.status === 'DISPATCHED') return STATUS_INDEX.get('DISPATCHED')!;
    return STATUS_INDEX.get('ASSIGNED_TO_BATCH')!;
  });

  return DONATION_STATUSES[Math.min(...ranks)];
}

/**
 * Brings a donation's status in line with its batches, writing one timeline
 * event per step it passes through. Idempotent, so it is safe to call from
 * every path that touches a batch.
 */
export async function syncDonationStatus(donationId: Types.ObjectId): Promise<IDonation | null> {
  let donation = await Donation.findById(donationId);
  if (!donation || !donation.isPaid || isTerminal(donation.status)) return donation;

  const target = await deriveStatus(donation);
  const targetIdx = STATUS_INDEX.get(target)!;
  let currentIdx = STATUS_INDEX.get(donation.status)!;

  while (currentIdx < targetIdx) {
    const from = DONATION_STATUSES[currentIdx];

    /**
     * Walk the steps the donation actually passed through. UNDER_REVIEW is the
     * one step that is not on every path: a batch received in full goes straight
     * from DISPATCHED to NGO_CONFIRMED, and must never be stamped "under review"
     * on the way past.
     */
    let nextIdx = currentIdx + 1;
    while (DONATION_STATUSES[nextIdx] === 'UNDER_REVIEW' && target !== 'UNDER_REVIEW') {
      nextIdx += 1;
    }
    const next = DONATION_STATUSES[nextIdx];

    const moved = await Donation.findOneAndUpdate(
      { _id: donationId, status: from },
      { $set: { status: next, [`timestamps_.${next}`]: new Date() } },
      { new: true }
    );
    // Another request advanced it first; its event was written there.
    if (!moved) return Donation.findById(donationId);

    donation = moved;
    await appendEvent({ donation: moved, status: next, ...(await actorFor(moved, next)) });
    currentIdx = nextIdx;
  }

  return donation;
}

/** Steps are signed by whoever is responsible for them, not by the platform. */
async function actorFor(
  donation: IDonation,
  status: DonationStatus
): Promise<{ actorRole: Role | 'system'; actorName: string }> {
  if (status === 'DISPATCHED') {
    const restaurant = await Restaurant.findById(donation.restaurant).select('name').lean();
    return { actorRole: 'restaurant', actorName: restaurant?.name ?? 'The kitchen' };
  }
  if (status === 'NGO_CONFIRMED' || status === 'UNDER_REVIEW') {
    const ngo = await Ngo.findById(donation.ngo).select('name').lean();
    return { actorRole: 'ngo', actorName: ngo?.name ?? 'The NGO' };
  }
  return { actorRole: 'system', actorName: 'DaanSetu' };
}

/** Re-syncs every donation that has food in a batch. Called after the batch moves. */
export async function syncDonationsForBatch(batchId: Types.ObjectId): Promise<void> {
  const donations = await Donation.find({ 'items.batch': batchId, isPaid: true })
    .select('_id')
    .lean();
  for (const { _id } of donations) {
    await syncDonationStatus(_id as Types.ObjectId);
  }
}

/**
 * Paid donations that never found a batch because the kitchen had no NGO partner
 * at the time. Called when a partnership is set up so nothing is left behind.
 */
export async function assignPendingDonations(restaurantId: Types.ObjectId): Promise<number> {
  const pending = await Donation.find({
    restaurant: restaurantId,
    isPaid: true,
    status: 'PAYMENT_SUCCESS',
  });

  let assigned = 0;
  for (const donation of pending) {
    await assignToBatches(donation);
    const synced = await syncDonationStatus(donation._id);
    if (synced && synced.status !== 'PAYMENT_SUCCESS') assigned += 1;
  }
  return assigned;
}

export async function getTimeline(donationObjectId: Types.ObjectId) {
  return DonationEvent.find({ donation: donationObjectId }).sort({ createdAt: 1 }).lean();
}

/**
 * The batches a donation's dishes are in, with the counts a donor is entitled to
 * see: how full the batch is, what went out, and what the NGO counted.
 */
export async function getDonationBatches(donation: IDonation) {
  const batchIds = donation.items.map((i) => i.batch).filter(Boolean) as Types.ObjectId[];
  if (batchIds.length === 0) return [];

  const batches = await Batch.find({ _id: { $in: batchIds } })
    .select(
      'batchId itemName status targetQuantity collectedQuantity dispatchedQuantity receivedQuantity readyAt dispatchedAt receivedAt receiptNote resolution'
    )
    .lean();

  const byId = new Map(batches.map((b) => [b._id.toString(), b]));

  return donation.items
    .filter((item) => item.batch)
    .map((item) => {
      const batch = byId.get(item.batch!.toString());
      return {
        itemName: item.name,
        quantity: item.quantity,
        batchId: batch?.batchId,
        status: batch?.status,
        targetQuantity: batch?.targetQuantity,
        collectedQuantity: batch?.collectedQuantity,
        dispatchedQuantity: batch?.dispatchedQuantity,
        receivedQuantity: batch?.receivedQuantity,
        readyAt: batch?.readyAt,
        dispatchedAt: batch?.dispatchedAt,
        receivedAt: batch?.receivedAt,
        receiptNote: batch?.receiptNote,
        shortfall:
          batch?.status === 'RECONCILIATION_REQUIRED' ||
          (batch?.receivedAt ? batch.receivedQuantity !== batch.dispatchedQuantity : false),
        resolutionNote: batch?.resolution?.note,
      };
    });
}
