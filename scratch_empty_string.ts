import mongoose from 'mongoose';
import { connectDatabase } from './src/config/db';
import { Donation } from './src/models';

async function run() {
  await connectDatabase();
  try {
    await Donation.create({
      donationId: 'test_empty_string',
      restaurant: new mongoose.Types.ObjectId(),
      donorSnapshot: {
        name: '', // EMPTY STRING!
        phone: '8130809374',
        isAnonymous: true,
      },
      items: [{
        menuItem: new mongoose.Types.ObjectId(),
        name: 'Masala Dosa',
        quantity: 1,
        mrpPaise: 100,
        customerSharePercent: 50,
        customerPaysPaise: 50,
        restaurantPaysPaise: 50,
        lineCustomerPaise: 50,
        lineRestaurantPaise: 50,
        lineFoodValuePaise: 100,
      }],
      totalPortions: 1,
      customerPaidPaise: 50,
      restaurantContributionPaise: 50,
      totalFoodValuePaise: 100,
    });
    console.log('Success');
  } catch (err: any) {
    if (err.errors) console.log(err.errors);
  }
  process.exit(0);
}
run();
