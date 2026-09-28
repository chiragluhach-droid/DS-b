/* eslint-disable no-console */
import mongoose, { Types } from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/db';
import { env } from '../config/env';
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
  IDonation,
} from '../models';
import { generateToken, generateQrToken } from '../utils/ids';
import { createDonation, markDonationPaid } from '../modules/donations/donation.service';
import { dispatchBatch, confirmBatchReceipt, Actor } from '../modules/batches/batch.service';
import { images, menuItems, donorPool, donorMessages } from './data';

/**
 * Demo data for Dil Dosa and Parbhat. Every donation here is created through the
 * same service functions the API uses — nothing is written into a state the
 * running platform could not have produced — and then backdated so the
 * dashboards, charts and timelines read like a fortnight of real service.
 */

const PASSWORD = 'DaanSetu@2026';
const RESTAURANT_SLUG = 'dil-dosa';

const HOUR = 60 * 60 * 1000;

/** `days` ago at `hour`:`minute`, so seeded timestamps look like service hours. */
const at = (days: number, hour = 12, minute = 0): Date => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  return d;
};

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;

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

/**
 * Mongoose writes `createdAt` as "now" and marks it immutable, so moving a
 * seeded record back in time has to go through the driver rather than the model.
 */
async function setCreatedAt(
  model: { collection: { updateOne: (f: object, u: object) => Promise<unknown> } },
  filter: object,
  when: Date,
  extra: Record<string, unknown> = {}
) {
  await model.collection.updateOne(filter, { $set: { createdAt: when, ...extra } });
}

/**
 * Each donation is created by the live service code as "now", then moved back so
 * the dashboards, charts and timelines read like a fortnight of real service.
 * Events keep their order by being spaced out from the moment it was funded.
 */
async function backdateDonation(donation: IDonation, fundedAt: Date) {
  await setCreatedAt(Donation, { _id: donation._id }, fundedAt, { updatedAt: fundedAt });
  await setCreatedAt(Payment, { donation: donation._id }, fundedAt, {
    updatedAt: fundedAt,
    verifiedAt: fundedAt,
  });

  const events = await DonationEvent.find({ donation: donation._id }).sort({ createdAt: 1 });
  const stamps: Record<string, Date> = {};
  for (const [index, event] of events.entries()) {
    const when = new Date(fundedAt.getTime() + index * 20 * 60 * 1000);
    await setCreatedAt(DonationEvent, { _id: event._id }, when);
    stamps[event.status] = when;
  }

  const fresh = await Donation.findById(donation._id).select('timestamps_').lean();
  await Donation.collection.updateOne(
    { _id: donation._id },
    { $set: { timestamps_: { ...fresh?.timestamps_, ...stamps } } }
  );
}

async function backdateBatch(batchId: Types.ObjectId, openedAt: Date) {
  await setCreatedAt(Batch, { _id: batchId }, openedAt);
  const events = await BatchEvent.find({ batch: batchId }).sort({ createdAt: 1 });
  for (const [index, event] of events.entries()) {
    await setCreatedAt(BatchEvent, { _id: event._id }, new Date(openedAt.getTime() + index * 3 * HOUR));
  }
}

/** Moves the dates a batch records for readiness, dispatch and receipt. */
async function stampBatch(
  batchId: Types.ObjectId,
  stamps: { readyAt?: Date; dispatchedAt?: Date; receivedAt?: Date }
) {
  await Batch.collection.updateOne({ _id: batchId }, { $set: stamps });
}

