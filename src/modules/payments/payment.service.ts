import crypto from 'crypto';
import axios from 'axios';
import { Donation, Payment, IDonation } from '../../models';
import { env, paymentsAreLive, liveGateway } from '../../config/env';
import { ApiError } from '../../utils/ApiError';
import { assertDonationsOpen } from '../../models/PlatformSettings';
import { generateToken } from '../../utils/ids';
import { markDonationPaid } from '../donations/donation.service';

// ---------------------------------------------------------------------------
// Cashfree API helpers
// ---------------------------------------------------------------------------

const CF_API_VERSION = '2023-08-01';

function cfBaseUrl(): string {
  return env.cashfree.environment === 'production'
    ? 'https://api.cashfree.com/pg'
    : 'https://sandbox.cashfree.com/pg';
}

function cfHeaders() {
  return {
    'Content-Type': 'application/json',
    'x-api-version': CF_API_VERSION,
    'x-client-id': env.cashfree.appId,
    'x-client-secret': env.cashfree.secretKey,
  };
}

// ---------------------------------------------------------------------------
// Legacy Razorpay (kept for in-flight orders created before the switch)
// ---------------------------------------------------------------------------
let razorpayClient: import('razorpay') | null = null;

function getRazorpayClient(): import('razorpay') | null {
  if (liveGateway === 'razorpay' && !razorpayClient) {
    // Dynamic import at first use so the module is never loaded when Cashfree is configured.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Razorpay = require('razorpay');
    razorpayClient = new Razorpay({ key_id: env.razorpay.keyId, key_secret: env.razorpay.keySecret });
  }
  return razorpayClient;
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

export function gatewayMode(): 'cashfree' | 'razorpay' | 'mock' {
  return liveGateway ?? 'mock';
}

/** Compares two strings without leaking where they differ. */
function sameSignature(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Create Order
// ---------------------------------------------------------------------------

export async function createOrder(donationId: string) {
  // Belt and braces: a donation created a moment before the switch was thrown
  // must not still be able to open a payment. Verification is deliberately not
  // gated — someone who has already been charged must get their donation.
  await assertDonationsOpen();

  const donation = await Donation.findOne({ donationId: donationId.trim().toUpperCase() });
  if (!donation) throw ApiError.notFound('Donation not found.');
  if (donation.isPaid) throw ApiError.conflict('This donation has already been paid for.');
  if (donation.customerPaidPaise < 100) throw ApiError.badRequest('This donation amount is too small.');

  const provider = gatewayMode();
  let orderId: string;
  let paymentSessionId: string | undefined;

  if (provider === 'cashfree') {
    // --- Cashfree: create order via REST API ---
    const cfOrderId = `cf_${donation.donationId}_${Date.now()}`;
    const amountRupees = Number((donation.customerPaidPaise / 100).toFixed(2));

    // Resolve donor info for Cashfree's required customer_details
    const donorPhone = donation.donorSnapshot?.phone ?? '9999999999';
    const donorName = donation.donorSnapshot?.name ?? 'Donor';

    const payload = {
      order_id: cfOrderId,
      order_amount: amountRupees,
      order_currency: 'INR',
      customer_details: {
        customer_id: donation.donor?.toString() ?? `guest_${donation.donationId}`,
        customer_phone: donorPhone.replace(/\D/g, '').slice(-10),
        customer_name: donorName,
      },
      order_note: `Donation ${donation.donationId}`,
      order_meta: {
        notify_url: `${env.appPublicUrl.replace(/\/$/, '')}/api/payments/webhook`,
      },
    };

    try {
      const response = await axios.post(`${cfBaseUrl()}/orders`, payload, { headers: cfHeaders() });
      orderId = response.data.order_id;
      paymentSessionId = response.data.payment_session_id;
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string } }; message?: string };
      const cfMsg =
        axiosErr.response?.data?.message || axiosErr.message || 'Could not create order with Cashfree';
      throw ApiError.badRequest(`Cashfree: ${cfMsg}`);
    }
  } else if (provider === 'razorpay') {
    // --- Legacy Razorpay path ---
    const rpClient = getRazorpayClient()!;
    orderId = (
      await rpClient.orders.create({
        amount: donation.customerPaidPaise,
        currency: 'INR',
        receipt: donation.donationId,
        notes: { donationId: donation.donationId, restaurant: donation.restaurant.toString() },
      })
    ).id;
  } else {
    // --- Mock mode ---
    orderId = `order_mock_${generateToken(8)}`;
  }

  const payment = await Payment.findOneAndUpdate(
    { donation: donation._id },
    {
      donation: donation._id,
      provider,
      orderId,
      paymentSessionId: paymentSessionId ?? undefined,
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
    paymentSessionId: paymentSessionId ?? null,
    amountPaise: donation.customerPaidPaise,
    currency: 'INR',
    // Cashfree uses paymentSessionId; Razorpay uses keyId — only one is non-null.
    keyId: provider === 'razorpay' ? env.razorpay.keyId : null,
    donationId: donation.donationId,
    cfEnvironment: provider === 'cashfree' ? env.cashfree.environment : null,
  };
}

// ---------------------------------------------------------------------------
// Verify Payment
// ---------------------------------------------------------------------------

interface VerifyInput {
  donationId: string;
  orderId: string;
}

/**
 * Server-to-server verification. After the checkout closes the frontend sends
 * the orderId and donationId; we ask Cashfree directly for the order status
 * rather than trusting the browser.
 */
