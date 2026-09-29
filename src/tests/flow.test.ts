import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Batch, Donation, Restaurant, User } from '../models';
import {
  api,
  createFixture,
  donateAndPay,
  donationById,
  resetDatabase,
  signIn,
  startTestServer,
  stopTestServer,
  PASSWORD,
} from './helpers';

before(startTestServer);
after(stopTestServer);
beforeEach(resetDatabase);

/* ----------------------------------------------------------- the happy path */

test('a paid donation joins a batch and the donor can follow it to the NGO', async () => {
  const fx = await createFixture();

  const donationId = await donateAndPay(fx.restaurant.slug, [
    { menuItemId: fx.dishes.dosa, quantity: 4 },
  ]);

  let donation = await donationById(donationId);
  assert.equal(donation?.status, 'ASSIGNED_TO_BATCH');
  assert.equal(donation?.isPaid, true);
  // ₹100 dish: guest pays ₹50, kitchen matches ₹50, ₹100 of food per portion.
  assert.equal(donation?.customerPaidPaise, 20000);
  assert.equal(donation?.restaurantContributionPaise, 20000);
  assert.equal(donation?.totalFoodValuePaise, 40000);

  const batch = await Batch.findOne({ menuItem: fx.dishes.dosa }).lean();
  assert.equal(batch?.collectedQuantity, 4);
  assert.equal(batch?.status, 'IN_PROGRESS');
  assert.equal(batch?.donationCount, 1);

  // The kitchen sends what it collected; the quantity is not typed in by hand.
  const dispatched = await api(`/batches/${batch!.batchId}/dispatch`, {
    token: fx.restaurant.token,
    body: { note: 'Sent with the morning run.' },
  });
  assert.equal(dispatched.status, 200);
  assert.equal(dispatched.body.data.batch.dispatchedQuantity, 4);

  donation = await donationById(donationId);
  assert.equal(donation?.status, 'DISPATCHED');

  const confirmed = await api(`/batches/${batch!.batchId}/confirm`, {
    token: fx.ngo.token,
    body: { receivedQuantity: 4 },
  });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.data.batch.status, 'COMPLETED');

  donation = await donationById(donationId);
  assert.equal(donation?.status, 'NGO_CONFIRMED');

  // The donor's public page shows every step, signed by whoever took it.
  const tracked = await api(`/donations/${donationId}/track`);
  assert.equal(tracked.status, 200);
  const statuses = tracked.body.data.timeline.map((e: { status: string }) => e.status);
  assert.deepEqual(statuses, [
    'PAYMENT_SUCCESS',
    'ASSIGNED_TO_BATCH',
    'DISPATCHED',
    'NGO_CONFIRMED',
  ]);
  const roles = tracked.body.data.timeline.map((e: { actorRole: string }) => e.actorRole);
  assert.deepEqual(roles, ['system', 'system', 'restaurant', 'ngo']);
  assert.equal(tracked.body.data.batches[0].receivedQuantity, 4);
});

test('a donation of two dishes is counted into one batch per dish', async () => {
  const fx = await createFixture();

  const donationId = await donateAndPay(fx.restaurant.slug, [
    { menuItemId: fx.dishes.dosa, quantity: 3 },
    { menuItemId: fx.dishes.idli, quantity: 2 },
  ]);

  const dosaBatch = await Batch.findOne({ menuItem: fx.dishes.dosa }).lean();
  const idliBatch = await Batch.findOne({ menuItem: fx.dishes.idli }).lean();

  // The bug this guards against put all five portions into the first dish's batch.
  assert.equal(dosaBatch?.collectedQuantity, 3);
  assert.equal(idliBatch?.collectedQuantity, 2);

  const donation = await donationById(donationId);
  assert.equal(donation?.items.length, 2);
  assert.ok(donation?.items.every((i) => i.batch));

  // Sending only the dosas does not make the whole donation "sent".
  await api(`/batches/${dosaBatch!.batchId}/dispatch`, { token: fx.restaurant.token, body: {} });
  assert.equal((await donationById(donationId))?.status, 'ASSIGNED_TO_BATCH');

  await api(`/batches/${idliBatch!.batchId}/dispatch`, { token: fx.restaurant.token, body: {} });
  assert.equal((await donationById(donationId))?.status, 'DISPATCHED');
});

