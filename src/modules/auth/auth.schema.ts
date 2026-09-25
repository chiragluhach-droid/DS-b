import { z } from 'zod';

const email = z.string().trim().email('Enter a valid email address');
const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters');
const phone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .refine((v) => /^(\+91|0)?[6-9]\d{9}$|^\+?\d{8,15}$/.test(v), 'Enter a valid phone number');

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Please enter your full name').max(120),
  email,
  password,
  phone: phone.optional().or(z.literal('').transform(() => undefined)),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required').max(128),
});

const account = z.object({
  name: z.string().trim().min(2, 'Please enter the contact person’s full name').max(120),
  email,
  password,
  phone,
});

const address = z.object({
  line1: z.string().trim().min(3, 'Enter the street address').max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(2, 'Enter the city').max(80),
  state: z.string().trim().min(2, 'Enter the state').max(80),
  pincode: z.string().trim().regex(/^\d{6}$/, 'Enter a 6-digit pincode'),
});

export const registerRestaurantSchema = z.object({
  account,
  restaurant: z.object({
    name: z.string().trim().min(2, 'Enter the restaurant’s name').max(140),
    phone,
    address,
    cuisine: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
    description: z.string().trim().max(2000).optional(),
    fssaiLicense: z
      .string()
      .trim()
      .regex(/^\d{14}$/, 'An FSSAI licence number is 14 digits'),
    gstin: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[0-9A-Z]{15}$/, 'A GSTIN is 15 characters')
      .optional()
      .or(z.literal('').transform(() => undefined)),
  }),
});

export const registerNgoSchema = z.object({
  account,
  ngo: z.object({
    name: z.string().trim().min(2, 'Enter the organisation’s name').max(140),
    phone,
    address: address.omit({ line2: true }),
    registrationNumber: z.string().trim().min(3, 'Enter your registration number').max(80),
    website: z
      .string()
      .trim()
      .url('Enter a full URL including https://')
      .optional()
      .or(z.literal('').transform(() => undefined)),
    mission: z.string().trim().max(2000).optional(),
    beneficiaryFocus: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
    dailyCapacity: z.number().int().min(1).max(100000).default(100),
  }),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterRestaurantInput = z.infer<typeof registerRestaurantSchema>;
export type RegisterNgoInput = z.infer<typeof registerNgoSchema>;