export async function verifyPayment(input: VerifyInput): Promise<IDonation> {
  const donation = await Donation.findOne({ donationId: input.donationId.trim().toUpperCase() });
  if (!donation) throw ApiError.notFound('Donation not found.');

  const payment = await Payment.findOne({ donation: donation._id });
  if (!payment) throw ApiError.badRequest('No payment was started for this donation.');
  if (payment.orderId !== input.orderId) {
    throw ApiError.badRequest('This payment does not belong to that donation.');
  }

  if (donation.isPaid) return donation;

  if (payment.provider === 'cashfree') {
    // --- Server-to-server verification via Cashfree GET /pg/orders/{order_id}/payments ---
    try {
      const paymentsRes = await axios.get(
        `${cfBaseUrl()}/orders/${payment.orderId}/payments`,
        { headers: cfHeaders() }
      );

      const payments = paymentsRes.data as Array<{
        cf_payment_id: number;
        payment_status: string;
        payment_method?: { [key: string]: unknown };
        payment_amount?: number;
        error_detail?: { error_description?: string };
      }>;

      // Find a successful payment
      const success = payments.find((p) => p.payment_status === 'SUCCESS');
      if (!success) {
        const failed = payments.find((p) => p.payment_status === 'FAILED' || p.payment_status === 'CANCELLED');
        payment.status = 'failed';
        payment.failureReason =
          failed?.error_detail?.error_description ?? 'No successful payment found at gateway';
        await payment.save();
        throw ApiError.badRequest('Payment could not be verified. You have not been charged.');
      }

      payment.paymentId = String(success.cf_payment_id);
      payment.method = success.payment_method ? Object.keys(success.payment_method)[0] : undefined;
      payment.status = 'paid';
      payment.verifiedAt = new Date();
      payment.rawPayload = success as unknown as Record<string, unknown>;
      await payment.save();
    } catch (err: unknown) {
      if (err instanceof ApiError) throw err;
      const axiosErr = err as { response?: { data?: { message?: string } }; message?: string };
      const cfMsg =
        axiosErr.response?.data?.message || axiosErr.message || 'Payment verification failed with Cashfree';
      throw ApiError.badRequest(`Cashfree: ${cfMsg}`);
    }
  } else if (payment.provider === 'razorpay') {
    // Legacy Razorpay verification — should not happen for new orders but kept
    // for any in-flight orders that were created before the switch.
    throw ApiError.badRequest('This payment session is out of date. Please start again.');
  } else if (payment.provider === 'mock') {
    // Mock mode: accept anything
    if (paymentsAreLive) {
      throw ApiError.badRequest('This payment session is out of date. Please start again.');
    }
    payment.paymentId = `pay_mock_${Date.now()}`;
    payment.status = 'paid';
    payment.verifiedAt = new Date();
    await payment.save();
  }

  const paid = await markDonationPaid(donation._id);
  return paid ?? donation;
}

// ---------------------------------------------------------------------------
// Webhook (Cashfree)
// ---------------------------------------------------------------------------

interface CashfreeWebhookPayload {
  type: string;
  data: {
    order?: {
      order_id: string;
      order_amount?: number;
      order_currency?: string;
    };
    payment?: {
      cf_payment_id: number;
      payment_status: string;
      payment_amount?: number;
      payment_method?: { [key: string]: unknown };
      error_detail?: { error_description?: string };
    };
  };
}

/**
 * Cashfree webhook — the source of truth when the browser never comes back.
 * Cashfree signs webhooks with: HMAC-SHA256( timestamp + rawBody, secretKey ) → base64.
 */
export async function handleWebhook(rawBody: Buffer, signature: string, timestamp: string) {
  if (!env.cashfree.secretKey) {
    return { handled: false, reason: 'no Cashfree secret configured' };
  }

  // Verify signature: HMAC-SHA256(timestamp + rawBody) encoded as base64
  const expected = crypto
    .createHmac('sha256', env.cashfree.secretKey)
    .update(timestamp + rawBody.toString('utf8'))
    .digest('base64');

  if (!sameSignature(expected, signature)) {
    throw ApiError.badRequest('Invalid webhook signature.');
  }

  let event: CashfreeWebhookPayload;
  try {
    event = JSON.parse(rawBody.toString('utf8')) as CashfreeWebhookPayload;
  } catch {
    throw ApiError.badRequest('Webhook body was not valid JSON.');
  }

  const orderId = event.data?.order?.order_id;
  if (!orderId) return { handled: false, reason: 'no order_id in payload' };

  const payment = await Payment.findOne({ orderId });
  if (!payment) return { handled: false, reason: 'unknown order' };

  const paymentData = event.data?.payment;
  if (!paymentData) return { handled: false, reason: 'no payment data in webhook' };

  const status = paymentData.payment_status;

  if (status === 'FAILED' || status === 'CANCELLED') {
    if (payment.status !== 'paid') {
      payment.status = 'failed';
      payment.failureReason =
        paymentData.error_detail?.error_description ?? 'Payment failed at the gateway';
      payment.rawPayload = event as unknown as Record<string, unknown>;
      await payment.save();
    }
    return { handled: true, event: event.type };
  }

  if (status !== 'SUCCESS') {
    return { handled: false, reason: `unhandled payment_status: ${status}` };
  }

  // Amount verification (Cashfree amounts are in rupees)
  if (typeof paymentData.payment_amount === 'number') {
    const webhookAmountPaise = Math.round(paymentData.payment_amount * 100);
    if (webhookAmountPaise !== payment.amountPaise) {
      throw ApiError.badRequest('Webhook amount does not match the order.');
    }
  }

  payment.paymentId = String(paymentData.cf_payment_id);
  payment.method = paymentData.payment_method
    ? Object.keys(paymentData.payment_method)[0]
    : undefined;
  payment.status = 'paid';
  payment.verifiedAt = payment.verifiedAt ?? new Date();
  payment.rawPayload = event as unknown as Record<string, unknown>;
  await payment.save();

  await markDonationPaid(payment.donation);

  return { handled: true, event: event.type };
}
