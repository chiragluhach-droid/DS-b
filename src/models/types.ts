export const ROLES = ['customer', 'restaurant', 'ngo', 'admin'] as const;
export type Role = (typeof ROLES)[number];

/**
 * The donation lifecycle, in order. A donation is never moved by hand: payment
 * verification sets the first two steps, and every later step is derived from
 * the batches its dishes were cooked in (see donation.service syncDonationStatus).
 */
export const DONATION_STATUSES = [
  'PENDING_PAYMENT',
  'PAYMENT_SUCCESS',
  'ASSIGNED_TO_BATCH',
  'DISPATCHED',
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
 */
export const DEFAULT_CUSTOMER_SHARE_PERCENT = 50;

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
