import axios from 'axios';

async function run() {
  try {
    const pub = await axios.get('http://localhost:5001/api/restaurants/dil-dosa');
    const menuItemId = pub.data.data.items[0]._id;
    
    console.log('creating donation...');
    const created = await axios.post('http://localhost:5001/api/donations', {
      restaurantSlug: 'dil-dosa',
      items: [{ menuItemId, quantity: 1 }],
      donor: { name: 'Test', phone: '8130809374', message: '' }
    });
    
    const donationId = created.data.data.donation.donationId;
    console.log('created', donationId);
    
    const order = await axios.post('http://localhost:5001/api/payments/order', { donationId });
    
    console.log('verifying payment...');
    const verify = await axios.post('http://localhost:5001/api/payments/verify', {
      donationId,
      razorpayOrderId: order.data.data.orderId || 'order_mock',
      razorpayPaymentId: 'pay_mock',
      razorpaySignature: 'mock_signature',
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
