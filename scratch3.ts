import axios from 'axios';

async function run() {
  try {
    const res = await axios.post('http://localhost:5001/api/donations', {
      restaurantSlug: 'dil-dosa',
      items: [{ menuItemId: '6ab6075f3043b67f64189569', quantity: 1 }],
      donor: { name: '', phone: '8130809374', message: '' }
    });
    console.log(res.data);
  } catch (err: any) {
    if (err.response) {
      console.error(err.response.data);
    } else {
      console.error(err);
    }
  }
}
run();
