import mongoose from 'mongoose';
import { connectDatabase } from './src/config/db';
import { createDonation } from './src/modules/donations/donation.service';
import { MenuItem } from './src/models';

async function run() {
  await connectDatabase();
  try {
    const item = await MenuItem.findOne({ 'name': 'Masala Dosa' });
    if (!item) throw new Error('No item');
    
    const result = await createDonation({
      restaurantSlug: 'dil-dosa',
      items: [{ menuItemId: item._id.toString(), quantity: 1 }],
      donor: { name: '', phone: '8130809374', message: '' }
    });
    console.log('Success:', result);
  } catch (err: any) {
    console.error(err.name, err.message);
    if (err.errors) console.log(err.errors);
  }
  process.exit(0);
}
run();