test('a batch that reaches its target stops collecting and waits for the kitchen', async () => {
  const fx = await createFixture();

  await donateAndPay(fx.restaurant.slug, [{ menuItemId: fx.dishes.idli, quantity: 4 }]);
  assert.equal((await Batch.findOne({ menuItem: fx.dishes.idli }).lean())?.status, 'IN_PROGRESS');

  // Target for idli is 6.
  await donateAndPay(fx.restaurant.slug, [{ menuItemId: fx.dishes.idli, quantity: 2 }]);
  const full = await Batch.findOne({ menuItem: fx.dishes.idli }).lean();
  assert.equal(full?.status, 'READY_FOR_DELIVERY');
  assert.equal(full?.collectedQuantity, 6);
  assert.ok(full?.readyAt);

  // The next donation opens a fresh batch rather than joining a full one.
  await donateAndPay(fx.restaurant.slug, [{ menuItemId: fx.dishes.idli, quantity: 1 }]);
  assert.equal(await Batch.countDocuments({ menuItem: fx.dishes.idli }), 2);
});

/* ------------------------------------------------------------- money safety */

test('verifying the same payment twice counts the donation once', async () => {
  const fx = await createFixture();

  const created = await api<{ donation: { donationId: string } }>('/donations', {
    body: {
      restaurantSlug: fx.restaurant.slug,
      items: [{ menuItemId: fx.dishes.dosa, quantity: 2 }],
      donor: { name: 'Repeat Donor', phone: '9820011223' },
    },
  });
  const donationId = created.body.data!.donation.donationId;
  const order = await api<{ orderId: string }>('/payments/order', { body: { donationId } });

  const payload = {
    donationId,
    razorpayOrderId: order.body.data!.orderId,
    razorpayPaymentId: 'pay_test_dup',
    razorpaySignature: 'test_signature',
  };

  // The browser returning and the webhook arriving at the same moment.
  const [first, second] = await Promise.all([
    api('/payments/verify', { body: payload }),
    api('/payments/verify', { body: payload }),
  ]);
  assert.ok(first.body.success && second.body.success);

  const restaurant = await Restaurant.findById(fx.restaurant.id).lean();
  assert.equal(restaurant?.stats.totalDonations, 1);
  assert.equal(restaurant?.stats.totalPortions, 2);
  assert.equal(restaurant?.stats.totalFoodValuePaise, 20000);

  const batch = await Batch.findOne({ menuItem: fx.dishes.dosa }).lean();
  assert.equal(batch?.collectedQuantity, 2);
  assert.equal(batch?.donationCount, 1);
  assert.equal(await Batch.countDocuments({}), 1);

  const events = await api(`/donations/${donationId}/track`);
  const paymentEvents = events.body.data.timeline.filter(
    (e: { status: string }) => e.status === 'PAYMENT_SUCCESS'
  );
  assert.equal(paymentEvents.length, 1);
});

test('two donations paid at the same moment share one batch', async () => {
  const fx = await createFixture();

  await Promise.all([
    donateAndPay(fx.restaurant.slug, [{ menuItemId: fx.dishes.dosa, quantity: 2 }]),
    donateAndPay(fx.restaurant.slug, [{ menuItemId: fx.dishes.dosa, quantity: 3 }]),
  ]);

  const batches = await Batch.find({ menuItem: fx.dishes.dosa }).lean();
  assert.equal(batches.length, 1);
  assert.equal(batches[0].collectedQuantity, 5);
  assert.equal(batches[0].donationCount, 2);
});

