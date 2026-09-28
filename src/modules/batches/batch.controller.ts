import { Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { recordAudit } from '../../utils/audit';
import * as service from './batch.service';

export const dispatchSchema = z.object({
  note: z.string().trim().max(500).optional(),
});

export const confirmSchema = z.object({
  receivedQuantity: z
    .number({ invalid_type_error: 'Enter the number of portions you received' })
    .int('Enter a whole number of portions')
    .min(0)
    .max(100000),
  note: z.string().trim().max(500).optional(),
});

function actorFrom(req: Request): service.Actor {
  return { id: req.user!.id, role: req.user!.role, name: req.user!.name };
}

/**
 * A restaurant or NGO only ever sees its own batches. An admin may look at any,
 * optionally narrowed by a query parameter — which is why the scope comes from
 * the account and never from the request for the other two roles.
 */
function scopeFor(req: Request, side: 'restaurant' | 'ngo'): service.BatchScope {
  if (req.user!.role === 'admin') {
    const requested = req.query[`${side}Id`];
    return typeof requested === 'string' && requested ? { [side]: requested } : {};
  }

  const own = side === 'restaurant' ? req.user!.restaurant : req.user!.ngo;
  if (!own) {
    throw ApiError.forbidden(
      side === 'restaurant'
        ? 'This account is not linked to a restaurant yet.'
        : 'This account is not linked to an NGO yet.'
    );
  }
  return { [side]: own };
}

export const listForRestaurant = asyncHandler(async (req: Request, res: Response) => {
  const scope = scopeFor(req, 'restaurant');
  const [batches, summary] = await Promise.all([
    service.listBatches(scope, req.query.status as string | undefined),
    service.batchSummary(scope),
  ]);
  res.json({ success: true, data: { batches, summary } });
});

export const listForNgo = asyncHandler(async (req: Request, res: Response) => {
  const scope = scopeFor(req, 'ngo');
  const [batches, summary] = await Promise.all([
    service.listBatches(scope, req.query.status as string | undefined),
    service.batchSummary(scope),
  ]);
  res.json({ success: true, data: { batches, summary } });
});

/** Readable by either side of the handover, and by an admin. */
export const detail = asyncHandler(async (req: Request, res: Response) => {
  const { role, restaurant, ngo } = req.user!;
  const scope: service.BatchScope =
    role === 'admin' ? {} : role === 'restaurant' ? { restaurant } : { ngo };
  const data = await service.getBatch(req.params.batchId, scope);
  res.json({ success: true, data });
});

export const dispatch = asyncHandler(async (req: Request, res: Response) => {
  const batch = await service.dispatchBatch(
    req.params.batchId,
    scopeFor(req, 'restaurant'),
    actorFrom(req),
    req.body.note
  );

  await recordAudit({
    req,
    action: 'batch.dispatch',
    entityType: 'Batch',
    entityId: batch.batchId,
    after: { dispatchedQuantity: batch.dispatchedQuantity, item: batch.itemName },
  });

  res.json({ success: true, data: { batch } });
});

export const confirm = asyncHandler(async (req: Request, res: Response) => {
  const batch = await service.confirmBatchReceipt(
    req.params.batchId,
    scopeFor(req, 'ngo'),
    req.body.receivedQuantity,
    actorFrom(req),
    req.body.note
  );

  await recordAudit({
    req,
    action: batch.status === 'RECONCILIATION_REQUIRED' ? 'batch.shortfall' : 'batch.confirm',
    entityType: 'Batch',
    entityId: batch.batchId,
    after: {
      receivedQuantity: batch.receivedQuantity,
      dispatchedQuantity: batch.dispatchedQuantity,
    },
  });

  res.json({ success: true, data: { batch } });
});
