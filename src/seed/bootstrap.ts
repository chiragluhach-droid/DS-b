/* eslint-disable no-console */
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/db';
import { User, hashPassword } from '../models';

/**
 * Creates the first admin account on a fresh database. Unlike `npm run seed`
 * this deletes nothing and adds no demo data, so it is safe to run against
 * production — restaurants and NGOs then apply through the web app and this
 * admin approves them.
 *
 *   ADMIN_EMAIL=you@daansetu.in ADMIN_PASSWORD='…' npm run bootstrap
 */
async function run() {
  const email = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? '';
  const name = process.env.ADMIN_NAME ?? 'DaanSetu Admin';

  if (!email || !password) {
    throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD to create the first admin.');
  }
  if (password.length < 12) {
    throw new Error('Choose an admin password of at least 12 characters.');
  }

  await connectDatabase();

  const existing = await User.findOne({ email });
  if (existing) {
    console.log(`\n  An account already exists for ${email} (role: ${existing.role}).`);
    console.log('  Nothing was changed.\n');
    await disconnectDatabase();
    return;
  }

  const admins = await User.countDocuments({ role: 'admin' });
  const user = await User.create({
    name,
    email,
    passwordHash: await hashPassword(password),
    role: 'admin',
  });

  console.log(`\n  Admin created → ${user.email}`);
  if (admins > 0) console.log(`  (${admins} other admin account(s) already existed.)`);
  console.log('\n  Next: sign in at /login, then approve the kitchens and NGOs that apply.\n');

  await disconnectDatabase();
}

run().catch(async (err) => {
  console.error('[bootstrap] failed:', err instanceof Error ? err.message : err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
