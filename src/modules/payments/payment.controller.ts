import { Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler';
import { recordAudit } from '../../utils/audit';
import * as service from './payment.service';

export const createOrderSchema = z.object({ donationId: z.string().min(1) });

export const verifySchema = z.object({
  donationId: z.string().min(1),
  orderId: z.string().min(1),
});

export const createOrder = asyncHandler(async (req: Request, res: Response) => {
  const order = await service.createOrder(req.body.donationId);
  res.json({ success: true, data: order });
});

export const verify = asyncHandler(async (req: Request, res: Response) => {
  const donation = await service.verifyPayment(req.body);
  await recordAudit({
    req,
    action: 'payment.verified',
    entityType: 'Donation',
    entityId: donation.donationId,
    after: { isPaid: true, amount: donation.customerPaidPaise },
  });
  res.json({
    success: true,
    data: { donationId: donation.donationId, status: donation.status, isPaid: donation.isPaid },
  });
});

export const webhook = asyncHandler(async (req: Request, res: Response) => {
  const signature = req.get('x-webhook-signature') ?? '';
  const timestamp = req.get('x-webhook-timestamp') ?? '';
  const result = await service.handleWebhook(req.body as Buffer, signature, timestamp);
  res.json({ success: true, data: result });
});

export const config = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ success: true, data: { mode: service.gatewayMode() } });
});