async function run() {
  if (env.isProd) {
    throw new Error(
      'Refusing to seed demo data with NODE_ENV=production — this wipes every collection.'
    );
  }

  await connectDatabase();
  console.log(`\n  Seeding DaanSetu → ${mongoose.connection.name}\n`);
  await wipe();

  const passwordHash = await hashPassword(PASSWORD);

  /* ---------------------------------------------------------------- admin */
  const admin = await User.create({
    name: 'Chirag Luhach',
    email: 'admin@daansetu.in',
    phone: '9000000001',
    passwordHash,
    role: 'admin',
  });

  /* ----------------------------------------------------------- restaurant */
  const restaurant = await Restaurant.create({
    name: 'Dil Dosa',
    slug: RESTAURANT_SLUG,
    tagline: 'One griddle at Park Street Market, running a second service every morning.',
    description:
      'Dil Dosa has been at Park Street Market since 2016 — one griddle, two cooks, and a queue that starts at seven. Order a dish on this page and you pay half its menu price; we put in the other half and cook it fresh the next morning. The food goes to Parbhat - An Awakening NGO before noon, and they confirm every plate they receive.',
    cuisine: ['South Indian', 'Vegetarian', 'Dosa'],
    email: 'kitchen@dildosa.in',
    phone: '1294058811',
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
    phone: '9820060011',
    passwordHash,
    role: 'restaurant',
    restaurant: restaurant._id,
  });
  restaurant.owner = restaurantOwner._id;
  await restaurant.save();

  /* ------------------------------------------------------------------ ngo */
  const ngo = await Ngo.create({
    name: 'Parbhat - An Awakening NGO',
    slug: 'parbhat-an-awakening-ngo',
    mission:
      'Parbhat works to empower and uplift marginalised communities across Faridabad — homeless people living with mental health conditions, orphans and underprivileged children, senior citizens and women in need. Alongside its nutrition and healthcare programme it runs livelihood support, education for children, and pad banks in surrounding villages.',
    // The organisation's public contact address. The sign-in account below is a
    // separate demo address, so seeding never creates a login on a real inbox.
    email: 'parbhatanawakening@gmail.com',
    phone: '9716517040',
    registrationNumber: 'HR/2018/0221457',
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
    email: 'parbhat@daansetu.in',
    phone: '9716517040',
    passwordHash,
    role: 'ngo',
    ngo: ngo._id,
  });
  ngo.owner = ngoOwner._id;
  await ngo.save();

  await RestaurantNgoRelationship.create({
    restaurant: restaurant._id,
    ngo: ngo._id,
    status: 'active',
    isPrimary: true,
    note: 'Daily noon handover. Food must leave the kitchen by 11:30am.',
  });
  console.log('  · Dil Dosa and Parbhat created, partnered and approved');

  /* ---------------------------------------------------------------- donor */
  // A registered donor so the "My donations" page has a history to show.
  const donorAccount = await User.create({
    name: 'Ananya Rao',
    email: 'donor@daansetu.in',
    phone: donorPool[0].phone,
    passwordHash,
    role: 'customer',
  });

  /* ----------------------------------------------------------------- menu */
  const items = await MenuItem.insertMany(
    menuItems.map((item) => ({
      ...item,
      restaurant: restaurant._id,
      isVeg: true,
      isAvailable: true,
    }))
  );
  const itemByName = new Map(items.map((i) => [i.name, i]));
  console.log(`  · donation menu created with ${items.length} dishes`);

  /* ------------------------------------------------------------ donations */
  const restaurantActor: Actor = {
    id: restaurantOwner._id.toString(),
    role: 'restaurant',
    name: restaurant.name,
  };
  const ngoActor: Actor = { id: ngoOwner._id.toString(), role: 'ngo', name: ngo.name };

  let donorIndex = 0;
  const totals = { donations: 0, portions: 0, customer: 0, kitchen: 0, food: 0 };

  /** One donation, paid for, funded at the given moment. */
  async function donate(
    lines: { dish: string; quantity: number }[],
    when: Date,
    options: { anonymous?: boolean; registered?: boolean; message?: string } = {}
  ) {
    const donor = donorPool[donorIndex % donorPool.length];
    const message = options.message ?? donorMessages[donorIndex % donorMessages.length];
    donorIndex += 1;

    const { donation } = await createDonation(
      {
        restaurantSlug: RESTAURANT_SLUG,
        items: lines.map((l) => ({
          menuItemId: itemByName.get(l.dish)!._id.toString(),
          quantity: l.quantity,
        })),
        donor: {
          name: options.anonymous ? '' : options.registered ? donorAccount.name : donor.name,
          phone: options.registered ? donorAccount.phone! : donor.phone,
          message,
        },
      },
      options.registered ? donorAccount._id.toString() : undefined
    );

    // The mock gateway's record of a completed payment, then the same
    // markDonationPaid the webhook and verify endpoint both call.
    await Payment.create({
      donation: donation._id,
      provider: 'mock',
      orderId: `order_seed_${generateToken(6)}`,
      paymentId: `pay_seed_${generateToken(6)}`,
      amountPaise: donation.customerPaidPaise,
      currency: 'INR',
      status: 'paid',
      method: ['upi', 'card', 'netbanking'][donorIndex % 3],
      verifiedAt: when,
    });

    const paid = await markDonationPaid(donation._id);
    await backdateDonation(paid ?? donation, when);

    totals.donations += 1;
    totals.portions += donation.totalPortions;
    totals.customer += donation.customerPaidPaise;
    totals.kitchen += donation.restaurantContributionPaise;
    totals.food += donation.totalFoodValuePaise;

    return paid ?? donation;
  }

  /** The batch a dish's portions are currently collecting into. */
  async function batchFor(dish: string, status?: string) {
    const batch = await Batch.findOne({
      restaurant: restaurant._id,
      menuItem: itemByName.get(dish)!._id,
      ...(status ? { status } : {}),
    })
      .sort({ createdAt: -1 })
      .lean();
    if (!batch) throw new Error(`No batch found for ${dish}`);
    return batch;
  }

  /* ---- 1. a batch that went all the way through, twelve days ago -------- */
  await donate([{ dish: 'Masala Dosa', quantity: 4 }], at(12, 9, 20), { registered: true });
  await donate([{ dish: 'Masala Dosa', quantity: 6 }], at(11, 13, 5));
  await donate([{ dish: 'Masala Dosa', quantity: 5 }], at(10, 10, 40), { anonymous: true });
  await donate([{ dish: 'Masala Dosa', quantity: 5 }], at(9, 12, 15));

  let batch = await batchFor('Masala Dosa');
  await stampBatch(batch._id, { readyAt: at(9, 12, 15) });
  await dispatchBatch(
    batch.batchId,
    { restaurant: restaurant._id },
    restaurantActor,
    'Cooked fresh at 9am and driven over with the morning run.'
  );
  await confirmBatchReceipt(
    batch.batchId,
    { ngo: ngo._id },
    20,
    ngoActor,
    'All 20 plates arrived hot and were served at the Udyachand shelter.'
  );
  await stampBatch(batch._id, {
    readyAt: at(9, 12, 15),
    dispatchedAt: at(8, 9, 30),
    receivedAt: at(8, 11, 45),
  });
  await backdateBatch(batch._id, at(12, 9, 20));

  /* ---- 2. a batch the NGO counted short — the flagged one --------------- */
  await donate([{ dish: 'Idli Sambhar', quantity: 5 }], at(8, 8, 45));
  await donate([{ dish: 'Idli Sambhar', quantity: 4 }], at(7, 19, 10), {
    message: 'For the children’s programme — please send something soft.',
  });
  await donate([{ dish: 'Idli Sambhar', quantity: 6 }], at(6, 11, 25), { anonymous: true });

  batch = await batchFor('Idli Sambhar');
  await dispatchBatch(
    batch.batchId,
    { restaurant: restaurant._id },
    restaurantActor,
    '15 portions packed in three insulated carriers.'
  );
  await confirmBatchReceipt(
    batch.batchId,
    { ngo: ngo._id },
    13,
    ngoActor,
    'Two carriers were damaged in transit and could not be served. 13 of 15 portions served.'
  );
  await stampBatch(batch._id, {
    readyAt: at(6, 11, 25),
    dispatchedAt: at(5, 9, 15),
    receivedAt: at(5, 11, 30),
  });
  await backdateBatch(batch._id, at(8, 8, 45));

  /* ---- 3. a batch on its way, waiting on the NGO's count --------------- */
  await donate([{ dish: 'Masala Dosa', quantity: 8 }], at(4, 12, 50), { registered: true });
  await donate([{ dish: 'Masala Dosa', quantity: 6 }], at(3, 17, 35));
  await donate([{ dish: 'Masala Dosa', quantity: 6 }], at(2, 10, 5), {
    message: 'In memory of my father, who ran a tea stall on this very street.',
  });

  batch = await batchFor('Masala Dosa', 'READY_FOR_DELIVERY');
  await dispatchBatch(
    batch.batchId,
    { restaurant: restaurant._id },
    restaurantActor,
    'Sent with the 9:30 run — Parbhat to confirm the count on arrival.'
  );
  await stampBatch(batch._id, { readyAt: at(2, 10, 5), dispatchedAt: at(1, 9, 30) });
  await backdateBatch(batch._id, at(4, 12, 50));

  /* ---- 4. a full batch waiting for the kitchen to cook it -------------- */
  await donate([{ dish: 'Paneer Dosa', quantity: 4 }], at(2, 13, 15));
  await donate([{ dish: 'Paneer Dosa', quantity: 6 }], at(1, 12, 40), { registered: true });
  await stampBatch((await batchFor('Paneer Dosa'))._id, { readyAt: at(1, 12, 40) });
  await backdateBatch((await batchFor('Paneer Dosa'))._id, at(2, 13, 15));

  /* ---- 5. today's donations, still collecting ------------------------- */
  await donate([{ dish: 'Plain Dosa', quantity: 6 }], at(0, 9, 5), { anonymous: true });
  await donate(
    [
      { dish: 'Rava Dosa', quantity: 3 },
      { dish: 'Curd Rice', quantity: 2 },
    ],
    at(0, 11, 20),
    { message: 'Because our team closed a good quarter and this felt like the right way to mark it.' }
  );
  await donate([{ dish: 'Plain Dosa', quantity: 4 }], at(0, 12, 55));
  await backdateBatch((await batchFor('Plain Dosa'))._id, at(0, 9, 5));

  console.log(`  · ${totals.donations} donations seeded across five batches`);

  /* ------------------------------------------------------------ audit log */
  await AuditLog.create([
    {
      actor: admin._id,
      actorEmail: admin.email,
      actorRole: 'admin',
      action: 'restaurant.approved',
      entityType: 'Restaurant',
      entityId: restaurant._id.toString(),
      after: { approvalStatus: 'approved' },
    },
    {
      actor: admin._id,
      actorEmail: admin.email,
      actorRole: 'admin',
      action: 'ngo.approved',
      entityType: 'Ngo',
      entityId: ngo._id.toString(),
      after: { approvalStatus: 'approved' },
    },
  ]);

  /* -------------------------------------------------------------- summary */
  const [flagged, readyToCook, inTransit, sample] = await Promise.all([
    Batch.countDocuments({ status: 'RECONCILIATION_REQUIRED' }),
    Batch.countDocuments({ status: 'READY_FOR_DELIVERY' }),
    Batch.countDocuments({ status: 'DISPATCHED' }),
    Donation.findOne({ status: 'NGO_CONFIRMED' }).select('donationId').lean(),
  ]);

  console.log(`
  ────────────────────────────────────────────────────────────────
   Seed complete.

   Guests paid       ${rupees(totals.customer)}
   Dil Dosa matched  ${rupees(totals.kitchen)}
   Food donated      ${rupees(totals.food)}  (${totals.portions} portions)

   Waiting for someone:
     ${readyToCook} batch ready for Dil Dosa to cook
     ${inTransit} batch with Parbhat to count
     ${flagged} batch flagged for the admin to resolve

   Sign in with password:  ${PASSWORD}

     Admin        admin@daansetu.in
     Restaurant   kitchen@dildosa.in
     NGO          parbhat@daansetu.in
     Donor        donor@daansetu.in

   Guest entry point:  /restaurant/${RESTAURANT_SLUG}
   Tracking sample:    /track/${sample?.donationId ?? '—'}
  ────────────────────────────────────────────────────────────────
`);

  await disconnectDatabase();
  process.exit(0);
}

run().catch(async (err) => {
  console.error('[seed] failed', err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
