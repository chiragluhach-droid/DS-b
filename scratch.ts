import mongoose from 'mongoose';
import { connectDatabase } from './src/config/db';
import { Donation } from './src/models';

async function run() {
  await connectDatabase();
  try {
    await Donation.create({
      donationId: 'test_123',
      restaurant: new mongoose.Types.ObjectId(),
      donorSnapshot: {
        name: 'Anonymous',
        phone: '8130809374',
        isAnonymous: true,
      },
      items: [{
        menuItem: new mongoose.Types.ObjectId(),
        name: 'Masala Dosa',
        quantity: 1,
        mrpPaise: 10000,
        customerSharePercent: 50,
        customerPaysPaise: 5000,
        restaurantPaysPaise: 5000,
        lineCustomerPaise: 5000,
        lineRestaurantPaise: 5000,
        lineFoodValuePaise: 10000,
      }],
      totalPortions: 1,
      customerPaidPaise: 5000,
      restaurantContributionPaise: 5000,
      totalFoodValuePaise: 10000,
    });
    console.log('Success');
  } catch (err: any) {
    console.error(err);
  }
  process.exit(0);
}
run();
