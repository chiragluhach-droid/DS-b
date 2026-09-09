import { z } from 'zod';
import { DONATION_STATUSES } from '../../models/types';

export const createDonationSchema = z.object({
  restaurantSlug: z.string().min(1),
  items: z
    .array(
      z.object({
        menuItemId: z.string().min(1),
        quantity: z.number().int().min(1).max(200),
      })
    )
    .min(1, 'Add at least one dish to donate'),
  donor: z.object({
    // Optional — a donation with no name is recorded as anonymous.
    name: z.string().trim().max(120).optional().or(z.literal('')),
    // Required — the confirmation and tracking link are sent here.
    phone: z
      .string()
      .trim()
      // Normalise to the bare 10 digits so the same person always stores the
      // same value, however they typed it.
      .transform((v) => v.replace(/[\s-]/g, '').replace(/^(\+91|0)/, ''))
      .refine((v) => /^[6-9]\d{9}$/.test(v), 'Enter a valid 10-digit Indian mobile number'),
    message: z.string().trim().max(400).optional().or(z.literal('')),
  }),
});

export const advanceStatusSchema = z.object({
  status: z.enum(DONATION_STATUSES),
  note: z.string().max(500).optional(),
});

export const ngoConfirmSchema = z.object({
  portionsReceived: z.number().int().min(0).max(10000),
  note: z.string().max(500).optional(),
});

export const assignNgoSchema = z.object({ ngoId: z.string().min(1) });

export type CreateDonationInput = z.infer<typeof createDonationSchema>;
