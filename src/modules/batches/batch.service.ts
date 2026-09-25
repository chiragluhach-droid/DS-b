import mongoose from 'mongoose';
import {
  Batch,
  BatchEvent,
  BatchReceipt,
  Ngo,
  BatchStatus,
  Role,
} from '../../models';
import { ApiError } from '../../utils/ApiError';

export async function getBatchesForRestaurant(restaurantId: string) {
  return Batch.find({ restaurant: restaurantId })
    .populate('ngo', 'name')
    .populate('menuItem', 'name image category')
    .sort({ createdAt: -1 })
    .lean();
}

export async function getBatchesForNgo(ngoId: string) {
  return Batch.find({ ngo: ngoId })
    .populate('restaurant', 'name')
    .populate('menuItem', 'name image category')
    .sort({ createdAt: -1 })
    .lean();
}

export async function dispatchBatch(
  batchId: string,
  restaurantId: string,
  dispatchedQuantity: number,
  actor: { id: string; role: Role; name: string },
  note?: string
) {
  const batch = await Batch.findOne({ batchId, restaurant: restaurantId });
  if (!batch) throw ApiError.notFound('Batch not found or unauthorized.');
  
  if (batch.status !== 'READY_FOR_DELIVERY' && batch.status !== 'IN_PROGRESS') {
    throw ApiError.badRequest('Only IN_PROGRESS or READY_FOR_DELIVERY batches can be dispatched.');
  }

  const fromStatus = batch.status;
  batch.status = 'DISPATCHED';
  batch.dispatchedQuantity = dispatchedQuantity;
  batch.dispatchedAt = new Date();
  await batch.save();

  await BatchEvent.create({
    batch: batch._id,
    fromStatus,
    toStatus: 'DISPATCHED',
    actorType: actor.role,
    actorId: actor.id,
    note: note || `Dispatched ${dispatchedQuantity} portions.`,
  });

  return batch;
}

export async function confirmBatchReceipt(
  batchId: string,
  ngoId: string,
  receivedQuantity: number,
  actor: { id: string; role: Role; name: string },
  note?: string
) {
  const batch = await Batch.findOne({ batchId, ngo: ngoId });
  if (!batch) throw ApiError.notFound('Batch not found or unauthorized.');

  if (batch.status !== 'DISPATCHED') {
    throw ApiError.badRequest('Only DISPATCHED batches can be received.');
  }

  const fromStatus = batch.status;
  const isMismatch = receivedQuantity !== batch.dispatchedQuantity;
  const toStatus = isMismatch ? 'RECONCILIATION_REQUIRED' : 'COMPLETED';

  batch.status = toStatus;
  batch.receivedQuantity = receivedQuantity;
  batch.receivedAt = new Date();
  await batch.save();

  await BatchReceipt.create({
    batch: batch._id,
    ngo: batch.ngo,
    expectedQuantity: batch.dispatchedQuantity,
    receivedQuantity,
    confirmedBy: actor.id,
    notes: note,
  });

  await BatchEvent.create({
    batch: batch._id,
    fromStatus,
    toStatus,
    actorType: actor.role,
    actorId: actor.id,
    note: note || `Received ${receivedQuantity} portions (Expected: ${batch.dispatchedQuantity}).`,
  });

  // Update NGO stats
  await Ngo.findByIdAndUpdate(batch.ngo, {
    $inc: { 'stats.portionsReceived': receivedQuantity, 'stats.donationsConfirmed': 1 },
  });

  return batch;
}

export async function getBatchTimeline(batchObjectId: mongoose.Types.ObjectId) {
  return BatchEvent.find({ batch: batchObjectId }).sort({ createdAt: 1 }).lean();
}
