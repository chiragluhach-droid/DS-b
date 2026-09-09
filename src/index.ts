import { createApp } from './app';
import { connectDatabase } from './config/db';
import { env, paymentsAreLive } from './config/env';

async function bootstrap() {
  await connectDatabase();
  const app = createApp();

  app.listen(env.port, () => {
    // eslint-disable-next-line no-console
    console.log(
      `\n  DaanSetu API\n  → http://localhost:${env.port}/api/health\n  → payments: ${paymentsAreLive ? 'razorpay (live keys)' : 'MOCK mode'}\n  → cors: ${env.corsOrigins.join(', ')}\n`
    );
  });
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[boot] failed to start', err);
  process.exit(1);
});
