export const ROLES = ['customer', 'restaurant', 'ngo', 'admin'] as const;
export type Role = (typeof ROLES)[number];

/**
 * The donation lifecycle, in order. A donation is never moved by hand: payment
 * verification sets the first two steps, and every later step is derived from
 * the batches its dishes were cooked in (see donation.service syncDonationStatus).
 *
 * UNDER_REVIEW sits before NGO_CONFIRMED on purpose: when an NGO counts fewer
 * portions than were sent, the donation stops there and says so. It only reaches
 * NGO_CONFIRMED once every batch it is part of is closed — a receipt is evidence
 * of arrival, never automatic proof that the food was served.
 */
export const DONATION_STATUSES = [
  'PENDING_PAYMENT',
  'PAYMENT_SUCCESS',
  'ASSIGNED_TO_BATCH',
  'DISPATCHED',
  'UNDER_REVIEW',
  'NGO_CONFIRMED',
] as const;
export type DonationStatus = (typeof DONATION_STATUSES)[number];

/** Statuses a donation can leave the lifecycle through. Nothing moves out of these. */
export const TERMINAL_STATUSES = ['FAILED', 'REFUNDED', 'CANCELLED'] as const;
export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

export type AnyDonationStatus = DonationStatus | TerminalStatus;

/**
 * A batch collects funded portions of one dish for one NGO until the kitchen
 * cooks and sends it. RECONCILIATION_REQUIRED means the NGO counted a different
 * number than was dispatched; an admin closes it to COMPLETED.
 */
export const BATCH_STATUSES = [
  'IN_PROGRESS',
  'READY_FOR_DELIVERY',
  'DISPATCHED',
  'RECONCILIATION_REQUIRED',
  'COMPLETED',
] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

/** Batches that are still collecting and may be dispatched. */
export const OPEN_BATCH_STATUSES: BatchStatus[] = ['IN_PROGRESS', 'READY_FOR_DELIVERY'];
/** Batches the NGO has counted, whether or not the count matched. */
export const RECEIVED_BATCH_STATUSES: BatchStatus[] = ['RECONCILIATION_REQUIRED', 'COMPLETED'];

export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'suspended'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const PAYMENT_STATUSES = ['created', 'paid', 'failed', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * The split is the platform's promise — the guest funds half a plate and the
 * kitchen funds the other half — so it is fixed here rather than set per dish.
 *
 * Rounding rule: the guest's share is rounded to the nearest paisa and the
 * kitchen covers the remainder, so the two always sum to the menu price exactly.
 * A ₹95 dish is ₹47.50 + ₹47.50, and is displayed to the paisa rather than
 * rounded to whole rupees on each side (which would read as ₹48 + ₹48 = ₹96).
 */
export const DEFAULT_CUSTOMER_SHARE_PERCENT = 50;

/**
 * Publishing a donor's name or message needs their explicit, unticked consent.
 * The version is stored with each grant so a later policy change is auditable.
 */
export const PUBLIC_CONSENT_POLICY_VERSION = '2026-10-02';

/** Portions a batch collects before it is marked ready, unless the dish sets its own. */
export const DEFAULT_BATCH_TARGET = 40;

/**
 * The single place the split is computed. Customer share is rounded, and the
 * restaurant covers whatever remains, so the two always sum to the MRP exactly.
 */
export function splitPrice(mrpPaise: number, customerSharePercent: number) {
  const customerPaysPaise = Math.round((mrpPaise * customerSharePercent) / 100);
  return {
    customerPaysPaise,
    restaurantPaysPaise: mrpPaise - customerPaysPaise,
  };
}
