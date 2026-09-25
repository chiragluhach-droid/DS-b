/* eslint-disable no-console */
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/db';
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
  DONATION_STATUSES,
  DonationStatus,
  AnyDonationStatus,
  IDonationItemSnapshot,
  splitPrice,
  DEFAULT_CUSTOMER_SHARE_PERCENT,
  Batch,
  BatchEvent,
  BatchReceipt,
} from '../models';
import { generateDonationId, generateToken, generateQrToken } from '../utils/ids';
import { images, menuItems, donorPool, donorMessages } from './data';

const PASSWORD = 'DaanSetu@2026';

const daysAgo = (n: number, hour = 12) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, (n * 17) % 59, 0, 0);
  return d;
};

const EVENT_COPY: Partial<Record<AnyDonationStatus, { title: string; note: string }>> = {
  PENDING_PAYMENT: {
    title: 'Payment Pending',
    note: 'Waiting for payment confirmation.',
  },
  PAYMENT_SUCCESS: {
    title: 'Payment Successful',
    note: 'Your contribution was received successfully.',
  },
  ASSIGNED_TO_BATCH: {
    title: 'Assigned to Batch',
    note: 'Your donation has been assigned to a delivery batch.',
  },
  REFUNDED: {
    title: 'Refunded',
    note: 'Your donation was refunded.',
  },
  FAILED: {
    title: 'Failed',
    note: 'Your payment failed.',
  },
};

async function wipe() {
  await Promise.all([
    User.deleteMany({}),
    Restaurant.deleteMany({}),
    Ngo.deleteMany({}),
    MenuItem.deleteMany({}),
    Donation.deleteMany({}),
    DonationEvent.deleteMany({}),
    Payment.deleteMany({}),
    RestaurantNgoRelationship.deleteMany({}),
    AuditLog.deleteMany({}),
    Batch.deleteMany({}),
    BatchEvent.deleteMany({}),
    BatchReceipt.deleteMany({}),
  ]);
  console.log('  · cleared existing collections');
}

