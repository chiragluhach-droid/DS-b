import axios from 'axios';

async function run() {
  try {
    const pub = await axios.get('http://localhost:5001/api/restaurants/dil-dosa');
    const menuItemId = pub.data.data.items[0]._id;
    
    const res = await axios.post('http://localhost:5001/api/donations', {
      restaurantSlug: 'dil-dosa',
      items: [{ menuItemId, quantity: 1 }],
      donor: { name: '', phone: '8130809374', message: '' }
    });
    console.log("SUCCESS");
  } catch (err: any) {
    if (err.response) {
      console.error("ERROR", JSON.stringify(err.response.data, null, 2));
    } else {
      console.error(err);
    }
  }
}
run();
