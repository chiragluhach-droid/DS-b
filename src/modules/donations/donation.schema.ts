import { z } from 'zod';

export const createDonationSchema = z.object({
  restaurantSlug: z.string().trim().min(1),
  items: z
    .array(
      z.object({
        menuItemId: z.string().trim().regex(/^[0-9a-fA-F]{24}$/, 'Unknown dish'),
        quantity: z.number().int().min(1).max(200),
      })
    )
    .min(1, 'Add at least one dish to donate')
    .max(20, 'That is a lot of dishes — please split this into separate donations'),
  donor: z.object({
    // Optional — a donation with no name is recorded as anonymous.
    name: z.string().trim().max(120).optional().or(z.literal('')),
    // Required — the donation ID and tracking link belong to this number.
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

export type CreateDonationInput = z.infer<typeof createDonationSchema>;