test('a payment cannot be verified against a different donation', async () => {
  const fx = await createFixture();

  const first = await api<{ donation: { donationId: string } }>('/donations', {
    body: {
      restaurantSlug: fx.restaurant.slug,
      items: [{ menuItemId: fx.dishes.dosa, quantity: 1 }],
      donor: { phone: '9820011223' },
    },
  });
  const second = await api<{ donation: { donationId: string } }>('/donations', {
    body: {
      restaurantSlug: fx.restaurant.slug,
      items: [{ menuItemId: fx.dishes.dosa, quantity: 9 }],
      donor: { phone: '9820011224' },
    },
  });

  const cheapOrder = await api<{ orderId: string }>('/payments/order', {
    body: { donationId: first.body.data!.donation.donationId },
  });

  const stolen = await api('/payments/verify', {
    body: {
      donationId: second.body.data!.donation.donationId,
      razorpayOrderId: cheapOrder.body.data!.orderId,
      razorpayPaymentId: 'pay_test_x',
      razorpaySignature: 'test_signature',
    },
  });

  assert.equal(stolen.status, 400);
  assert.equal((await donationById(second.body.data!.donation.donationId))?.isPaid, false);
});

/* ------------------------------------------------------------- permissions */

test('a kitchen cannot reach another kitchen’s batches by passing an id', async () => {
  const fx = await createFixture();
  await donateAndPay(fx.restaurant.slug, [{ menuItemId: fx.dishes.dosa, quantity: 2 }]);
  const batch = await Batch.findOne({}).lean();

  // A second kitchen, with its own account.
  const outsider = await Restaurant.create({
    name: 'Other Kitchen',
    slug: 'other-kitchen',
    email: 'other@test.in',
    phone: '9820000009',
    address: { line1: '9 Elsewhere', city: 'Pune', state: 'Maharashtra', pincode: '411001' },
    approvalStatus: 'approved',
    qrToken: 'other-token',
  });
  await User.create({
    name: 'Other Owner',
    email: 'other@test.in',
    passwordHash: (await User.findOne({ email: 'kitchen@test.in' }).select('+passwordHash'))!
      .passwordHash,
    role: 'restaurant',
    restaurant: outsider._id,
  });
  const outsiderToken = await signIn('other@test.in');

  const listed = await api(`/batches/restaurant?restaurantId=${fx.restaurant.id}`, {
    token: outsiderToken,
  });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.data.batches.length, 0, 'must only ever see its own batches');

  const hijack = await api(`/batches/${batch!.batchId}/dispatch?restaurantId=${fx.restaurant.id}`, {
    token: outsiderToken,
    body: {},
  });
  assert.equal(hijack.status, 404);
  assert.equal((await Batch.findById(batch!._id).lean())?.status, 'IN_PROGRESS');
});

test('an NGO cannot confirm a batch that was not sent to it', async () => {
  const fx = await createFixture();
  await donateAndPay(fx.restaurant.slug, [{ menuItemId: fx.dishes.dosa, quantity: 2 }]);
  const batch = await Batch.findOne({}).lean();
  await api(`/batches/${batch!.batchId}/dispatch`, { token: fx.restaurant.token, body: {} });

  const registered = await api<{ accessToken: string }>('/auth/register/ngo', {
    body: {
      account: {
        name: 'Outsider Coordinator',
        email: 'outsider-ngo@test.in',
        password: PASSWORD,
        phone: '9820000010',
      },
      ngo: {
        name: 'Outsider Trust',
        phone: '9820000011',
        address: { line1: '3 Far Road', city: 'Pune', state: 'Maharashtra', pincode: '411001' },
        registrationNumber: 'MH/2020/1',
      },
    },
  });

  const stolen = await api(`/batches/${batch!.batchId}/confirm?ngoId=${fx.ngo.id}`, {
    token: registered.body.data!.accessToken,
    body: { receivedQuantity: 2 },
  });
  assert.equal(stolen.status, 404);
  assert.equal((await Batch.findById(batch!._id).lean())?.status, 'DISPATCHED');
});

test('nobody can set a donation’s status by hand', async () => {
  const fx = await createFixture();
  const donationId = await donateAndPay(fx.restaurant.slug, [
    { menuItemId: fx.dishes.dosa, quantity: 1 },
  ]);

  for (const token of [fx.restaurant.token, fx.ngo.token, fx.admin.token]) {
    const res = await api(`/donations/${donationId}/status`, {
      method: 'PATCH',
      token,
      body: { status: 'REFUNDED' },
    });
    assert.equal(res.status, 404, 'the manual status route must not exist');
  }
  assert.equal((await donationById(donationId))?.status, 'ASSIGNED_TO_BATCH');
});

