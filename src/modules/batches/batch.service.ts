import { Types } from 'mongoose';
import {
  Batch,
  BatchEvent,
  BatchReceipt,
  Ngo,
  BatchStatus,
  BATCH_STATUSES,
  OPEN_BATCH_STATUSES,
  Role,
} from '../../models';
import { ApiError } from '../../utils/ApiError';
import { syncDonationsForBatch } from '../donations/donation.service';

export interface Actor {
  id: string;
  role: Role;
  name: string;
}

/** Who may see or move a batch. A restaurant or NGO is always scoped to its own. */
export interface BatchScope {
  restaurant?: Types.ObjectId | string;
  ngo?: Types.ObjectId | string;
}

const STATUS_LABEL: Record<BatchStatus, string> = {
  IN_PROGRESS: 'still collecting',
  READY_FOR_DELIVERY: 'ready to cook',
  DISPATCHED: 'already on its way',
  RECONCILIATION_REQUIRED: 'flagged for review',
  COMPLETED: 'closed',
};

const POPULATE = [
  { path: 'ngo', select: 'name slug logoImage address phone' },
  { path: 'restaurant', select: 'name slug logoImage address phone' },
  { path: 'menuItem', select: 'name image category' },
];

function scopeFilter(scope: BatchScope): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  if (scope.restaurant) filter.restaurant = scope.restaurant;
  if (scope.ngo) filter.ngo = scope.ngo;
  return filter;
}

function statusFilter(status?: string): Record<string, unknown> {
  if (!status || status === 'all') return {};
  if (status === 'open') return { status: { $in: OPEN_BATCH_STATUSES } };
  if (!(BATCH_STATUSES as readonly string[]).includes(status)) {
    throw ApiError.badRequest('Unknown batch status filter.');
  }
  return { status };
}

export async function listBatches(scope: BatchScope, status?: string, limit = 100) {
  return Batch.find({ ...scopeFilter(scope), ...statusFilter(status) })
    .populate(POPULATE)
    .sort({ createdAt: -1 })
    .limit(Math.min(limit, 200))
    .lean();
}

export async function getBatch(batchId: string, scope: BatchScope) {
  const batch = await Batch.findOne({ batchId, ...scopeFilter(scope) })
    .populate(POPULATE)
    .lean();
  if (!batch) throw ApiError.notFound('Batch not found.');
  const events = await BatchEvent.find({ batch: batch._id })
    .select('fromStatus toStatus actorType actorName note createdAt')
    .sort({ createdAt: 1 })
    .lean();
  return { batch, events };
}

/**
 * Explains why a batch could not be moved: it either is not theirs, or it is no
 * longer at the step this action applies to.
 */
async function unavailableError(batchId: string, scope: BatchScope): Promise<ApiError> {
  const existing = await Batch.findOne({ batchId, ...scopeFilter(scope) }).select('status').lean();
  if (!existing) return ApiError.notFound('Batch not found.');
  return ApiError.conflict(`This batch is ${STATUS_LABEL[existing.status]} and cannot change now.`);
}

/**
 * The kitchen cooked the batch and handed it over. Everything collected goes
 * out, so the quantity is taken from the batch rather than typed in — the NGO's
 * count is the only number a human enters, and it is checked against this one.
 */
export async function dispatchBatch(
  batchId: string,
  scope: BatchScope,
  actor: Actor,
  note?: string
) {
  const batch = await Batch.findOneAndUpdate(
    {
      batchId,
      ...scopeFilter(scope),
      status: { $in: OPEN_BATCH_STATUSES },
      collectedQuantity: { $gt: 0 },
    },
    [
      {
        $set: {
          status: 'DISPATCHED',
          dispatchedQuantity: '$collectedQuantity',
          dispatchedAt: new Date(),
          ...(note ? { dispatchNote: { $literal: note } } : {}),
        },
      },
    ],
    { new: true }
  );

  if (!batch) throw await unavailableError(batchId, scope);

  await BatchEvent.create({
    batch: batch._id,
    toStatus: 'DISPATCHED',
    actorType: actor.role,
    actorId: actor.id,
    actorName: actor.name,
    note: note || `${batch.dispatchedQuantity} portions of ${batch.itemName} sent to the NGO.`,
  });

  await syncDonationsForBatch(batch._id);
  return batch;
}

/**
 * The NGO counts what actually arrived. A count that differs from what was sent
 * is recorded as it stands and flagged for an admin — it is never quietly
 * rounded to what the kitchen claimed.
 */
