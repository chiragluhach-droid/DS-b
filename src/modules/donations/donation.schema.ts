import { z } from 'zod';
import { normalizePhone, INDIAN_MOBILE } from '../../utils/phone';

/**
 * Normalised to the bare 10 digits, so the number stored at checkout is the
 * same string a donor later types to look their donations up.
 */
const donorPhone = z
  .string()
  .trim()
  .transform(normalizePhone)
  .refine((v) => INDIAN_MOBILE.test(v), 'Enter a valid 10-digit Indian mobile number');

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
    phone: donorPhone,
    message: z.string().trim().max(400).optional().or(z.literal('')),
    /**
     * Publishing is opt-in and separate from giving a name: a donor may want
     * their receipt in their own name and still not appear on a public page.
     * Absent means no, which is what an unticked box sends.
     */
    consentPublicName: z.boolean().default(false),
    consentPublicMessage: z.boolean().default(false),
  }),
});

export type CreateDonationInput = z.infer<typeof createDonationSchema>;

/** Step one of looking up a history: prove you hold the number. */
export const requestHistoryOtpSchema = z.object({ phone: donorPhone });

/** Step two: the code that was issued for that number. */
export const donorHistorySchema = z.object({
  phone: donorPhone,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'The code is six digits'),
});