test('a donor only sees their own donations', async () => {
  const fx = await createFixture();

  const mine = await api<{ accessToken: string }>('/auth/register', {
    body: { name: 'Real Donor', email: 'donor@test.in', password: PASSWORD, phone: '9820011223' },
  });
  const donorToken = mine.body.data!.accessToken;

  await donateAndPay(
    fx.restaurant.slug,
    [{ menuItemId: fx.dishes.dosa, quantity: 1 }],
    { name: 'Real Donor', phone: '9820011223' },
    donorToken
  );
  // Someone else's donation, left with the same phone number on the record.
  await donateAndPay(fx.restaurant.slug, [{ menuItemId: fx.dishes.dosa, quantity: 2 }], {
    name: 'Someone Else',
    phone: '9820011223',
  });

  const history = await api('/donations/mine', { token: donorToken });
  assert.equal(history.body.data.donations.length, 1);
  assert.equal(history.body.data.totals.portions, 1);
});

test('the public tracking page never exposes the donor’s contact details', async () => {
  const fx = await createFixture();
  const donationId = await donateAndPay(
    fx.restaurant.slug,
    [{ menuItemId: fx.dishes.dosa, quantity: 1 }],
    { name: '', phone: '9820099887', message: 'Anonymous gift' }
  );

  const tracked = await api(`/donations/${donationId}/track`);
  const raw = JSON.stringify(tracked.body);
  assert.ok(!raw.includes('9820099887'), 'phone number must not be in the response');
  assert.equal(tracked.body.data.donation.donorSnapshot.name, 'Anonymous donor');
  assert.equal(tracked.body.data.donation.donorSnapshot.message, 'Anonymous gift');
});

test('a form post is refused, so another site cannot act as a signed-in user', async () => {
  const fx = await createFixture();
  const res = await api('/restaurants/me', {
    method: 'PATCH',
    token: fx.restaurant.token,
    form: { name: 'Renamed By Another Site' },
  });
  assert.equal(res.status, 415);
  assert.equal((await Restaurant.findById(fx.restaurant.id).lean())?.name, 'Dil Dosa');
});

test('a deactivated account stops working immediately', async () => {
  const fx = await createFixture();
  const owner = await User.findOne({ email: 'kitchen@test.in' }).lean();

  assert.equal((await api('/restaurants/me', { token: fx.restaurant.token })).status, 200);

  const disabled = await api(`/admin/users/${owner!._id}/state`, {
    method: 'PATCH',
    token: fx.admin.token,
    body: { isActive: false },
  });
  assert.equal(disabled.status, 200);

  // Same token, now worthless — permissions are re-read on every request.
  assert.equal((await api('/restaurants/me', { token: fx.restaurant.token })).status, 401);
});

/* ------------------------------------------------- shortfalls and recovery */

test('a short count is recorded as it stands and flagged for the admin', async () => {
  const fx = await createFixture();
  const donationId = await donateAndPay(fx.restaurant.slug, [
    { menuItemId: fx.dishes.idli, quantity: 6 },
  ]);
  const batch = await Batch.findOne({}).lean();
  await api(`/batches/${batch!.batchId}/dispatch`, { token: fx.restaurant.token, body: {} });

  // A mismatch has to come with an explanation.
  const bare = await api(`/batches/${batch!.batchId}/confirm`, {
    token: fx.ngo.token,
    body: { receivedQuantity: 4 },
  });
  assert.equal(bare.status, 400);

  const short = await api(`/batches/${batch!.batchId}/confirm`, {
    token: fx.ngo.token,
    body: { receivedQuantity: 4, note: 'Two carriers were damaged in transit.' },
  });
  assert.equal(short.status, 200);
  assert.equal(short.body.data.batch.status, 'RECONCILIATION_REQUIRED');
  assert.equal(short.body.data.batch.receivedQuantity, 4);

  // The donor is told, rather than the shortfall being hidden.
  const tracked = await api(`/donations/${donationId}/track`);
  assert.equal(tracked.body.data.donation.status, 'NGO_CONFIRMED');
  assert.equal(tracked.body.data.batches[0].shortfall, true);

  const flagged = await api('/admin/batches?status=RECONCILIATION_REQUIRED', {
    token: fx.admin.token,
  });
  assert.equal(flagged.body.data.batches.length, 1);

  const resolved = await api(`/admin/batches/${batch!.batchId}/resolve`, {
    method: 'PATCH',
    token: fx.admin.token,
    body: { resolutionNote: 'Kitchen re-sent two plates the next morning.' },
  });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.data.batch.status, 'COMPLETED');

  const after = await api(`/donations/${donationId}/track`);
  assert.match(after.body.data.batches[0].resolutionNote, /re-sent two plates/);
});