export async function confirmBatchReceipt(
  batchId: string,
  scope: BatchScope,
  receivedQuantity: number,
  actor: Actor,
  note?: string
) {
  const dispatched = await Batch.findOne({
    batchId,
    ...scopeFilter(scope),
    status: 'DISPATCHED',
  }).lean();

  if (!dispatched) throw await unavailableError(batchId, scope);

  const mismatch = receivedQuantity !== dispatched.dispatchedQuantity;
  if (mismatch && (!note || note.trim().length < 5)) {
    throw ApiError.badRequest(
      `This differs from the ${dispatched.dispatchedQuantity} portions sent — please say briefly what happened.`
    );
  }

  const status: BatchStatus = mismatch ? 'RECONCILIATION_REQUIRED' : 'COMPLETED';
  const batch = await Batch.findOneAndUpdate(
    { _id: dispatched._id, status: 'DISPATCHED' },
    {
      $set: {
        status,
        receivedQuantity,
        receivedAt: new Date(),
        ...(note ? { receiptNote: note.trim() } : {}),
      },
    },
    { new: true }
  );
  if (!batch) throw ApiError.conflict('This batch was confirmed a moment ago.');

  await BatchReceipt.create({
    batch: batch._id,
    ngo: batch.ngo,
    expectedQuantity: batch.dispatchedQuantity,
    receivedQuantity,
    confirmedBy: actor.id,
    notes: note?.trim(),
  });

  await BatchEvent.create({
    batch: batch._id,
    fromStatus: 'DISPATCHED',
    toStatus: status,
    actorType: actor.role,
    actorId: actor.id,
    actorName: actor.name,
    note:
      note?.trim() ||
      `Received ${receivedQuantity} of ${batch.dispatchedQuantity} portions sent.`,
  });

  await Ngo.findByIdAndUpdate(batch.ngo, {
    $inc: {
      'stats.portionsReceived': receivedQuantity,
      'stats.donationsConfirmed': batch.donationCount,
    },
  });

  await syncDonationsForBatch(batch._id);
  return batch;
}

/** An admin closes a flagged batch with a note on what was done about it. */
export async function resolveBatch(batchId: string, note: string, actor: Actor) {
  const batch = await Batch.findOneAndUpdate(
    { batchId, status: 'RECONCILIATION_REQUIRED' },
    {
      $set: {
        status: 'COMPLETED',
        resolution: { note: note.trim(), resolvedBy: actor.id, resolvedAt: new Date() },
      },
    },
    { new: true }
  );

  if (!batch) {
    const existing = await Batch.findOne({ batchId }).select('status').lean();
    if (!existing) throw ApiError.notFound('Batch not found.');
    throw ApiError.badRequest('This batch has no open discrepancy.');
  }

  await BatchEvent.create({
    batch: batch._id,
    fromStatus: 'RECONCILIATION_REQUIRED',
    toStatus: 'COMPLETED',
    actorType: actor.role,
    actorId: actor.id,
    actorName: actor.name,
    note: `Discrepancy resolved: ${note.trim()}`,
  });

  await syncDonationsForBatch(batch._id);
  return batch;
}

/** Headline counts for the restaurant and NGO dashboards. */
export async function batchSummary(scope: BatchScope) {
  const rows = await Batch.aggregate<{
    _id: BatchStatus;
    batches: number;
    portions: number;
  }>([
    { $match: scopeFilter(scope) },
    {
      $group: {
        _id: '$status',
        batches: { $sum: 1 },
        portions: { $sum: '$collectedQuantity' },
      },
    },
  ]);

  const byStatus = Object.fromEntries(
    BATCH_STATUSES.map((s) => [s, { batches: 0, portions: 0 }])
  ) as Record<BatchStatus, { batches: number; portions: number }>;

  rows.forEach((row) => {
    byStatus[row._id] = { batches: row.batches, portions: row.portions };
  });

  return {
    byStatus,
    collecting: byStatus.IN_PROGRESS.batches,
    readyToCook: byStatus.READY_FOR_DELIVERY.batches,
    inTransit: byStatus.DISPATCHED.batches,
    flagged: byStatus.RECONCILIATION_REQUIRED.batches,
    portionsAwaitingDispatch:
      byStatus.IN_PROGRESS.portions + byStatus.READY_FOR_DELIVERY.portions,
    portionsInTransit: byStatus.DISPATCHED.portions,
  };
}

export async function getBatchTimeline(batchObjectId: Types.ObjectId) {
  return BatchEvent.find({ batch: batchObjectId }).sort({ createdAt: 1 }).lean();
}
