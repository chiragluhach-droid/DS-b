import axios from 'axios';

async function run() {
  try {
    const pub = await axios.get('http://localhost:5001/api/restaurants/dil-dosa');
    console.log('RESTAURANT', JSON.stringify(pub.data, null, 2));
    
    // find a donation to track
    const tracking = await axios.get('http://localhost:5001/api/donations/DS-H9HL-N94T/track');
    console.log('TRACKING', JSON.stringify(tracking.data, null, 2));
  } catch (err: any) {
    if (err.response) {
      console.error("ERROR", JSON.stringify(err.response.data, null, 2));
    } else {
      console.error(err);
    }
  }
}
run();