test('the dashboard tiles count the same batches the list shows', async () => {
  const fx = await createFixture();

  await donateAndPay(fx.restaurant.slug, [{ menuItemId: fx.dishes.idli, quantity: 6 }]);
  await donateAndPay(fx.restaurant.slug, [{ menuItemId: fx.dishes.dosa, quantity: 2 }]);

  // The idli batch hit its target of 6; the dosa batch is still collecting.
  const kitchen = await api('/batches/restaurant', { token: fx.restaurant.token });
  assert.equal(kitchen.body.data.batches.length, 2);
  assert.equal(kitchen.body.data.summary.readyToCook, 1);
  assert.equal(kitchen.body.data.summary.collecting, 1);
  assert.equal(kitchen.body.data.summary.portionsAwaitingDispatch, 8);

  const ready = kitchen.body.data.batches.find(
    (b: { status: string }) => b.status === 'READY_FOR_DELIVERY'
  );
  await api(`/batches/${ready.batchId}/dispatch`, { token: fx.restaurant.token, body: {} });

  const ngo = await api('/batches/ngo', { token: fx.ngo.token });
  assert.equal(ngo.body.data.summary.inTransit, 1);
  assert.equal(ngo.body.data.summary.portionsInTransit, 6);

  await api(`/batches/${ready.batchId}/confirm`, {
    token: fx.ngo.token,
    body: { receivedQuantity: 4, note: 'Two carriers were damaged.' },
  });

  const after = await api('/batches/ngo', { token: fx.ngo.token });
  assert.equal(after.body.data.summary.flagged, 1);
  assert.equal(after.body.data.summary.inTransit, 0);
});

test('a batch cannot be dispatched twice or confirmed before it is sent', async () => {
  const fx = await createFixture();
  await donateAndPay(fx.restaurant.slug, [{ menuItemId: fx.dishes.dosa, quantity: 2 }]);
  const batch = await Batch.findOne({}).lean();

  const early = await api(`/batches/${batch!.batchId}/confirm`, {
    token: fx.ngo.token,
    body: { receivedQuantity: 2 },
  });
  assert.equal(early.status, 409);

  assert.equal(
    (await api(`/batches/${batch!.batchId}/dispatch`, { token: fx.restaurant.token, body: {} }))
      .status,
    200
  );
  const again = await api(`/batches/${batch!.batchId}/dispatch`, {
    token: fx.restaurant.token,
    body: {},
  });
  assert.equal(again.status, 409);
  assert.equal((await Batch.findById(batch!._id).lean())?.dispatchedQuantity, 2);
});

/* -------------------------------------------------------------- onboarding */

test('a kitchen applies, waits for approval, then goes live', async () => {
  await createFixture();

  const applied = await api<{ accessToken: string; restaurant: { slug: string; _id: string } }>(
    '/auth/register/restaurant',
    {
      body: {
        account: {
          name: 'New Owner',
          email: 'new-kitchen@test.in',
          password: PASSWORD,
          phone: '9820000021',
        },
        restaurant: {
          name: 'Second Kitchen',
          phone: '9820000022',
          address: { line1: '5 New Road', city: 'Delhi', state: 'Delhi', pincode: '110001' },
          fssaiLicense: '11522003000999',
        },
      },
    }
  );
  assert.equal(applied.status, 201);
  const { slug, _id } = applied.body.data!.restaurant;

  // The account works right away so the owner can build their menu.
  const own = await api('/restaurants/me', { token: applied.body.data!.accessToken });
  assert.equal(own.status, 200);
  assert.equal(own.body.data.restaurant.approvalStatus, 'pending');

  // But the public page is not live, so nobody can donate yet.
  assert.equal((await api(`/restaurants/${slug}`)).status, 404);

  const adminToken = await signIn('admin@test.in');
  const approved = await api(`/admin/restaurants/${_id}/approval`, {
    method: 'PATCH',
    token: adminToken,
    body: { approvalStatus: 'approved' },
  });
  assert.equal(approved.status, 200);
  assert.equal((await api(`/restaurants/${slug}`)).status, 200);
});

