import mongoose from 'mongoose';
import { env } from './env';

export async function connectDatabase(): Promise<void> {
  mongoose.set('strictQuery', true);

  if (env.mongoUsingFallback) {
    // eslint-disable-next-line no-console
    console.warn(
      '[db] MONGODB_URI still contains a <placeholder> — falling back to the local instance.\n' +
        '     Fill in the Atlas database username in backend/.env to switch over.'
    );
  }

  await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 15_000 });
  const host = mongoose.connection.host ?? 'unknown';
  // eslint-disable-next-line no-console
  console.log(`[db] connected → ${mongoose.connection.name} @ ${host}`);
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}
