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

/** Compares two strings without leaking where they differ. */
function sameSignature(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function createOrder(donationId: string) {
  const donation = await Donation.findOne({ donationId: donationId.trim().toUpperCase() });
  if (!donation) throw ApiError.notFound('Donation not found.');
  if (donation.isPaid) throw ApiError.conflict('This donation has already been paid for.');
  if (donation.customerPaidPaise < 100) throw ApiError.badRequest('This donation amount is too small.');

  const provider = gatewayMode();
  const orderId = client
    ? (
        await client.orders.create({
          amount: donation.customerPaidPaise,
          currency: 'INR',
          receipt: donation.donationId,
          notes: { donationId: donation.donationId, restaurant: donation.restaurant.toString() },
        })
      ).id
    : `order_mock_${generateToken(8)}`;

  const payment = await Payment.findOneAndUpdate(
    { donation: donation._id },
    {
      donation: donation._id,
      provider,
      orderId,
      amountPaise: donation.customerPaidPaise,
      currency: 'INR',
      status: 'created',
      $unset: { paymentId: '', signature: '', failureReason: '' },
    },
    { upsert: true, new: true }
  );

  donation.payment = payment._id;
  await donation.save();

  return {
    mode: provider,
    orderId,
    amountPaise: donation.customerPaidPaise,
    currency: 'INR',
    keyId: client ? env.razorpay.keyId : null,
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
 * Verification happens here and only here. The browser reporting "success" is
 * never enough to mark a donation paid.
 */
export async function verifyPayment(input: VerifyInput): Promise<IDonation> {
  const donation = await Donation.findOne({ donationId: input.donationId.trim().toUpperCase() });
  if (!donation) throw ApiError.notFound('Donation not found.');

  const payment = await Payment.findOne({ donation: donation._id });
  if (!payment) throw ApiError.badRequest('No payment was started for this donation.');
  if (payment.orderId !== input.razorpayOrderId) {
    throw ApiError.badRequest('This payment does not belong to that donation.');
  }

  if (donation.isPaid) return donation;

  if (payment.provider === 'razorpay') {
    const valid = sameSignature(
      expectedSignature(input.razorpayOrderId, input.razorpayPaymentId),
      input.razorpaySignature
    );

    if (!valid) {
      payment.status = 'failed';
      payment.failureReason = 'Signature verification failed';
      await payment.save();
      throw ApiError.badRequest('Payment could not be verified. You have not been charged.');
    }
  } else if (paymentsAreLive) {
    // The order was created in mock mode before real keys were configured.
    // Accepting it now would take an unsigned payment as genuine.
    throw ApiError.badRequest('This payment session is out of date. Please start again.');
  }

  payment.paymentId = input.razorpayPaymentId;
  payment.signature = input.razorpaySignature;
  payment.status = 'paid';
  payment.verifiedAt = new Date();
  await payment.save();

  const paid = await markDonationPaid(donation._id);
  return paid ?? donation;
}

interface WebhookEvent {
  event: string;
  payload: {
    payment: {
      entity: {
        id: string;
        order_id: string;
        method?: string;
        amount?: number;
        error_description?: string;
      };
    };
  };
}

/** Razorpay's webhook — the source of truth when the browser never comes back. */
export async function handleWebhook(rawBody: Buffer, signature: string) {
  if (!env.razorpay.webhookSecret) {
    return { handled: false, reason: 'no webhook secret configured' };
  }

  const expected = crypto
    .createHmac('sha256', env.razorpay.webhookSecret)
    .update(rawBody)
    .digest('hex');

  if (!sameSignature(expected, signature)) throw ApiError.badRequest('Invalid webhook signature.');

  let event: WebhookEvent;
  try {
    event = JSON.parse(rawBody.toString('utf8')) as WebhookEvent;
  } catch {
    throw ApiError.badRequest('Webhook body was not valid JSON.');
  }

  const entity = event.payload?.payment?.entity;
  if (!entity?.order_id) return { handled: false, reason: 'no payment in payload' };

  const payment = await Payment.findOne({ orderId: entity.order_id });
  if (!payment) return { handled: false, reason: 'unknown order' };

  if (event.event === 'payment.failed') {
    if (payment.status !== 'paid') {
      payment.status = 'failed';
      payment.failureReason = entity.error_description ?? 'Payment failed at the gateway';
      payment.rawPayload = event as unknown as Record<string, unknown>;
      await payment.save();
    }
    return { handled: true, event: event.event };
  }

  if (event.event !== 'payment.captured' && event.event !== 'payment.authorized') {
    return { handled: false, reason: event.event };
  }

  // The order was created here with the donation's amount, so a mismatch means
  // this event does not belong to it.
  if (typeof entity.amount === 'number' && entity.amount !== payment.amountPaise) {
    throw ApiError.badRequest('Webhook amount does not match the order.');
  }

  payment.paymentId = entity.id;
  payment.method = entity.method;
  payment.status = 'paid';
  payment.verifiedAt = payment.verifiedAt ?? new Date();
  payment.rawPayload = event as unknown as Record<string, unknown>;
  await payment.save();

  await markDonationPaid(payment.donation);

  return { handled: true, event: event.event };
}