test('donations taken before a kitchen has an NGO partner are picked up later', async () => {
  const fx = await createFixture({ partnered: false });

  const donationId = await donateAndPay(fx.restaurant.slug, [
    { menuItemId: fx.dishes.dosa, quantity: 3 },
  ]);

  // Paid and safe, but with nowhere to send the food yet.
  assert.equal((await donationById(donationId))?.status, 'PAYMENT_SUCCESS');
  assert.equal(await Batch.countDocuments({}), 0);

  const partnered = await api('/restaurants/me/ngos', {
    token: fx.restaurant.token,
    body: { ngoId: fx.ngo.id },
  });
  assert.equal(partnered.status, 201);
  assert.equal(partnered.body.data.backlogAssigned, 1);

  const donation = await donationById(donationId);
  assert.equal(donation?.status, 'ASSIGNED_TO_BATCH');
  assert.equal(donation?.ngo?.toString(), fx.ngo.id);
  assert.equal((await Batch.findOne({}).lean())?.collectedQuantity, 3);
});

test('a kitchen cannot partner with an NGO that is not approved', async () => {
  const fx = await createFixture({ partnered: false });
  const pending = await api<{ ngo: { _id: string } }>('/auth/register/ngo', {
    body: {
      account: {
        name: 'Applicant',
        email: 'applicant@test.in',
        password: PASSWORD,
        phone: '9820000031',
      },
      ngo: {
        name: 'Applicant Trust',
        phone: '9820000032',
        address: { line1: '7 Wait Street', city: 'Jaipur', state: 'Rajasthan', pincode: '302001' },
        registrationNumber: 'RJ/2021/7',
      },
    },
  });

  const refused = await api('/restaurants/me/ngos', {
    token: fx.restaurant.token,
    body: { ngoId: pending.body.data!.ngo._id },
  });
  assert.equal(refused.status, 400);
  assert.match(refused.body.error!.message, /not approved/i);
});

test('a paused restaurant and an unavailable dish both refuse new donations', async () => {
  const fx = await createFixture();

  await api('/restaurants/me', {
    method: 'PATCH',
    token: fx.restaurant.token,
    body: { isAcceptingDonations: false },
  });

  const paused = await api('/donations', {
    body: {
      restaurantSlug: fx.restaurant.slug,
      items: [{ menuItemId: fx.dishes.dosa, quantity: 1 }],
      donor: { phone: '9820011223' },
    },
  });
  assert.equal(paused.status, 400);
  assert.match(paused.body.error!.message, /paused/i);
  assert.equal(await Donation.countDocuments({}), 0);
});

test('prices and the split come from the database, not the request', async () => {
  const fx = await createFixture();

  const created = await api<{ donation: { donationId: string; customerPaidPaise: number } }>(
    '/donations',
    {
      body: {
        restaurantSlug: fx.restaurant.slug,
        items: [{ menuItemId: fx.dishes.dosa, quantity: 1 }],
        donor: { phone: '9820011223' },
        // All of this is ignored.
        customerPaidPaise: 1,
        totalFoodValuePaise: 999999,
        status: 'NGO_CONFIRMED',
        isPaid: true,
      },
    }
  );

  assert.equal(created.body.data!.donation.customerPaidPaise, 5000);
  const donation = await donationById(created.body.data!.donation.donationId);
  assert.equal(donation?.isPaid, false);
  assert.equal(donation?.status, 'PENDING_PAYMENT');
  assert.equal(donation?.totalFoodValuePaise, 10000);
});