async function run() {
  await connectDatabase();
  console.log('\n  Seeding DaanSetu…\n');
  await wipe();

  const passwordHash = await hashPassword(PASSWORD);

  /* ---------------------------------------------------------------- admin */
  const admin = await User.create({
    name: 'Chirag Luhach',
    email: 'admin@daansetu.in',
    phone: '+91 90000 00001',
    passwordHash,
    role: 'admin',
  });
  console.log('  · admin created');

  /* ----------------------------------------------------------- restaurant */
  const restaurant = await Restaurant.create({
    name: 'Dil Dosa',
    slug: 'dil-dosa',
    tagline: 'One griddle at Park Street Market, running a second service every morning.',
    description:
      'Dil Dosa has been at Park Street Market since 2016 — one griddle, two cooks, and a queue that starts at seven. Order a dish on this page and you pay half its menu price; we put in the other half and cook it fresh the next morning. The food goes to Parbhat - An Awakening NGO before noon, and they confirm every plate they receive.',
    cuisine: ['South Indian', 'Vegetarian', 'Dosa'],
    email: 'kitchen@dildosa.in',
    phone: '+91 129 405 8811',
    address: {
      line1: 'BPTP Park Street Market',
      city: 'Faridabad',
      state: 'Haryana',
      pincode: '121001',
    },
    coverImage: images.restaurantCover,
    logoImage: images.restaurantLogo,
    fssaiLicense: '11522003000512',
    gstin: '06AABCS1429B1ZP',
    approvalStatus: 'approved',
    isAcceptingDonations: true,
    qrToken: generateQrToken(),
  });

  const restaurantOwner = await User.create({
    name: 'Nikhil Fernandes',
    email: 'kitchen@dildosa.in',
    phone: '+91 98200 60011',
    passwordHash,
    role: 'restaurant',
    restaurant: restaurant._id,
  });
  restaurant.owner = restaurantOwner._id;
  await restaurant.save();
  console.log(`  · restaurant created → /restaurant/${restaurant.slug}`);

  /* ------------------------------------------------------------------ ngo */
  const ngo = await Ngo.create({
    name: 'Parbhat - An Awakening NGO',
    slug: 'parbhat-an-awakening-ngo',
    mission:
      'Parbhat works to empower and uplift marginalised communities across Faridabad — homeless people living with mental health conditions, orphans and underprivileged children, senior citizens and women in need. Alongside its nutrition and healthcare programme it runs livelihood support, education for children, and pad banks in surrounding villages.',
    email: 'parbhatanawakening@gmail.com',
    phone: '+91 97165 17040',
    website: 'https://parbhatanawakening.org/',
    address: {
      line1: 'Udyachand Enclave',
      city: 'Faridabad',
      state: 'Haryana',
      pincode: '121001',
    },
    logoImage: images.ngoLogo,
    coverImage: images.ngoCover,
    beneficiaryFocus: [
      'Children with special needs',
      'Orphans & underprivileged children',
      'Women in need',
    ],
    dailyCapacity: 1200,
    approvalStatus: 'approved',
  });

  const ngoOwner = await User.create({
    name: 'Sunita Bhardwaj',
    email: 'parbhatanawakening@gmail.com',
    phone: '+91 98200 70022',
    passwordHash,
    role: 'ngo',
    ngo: ngo._id,
  });
  ngo.owner = ngoOwner._id;
  await ngo.save();

  // A second NGO left pending so the admin approval queue is not empty.
  await Ngo.create({
    name: 'Roti Ghar Collective',
    slug: 'roti-ghar-collective',
    mission:
      'A volunteer network distributing evening meals across Dadar and Sion railway platforms.',
    email: 'hello@rotighar.org',
    phone: '+91 22 2409 3311',
    address: {
      line1: '22 Platform Road, Dadar East',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400014',
    },
    logoImage: images.ngoLogoAlt,
    beneficiaryFocus: ['Railway platform communities'],
    dailyCapacity: 400,
    approvalStatus: 'pending',
  });
  console.log('  · ngos created (1 approved, 1 pending approval)');

  await RestaurantNgoRelationship.create({
    restaurant: restaurant._id,
    ngo: ngo._id,
    status: 'active',
    isPrimary: true,
    note: 'Daily noon handover. Food must leave the kitchen by 11:30am.',
  });

  /* ----------------------------------------------------------------- menu */
  const items = await MenuItem.insertMany(
    menuItems.map((item) => ({
      ...item,
      customerSharePercent: DEFAULT_CUSTOMER_SHARE_PERCENT,
      restaurant: restaurant._id,
      isVeg: true,
      isAvailable: true,
    }))
  );
  console.log(`  · menu created with ${items.length} dishes`);

  /* ------------------------------------------------------------ donations */
  // A spread across the lifecycle so every dashboard has something real in it.
  // Quantities are chosen so the seeded totals land on 41 portions / ₹5,695
  // of food — the figures the partner card shows.
  const plan: {
    lines: { idx: number; qty: number }[];
    stage: DonationStatus;
    age: number;
    anon?: boolean;
  }[] = [
    { lines: [{ idx: 2, qty: 4 }], stage: 'ASSIGNED_TO_BATCH', age: 12 },
    { lines: [{ idx: 9, qty: 3 }, { idx: 5, qty: 2 }], stage: 'ASSIGNED_TO_BATCH', age: 9 },
    { lines: [{ idx: 2, qty: 5 }], stage: 'ASSIGNED_TO_BATCH', age: 7, anon: true },
    { lines: [{ idx: 5, qty: 3 }, { idx: 4, qty: 2 }], stage: 'ASSIGNED_TO_BATCH', age: 5 },
    { lines: [{ idx: 7, qty: 3 }, { idx: 11, qty: 1 }], stage: 'ASSIGNED_TO_BATCH', age: 3 },
    { lines: [{ idx: 2, qty: 3 }, { idx: 8, qty: 1 }], stage: 'ASSIGNED_TO_BATCH', age: 1 },
    { lines: [{ idx: 9, qty: 3 }], stage: 'ASSIGNED_TO_BATCH', age: 1 },
    { lines: [{ idx: 2, qty: 3 }, { idx: 5, qty: 2 }], stage: 'PAYMENT_SUCCESS', age: 0 },
    {
      lines: [{ idx: 9, qty: 2 }, { idx: 4, qty: 2 }, { idx: 8, qty: 2 }],
      stage: 'PAYMENT_SUCCESS',
      age: 0,
      anon: true,
    },
  ];

  let totals = { donations: 0, portions: 0, customer: 0, restaurantShare: 0, foodValue: 0 };
  let ngoTotals = { portions: 0, confirmed: 0 };

  for (let i = 0; i < plan.length; i += 1) {
    const row = plan[i];
    const donorInfo = donorPool[i % donorPool.length];
    const createdAt = daysAgo(row.age, 10 + (i % 8));

    const donorUser = await User.findOneAndUpdate(
      { email: donorInfo.email },
      {
        $setOnInsert: {
          name: donorInfo.name,
          email: donorInfo.email,
          phone: donorInfo.phone,
          role: 'customer',
          isGuest: true,
        },
      },
      { upsert: true, new: true }
    );

    const snapshots: IDonationItemSnapshot[] = row.lines.map((line) => {
      const item = items[line.idx];
      const { customerPaysPaise, restaurantPaysPaise } = splitPrice(
        item.mrpPaise,
        item.customerSharePercent
      );
      return {
        menuItem: item._id,
        name: item.name,
        image: item.image,
        quantity: line.qty,
        mrpPaise: item.mrpPaise,
        customerSharePercent: item.customerSharePercent,
        customerPaysPaise,
        restaurantPaysPaise,
        lineCustomerPaise: customerPaysPaise * line.qty,
        lineRestaurantPaise: restaurantPaysPaise * line.qty,
        lineFoodValuePaise: item.mrpPaise * line.qty,
      };
    });

    const totalPortions = snapshots.reduce((s, x) => s + x.quantity, 0);
    const customerPaidPaise = snapshots.reduce((s, x) => s + x.lineCustomerPaise, 0);
    const restaurantContributionPaise = snapshots.reduce((s, x) => s + x.lineRestaurantPaise, 0);
    const totalFoodValuePaise = customerPaidPaise + restaurantContributionPaise;

    const stageIdx = DONATION_STATUSES.indexOf(row.stage);
    const reached = DONATION_STATUSES.slice(0, stageIdx + 1);
    const stamps: Record<string, Date> = {};
    reached.forEach((s, idx) => {
      stamps[s] = new Date(createdAt.getTime() + idx * 110 * 60 * 1000);
    });

    // One confirmed donation arrives short, to exercise the discrepancy flow.
    const isShort = i === 2;
    const portionsReceived = isShort ? totalPortions - 2 : totalPortions;
    const isClosed = row.stage === 'ASSIGNED_TO_BATCH';

    const donation = await Donation.create({
      donationId: generateDonationId(),
      restaurant: restaurant._id,
      ngo: ngo._id,
      donor: donorUser._id,
      donorSnapshot: {
        name: donorInfo.name,
        email: donorInfo.email,
        phone: donorInfo.phone,
        isAnonymous: row.anon ?? false,
        message: donorMessages[i % donorMessages.length] || undefined,
      },
      items: snapshots,
      totalPortions,
      customerPaidPaise,
      restaurantContributionPaise,
      totalFoodValuePaise,
      status: row.stage,
      isPaid: true,
      timestamps_: stamps,
      createdAt,
      ...(isClosed
        ? {
            portionsReceived,
            ...(isShort
              ? {
                  discrepancy: {
                    hasDiscrepancy: true,
                    reportedBy: ngoOwner._id,
                    note: `Two boxes were damaged in transit and could not be served. Expected ${totalPortions}, served ${portionsReceived}.`,
                    reportedAt: new Date(createdAt.getTime() + 6 * 60 * 60 * 1000),
                  },
                }
              : {}),
          }
        : {}),
    });

    const payment = await Payment.create({
      donation: donation._id,
      provider: 'mock',
      orderId: `order_seed_${generateToken(6)}`,
      paymentId: `pay_seed_${generateToken(6)}`,
      amountPaise: customerPaidPaise,
      currency: 'INR',
      status: 'paid',
      method: ['upi', 'card', 'netbanking'][i % 3],
      verifiedAt: createdAt,
    });
    donation.payment = payment._id;
    await donation.save();

    for (const status of reached) {
      const copy = EVENT_COPY[status]!;
      const isFinal = status === 'ASSIGNED_TO_BATCH';
      await DonationEvent.create({
        donation: donation._id,
        status,
        title: copy.title,
        note: isFinal
          ? isShort
            ? `Received ${portionsReceived} of ${totalPortions} expected portions. Flagged for review.`
            : `All ${portionsReceived} portions were received and served.`
          : copy.note,
        actorRole: status === 'PAYMENT_SUCCESS' ? 'system' : isFinal ? 'ngo' : 'restaurant',
        actorName: status === 'PAYMENT_SUCCESS' ? 'DaanSetu' : isFinal ? ngo.name : restaurant.name,
        actor: status === 'PAYMENT_SUCCESS' ? undefined : isFinal ? ngoOwner._id : restaurantOwner._id,
        createdAt: stamps[status],
        ...(isFinal
          ? { metadata: { portionsReceived, expected: totalPortions, hasDiscrepancy: isShort } }
          : {}),
      });
    }

    totals = {
      donations: totals.donations + 1,
      portions: totals.portions + totalPortions,
      customer: totals.customer + customerPaidPaise,
      restaurantShare: totals.restaurantShare + restaurantContributionPaise,
      foodValue: totals.foodValue + totalFoodValuePaise,
    };
    if (isClosed) {
      ngoTotals = {
        portions: ngoTotals.portions + portionsReceived,
        confirmed: ngoTotals.confirmed + 1,
      };
    }
  }

  await Restaurant.findByIdAndUpdate(restaurant._id, {
    stats: {
      totalDonations: totals.donations,
      totalPortions: totals.portions,
      customerContributionPaise: totals.customer,
      restaurantContributionPaise: totals.restaurantShare,
      totalFoodValuePaise: totals.foodValue,
    },
  });
  await Ngo.findByIdAndUpdate(ngo._id, {
    stats: { portionsReceived: ngoTotals.portions, donationsConfirmed: ngoTotals.confirmed },
  });

  /* ---------------------------------------------------------------- Batches */
  const batchDefinitions: Array<{ status: any; qty: number; target: number; itemIdx: number; received?: number }> = [
    { status: 'IN_PROGRESS', qty: 22, target: 40, itemIdx: 0 },
    { status: 'READY_FOR_DELIVERY', qty: 40, target: 40, itemIdx: 1 },
    { status: 'DISPATCHED', qty: 40, target: 40, itemIdx: 2 },
    { status: 'COMPLETED', qty: 40, target: 40, itemIdx: 3 },
    { status: 'RECONCILIATION_REQUIRED', qty: 40, target: 40, itemIdx: 4, received: 35 },
  ];

  for (const bDef of batchDefinitions) {
    const item = items[bDef.itemIdx];
    const bId = generateToken(8).toUpperCase();
    const b = await Batch.create({
      batchId: bId,
      restaurant: restaurant._id,
      ngo: ngo._id,
      menuItem: item._id,
      itemName: item.name,
      targetQuantity: bDef.target,
      collectedQuantity: bDef.qty,
      donationCount: Math.ceil(bDef.qty / 2),
      status: bDef.status,
      dispatchedQuantity: bDef.status !== 'IN_PROGRESS' && bDef.status !== 'READY_FOR_DELIVERY' ? bDef.qty : 0,
      receivedQuantity: bDef.received ? bDef.received : (bDef.status === 'COMPLETED' ? bDef.qty : 0),
      createdAt: daysAgo(5, 10),
      dispatchedAt: bDef.status === 'DISPATCHED' || bDef.status === 'COMPLETED' || bDef.status === 'RECONCILIATION_REQUIRED' ? daysAgo(2, 11) : undefined,
      receivedAt: bDef.status === 'COMPLETED' || bDef.status === 'RECONCILIATION_REQUIRED' ? daysAgo(1, 12) : undefined,
    });
    
    const relatedDonations = await Donation.find({ 'items.menuItem': item._id, status: 'ASSIGNED_TO_BATCH' });
    for (const donation of relatedDonations) {
      donation.items.forEach((i: any) => {
        if (i.menuItem.toString() === item._id.toString()) {
          i.batch = b._id;
        }
      });
      await donation.save();
    }
  }
  console.log(`  · 5 batches created across lifecycle`);

  console.log(`  · ${plan.length} donations seeded across the full lifecycle`);

  await AuditLog.create({
    actor: admin._id,
    actorEmail: admin.email,
    actorRole: 'admin',
    action: 'restaurant.approved',
    entityType: 'Restaurant',
    entityId: restaurant._id.toString(),
    after: { approvalStatus: 'approved' },
  });

  const sample = await Donation.findOne({ status: 'ASSIGNED_TO_BATCH' }).select('donationId');
  const rupees = (p: number) => `₹${(p / 100).toLocaleString('en-IN')}`;

  console.log(`
  ────────────────────────────────────────────────────────
   Seed complete.

   Guests paid       ${rupees(totals.customer)}
   Dil Dosa matched  ${rupees(totals.restaurantShare)}
   Food donated      ${rupees(totals.foodValue)}  (${totals.portions} portions)

   Sign in with password:  ${PASSWORD}

     Admin        admin@daansetu.in
     Restaurant   kitchen@dildosa.in
     NGO          parbhatanawakening@gmail.com

   Customer entry point:  /restaurant/${restaurant.slug}
   Live tracking sample:  /track/${sample?.donationId}
  ────────────────────────────────────────────────────────
`);

  await disconnectDatabase();
  process.exit(0);
}

run().catch(async (err) => {
  console.error('[seed] failed', err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
