import crypto from 'crypto';
import Razorpay from 'razorpay';
import { Donation, Payment, IDonation } from '../../models';
import { env, paymentsAreLive } from '../../config/env';
import { ApiError } from '../../utils/ApiError';
import { generateToken } from '../../utils/ids';
import { markDonationPaid } from '../donations/donation.service';

const client = paymentsAreLive
  ? new Razorpay({ key_id: env.razorpay.keyId, key_secret: env.razorpay.keySecret })
  : null;

export function gatewayMode(): 'razorpay' | 'mock' {
  return paymentsAreLive ? 'razorpay' : 'mock';
}

export async function createOrder(donationId: string) {
  const donation = await Donation.findOne({ donationId });
  if (!donation) throw ApiError.notFound('Donation not found.');
  if (donation.isPaid) throw ApiError.conflict('This donation has already been paid for.');

  const receipt = donation.donationId;

  if (client) {
    const order = await client.orders.create({
      amount: donation.customerPaidPaise,
      currency: 'INR',
      receipt,
      notes: { donationId: donation.donationId, restaurant: donation.restaurant.toString() },
    });

    const payment = await Payment.findOneAndUpdate(
      { donation: donation._id },
      {
        donation: donation._id,
        provider: 'razorpay',
        orderId: order.id,
        amountPaise: donation.customerPaidPaise,
        currency: 'INR',
        status: 'created',
      },
      { upsert: true, new: true }
    );

    donation.payment = payment._id;
    await donation.save();

    return {
      mode: 'razorpay' as const,
      orderId: order.id,
      amountPaise: donation.customerPaidPaise,
      currency: 'INR',
      keyId: env.razorpay.keyId,
      donationId: donation.donationId,
    };
  }

  // Mock gateway: a self-contained order so the full flow is testable without keys.
  const orderId = `order_mock_${generateToken(8)}`;
  const payment = await Payment.findOneAndUpdate(
    { donation: donation._id },
    {
      donation: donation._id,
      provider: 'mock',
      orderId,
      amountPaise: donation.customerPaidPaise,
      currency: 'INR',
      status: 'created',
    },
    { upsert: true, new: true }
  );

  donation.payment = payment._id;
  await donation.save();

  return {
    mode: 'mock' as const,
    orderId,
    amountPaise: donation.customerPaidPaise,
    currency: 'INR',
    keyId: null,
    donationId: donation.donationId,
  };
}

function expectedSignature(orderId: string, paymentId: string): string {
  return crypto
    .createHmac('sha256', env.razorpay.keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
}

interface VerifyInput {
  donationId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

/**
 * Verification happens here and only here. The frontend reporting "success"
 * is never sufficient to mark a donation paid.
 */
export async function verifyPayment(input: VerifyInput): Promise<IDonation> {
  const donation = await Donation.findOne({ donationId: input.donationId });
  if (!donation) throw ApiError.notFound('Donation not found.');

  const payment = await Payment.findOne({ donation: donation._id });
  if (!payment) throw ApiError.badRequest('No payment was started for this donation.');
  if (payment.orderId !== input.razorpayOrderId) {
    throw ApiError.badRequest('This payment does not belong to that donation.');
  }

  if (donation.isPaid) return donation;

  if (payment.provider === 'razorpay') {
    const expected = expectedSignature(input.razorpayOrderId, input.razorpayPaymentId);
    const valid =
      expected.length === input.razorpaySignature.length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(input.razorpaySignature));

    if (!valid) {
      payment.status = 'failed';
      payment.failureReason = 'Signature verification failed';
      await payment.save();
      throw ApiError.badRequest('Payment could not be verified. You have not been charged.');
    }
  }

  payment.paymentId = input.razorpayPaymentId;
  payment.signature = input.razorpaySignature;
  payment.status = 'paid';
  payment.verifiedAt = new Date();
  await payment.save();

  await markDonationPaid(donation);
  return donation;
}

/** Razorpay webhook — the source of truth if the browser never returns. */
export async function handleWebhook(rawBody: Buffer, signature: string) {
  if (!env.razorpay.webhookSecret) return { handled: false, reason: 'no webhook secret configured' };

  const expected = crypto
    .createHmac('sha256', env.razorpay.webhookSecret)
    .update(rawBody)
    .digest('hex');

  if (expected !== signature) throw ApiError.badRequest('Invalid webhook signature.');

  const event = JSON.parse(rawBody.toString('utf8')) as {
    event: string;
    payload: { payment: { entity: { id: string; order_id: string; method?: string } } };
  };

  if (event.event !== 'payment.captured') return { handled: false, reason: event.event };

  const entity = event.payload.payment.entity;
  const payment = await Payment.findOne({ orderId: entity.order_id });
  if (!payment) return { handled: false, reason: 'unknown order' };

  payment.paymentId = entity.id;
  payment.method = entity.method;
  payment.status = 'paid';
  payment.verifiedAt = new Date();
  payment.rawPayload = event as unknown as Record<string, unknown>;
  await payment.save();

  const donation = await Donation.findById(payment.donation);
  if (donation) await markDonationPaid(donation);

  return { handled: true };
}
