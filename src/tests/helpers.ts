import { AddressInfo } from 'net';
import { Server } from 'http';
import mongoose, { Model } from 'mongoose';
import { createApp } from '../app';
import {
  User,
  hashPassword,
  Restaurant,
  Ngo,
  MenuItem,
  Donation,
  DonationEvent,
  Payment,
  RestaurantNgoRelationship,
  AuditLog,
  Batch,
  BatchEvent,
  BatchReceipt,
} from '../models';
import { env } from '../config/env';
import { generateQrToken, slugify } from '../utils/ids';

export const PASSWORD = 'TestPass@2026';

let server: Server;
let baseUrl: string;

export async function startTestServer(): Promise<string> {
  await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 10_000 });
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}/api`;
  // Tests that drive fetch directly (cookie attributes) need the address too.
  process.env.TEST_BASE_URL = baseUrl;
  return baseUrl;
}

export async function stopTestServer(): Promise<void> {
  await new Promise((resolve) => server.close(resolve));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}

export async function resetDatabase(): Promise<void> {
  const models: Model<any>[] = [
      User,
      Restaurant,
      Ngo,
      MenuItem,
      Donation,
      DonationEvent,
      Payment,
      RestaurantNgoRelationship,
      AuditLog,
      Batch,
      BatchEvent,
      BatchReceipt,
  ];
  await Promise.all(models.map((model) => model.deleteMany({})));
}

export interface ApiResponse<T = any> {
  status: number;
  body: { success: boolean; data?: T; error?: { code: string; message: string } };
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  token?: string;
  /** Sends the body as a form post, to test the JSON-only guard. */
  form?: Record<string, string>;
}

export async function api<T = any>(path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  let body: string | undefined;
  if (options.form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(options.form).toString();
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? (body ? 'POST' : 'GET'),
    headers,
    body,
  });

  const text = await res.text();
  return {
    status: res.status,
    body: text ? JSON.parse(text) : { success: false },
  };
}

/** Signs in and returns the bearer token the tests use for that role. */
export async function signIn(email: string): Promise<string> {
  const res = await api<{ accessToken: string }>('/auth/login', {
    body: { email, password: PASSWORD },
  });
  if (!res.body.data?.accessToken) {
    throw new Error(`Could not sign in as ${email}: ${res.body.error?.message}`);
  }
  return res.body.data.accessToken;
}

export interface Fixture {
  admin: { token: string };
  restaurant: { id: string; slug: string; token: string };
  ngo: { id: string; token: string };
  dishes: { dosa: string; idli: string };
}

/**
 * A minimal working platform: one approved kitchen with two dishes, one approved
 * NGO, partnered. Batch targets are small so tests can fill them in a line or two.
 */
export async function createFixture(options: { partnered?: boolean } = {}): Promise<Fixture> {
  const passwordHash = await hashPassword(PASSWORD);

  await User.create({
    name: 'Platform Admin',
    email: 'admin@test.in',
    passwordHash,
    role: 'admin',
  });

  const restaurant = await Restaurant.create({
    name: 'Dil Dosa',
    slug: slugify('Dil Dosa'),
    email: 'kitchen@test.in',
    phone: '9820000001',
    address: { line1: '1 Park Street', city: 'Faridabad', state: 'Haryana', pincode: '121001' },
    approvalStatus: 'approved',
    qrToken: generateQrToken(),
  });

  await User.create({
    name: 'Kitchen Owner',
    email: 'kitchen@test.in',
    passwordHash,
    role: 'restaurant',
    restaurant: restaurant._id,
  });

  const ngo = await Ngo.create({
    name: 'Parbhat',
    slug: 'parbhat',
    email: 'ngo@test.in',
    phone: '9820000002',
    address: { line1: '2 Udyachand', city: 'Faridabad', state: 'Haryana', pincode: '121001' },
    approvalStatus: 'approved',
  });

  await User.create({
    name: 'NGO Coordinator',
    email: 'ngo@test.in',
    passwordHash,
    role: 'ngo',
    ngo: ngo._id,
  });

  if (options.partnered !== false) {
    await RestaurantNgoRelationship.create({
      restaurant: restaurant._id,
      ngo: ngo._id,
      status: 'active',
      isPrimary: true,
    });
  }

  const [dosa, idli] = await MenuItem.insertMany([
    {
      restaurant: restaurant._id,
      name: 'Masala Dosa',
      mrpPaise: 10000,
      batchTarget: 10,
      category: 'Dosa',
    },
    {
      restaurant: restaurant._id,
      name: 'Idli Sambhar',
      mrpPaise: 8000,
      batchTarget: 6,
      category: 'Idli',
    },
  ]);

  return {
    admin: { token: await signIn('admin@test.in') },
    restaurant: {
      id: restaurant._id.toString(),
      slug: restaurant.slug,
      token: await signIn('kitchen@test.in'),
    },
    ngo: { id: ngo._id.toString(), token: await signIn('ngo@test.in') },
    dishes: { dosa: dosa._id.toString(), idli: idli._id.toString() },
  };
}

/** A guest donation, paid for through the mock gateway exactly as the web app does. */
export async function donateAndPay(
  slug: string,
  lines: { menuItemId: string; quantity: number }[],
  donor: { name?: string; phone?: string; message?: string } = {},
  token?: string
): Promise<string> {
  const created = await api<{ donation: { donationId: string } }>('/donations', {
    body: {
      restaurantSlug: slug,
      items: lines,
      donor: { name: donor.name ?? 'Test Donor', phone: donor.phone ?? '9820011223', message: donor.message },
    },
    token,
  });
  if (!created.body.data) throw new Error(`Donation failed: ${created.body.error?.message}`);

  const donationId = created.body.data.donation.donationId;
  const order = await api<{ orderId: string }>('/payments/order', { body: { donationId } });
  if (!order.body.data) throw new Error(`Order failed: ${order.body.error?.message}`);

  const verified = await api('/payments/verify', {
    body: {
      donationId,
      razorpayOrderId: order.body.data.orderId,
      razorpayPaymentId: 'pay_test_1',
      razorpaySignature: 'test_signature',
    },
  });
  if (!verified.body.success) throw new Error(`Verify failed: ${verified.body.error?.message}`);

  return donationId;
}

export const donationById = (donationId: string) => Donation.findOne({ donationId }).lean();
