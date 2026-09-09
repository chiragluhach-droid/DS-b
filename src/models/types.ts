export const ROLES = ['customer', 'restaurant', 'ngo', 'admin'] as const;
export type Role = (typeof ROLES)[number];

/** The controlled donation lifecycle. Order matters — transitions validate against it. */
export const DONATION_STATUSES = ['DONATED', 'HANDED_OVER', 'NGO_CONFIRMED'] as const;
export type DonationStatus = (typeof DONATION_STATUSES)[number];

export const TERMINAL_STATUSES = ['CANCELLED', 'REFUNDED'] as const;
export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

export type AnyDonationStatus = DonationStatus | TerminalStatus;

export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'suspended'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const PAYMENT_STATUSES = ['created', 'paid', 'failed', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Which role may move a donation into a given status. */
export const STATUS_ACTOR: Record<DonationStatus, Role[]> = {
  DONATED: ['customer', 'admin'],
  HANDED_OVER: ['restaurant', 'admin'],
  NGO_CONFIRMED: ['ngo', 'admin'],
};

/** The default split: the guest funds half a plate, the kitchen funds the other half. */
export const DEFAULT_CUSTOMER_SHARE_PERCENT = 50;

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
