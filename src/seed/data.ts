const IMG = (id: string, w = 900) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=80`;

export const images = {
  // Served from frontend/public — a real photo of the dining room.
  restaurantCover: '/dil-dosa.png',
  restaurantLogo: IMG('photo-1630383249896-424e482df921', 400),
  ngoLogo: IMG('photo-1488521787991-ed7bbaae773c', 400),
  ngoCover: IMG('photo-1594708767771-a7502209ff51', 1600),
  ngoLogoAlt: IMG('photo-1526976668912-1a811878dd37', 400),
};

/**
 * Dil Dosa's donation menu. `mrpPaise` is the dish's normal price — the guest
 * pays half and the kitchen matches the other half.
 */
export const menuItems = [
  {
    name: 'Masala Dosa',
    description:
      'Crisp rice-and-lentil crepe folded over spiced potato, with coconut chutney and sambhar. The plate we send out most.',
    mrpPaise: 10000,
    image: IMG('photo-1668236543090-82eba5ee5976'),
    category: 'Dosa',
    servingSize: 'Serves 1',
    isSignature: true,
    sortOrder: 1,
  },
  {
    name: 'Idli Sambhar',
    description:
      'Two steamed rice cakes in hot sambhar with chutney. Soft, light and gentle — what we send to shelters and clinics.',
    mrpPaise: 8000,
    image: IMG('photo-1630383249896-424e482df921'),
    category: 'Idli & Vada',
    servingSize: '2 pieces',
    isSignature: true,
    sortOrder: 2,
  },
  {
    name: 'Paneer Dosa',
    description:
      'Dosa stuffed with spiced cottage cheese and onion. Our highest-protein plate, cooked for the children’s programme.',
    mrpPaise: 16000,
    image: IMG('photo-1622542796254-5b9c46ab0d2f'),
    category: 'Dosa',
    servingSize: 'Serves 1',
    sortOrder: 3,
  },
  {
    name: 'Plain Dosa',
    description:
      'The everyday dosa — thin, crisp, served with chutney and sambhar. The most affordable way to fund a full plate.',
    mrpPaise: 7000,
    image: IMG('photo-1610192244261-3f33de3f55e4'),
    category: 'Dosa',
    servingSize: 'Serves 1',
    sortOrder: 4,
  },
  {
    name: 'Rava Dosa',
    description:
      'Lacy semolina dosa with cumin, ginger and green chilli. Made to order, and it travels well.',
    mrpPaise: 12000,
    image: IMG('photo-1633945274309-2c16c9682a8c'),
    category: 'Dosa',
    servingSize: 'Serves 1',
    sortOrder: 5,
  },
  {
    name: 'Mysore Masala Dosa',
    description:
      'Red chilli-garlic chutney spread inside, potato masala within. A little heat for a cold evening.',
    mrpPaise: 13000,
    image: IMG('photo-1626074353765-517a681e40be'),
    category: 'Dosa',
    servingSize: 'Serves 1',
    sortOrder: 6,
  },
  {
    name: 'Medu Vada',
    description:
      'Two crisp lentil doughnuts with sambhar and coconut chutney. Our 7am plate for night-shift workers.',
    mrpPaise: 7000,
    image: IMG('photo-1589301760014-d929f3979dbc'),
    category: 'Idli & Vada',
    servingSize: '2 pieces',
    sortOrder: 7,
  },
  {
    name: 'Set Dosa',
    description:
      'Three soft, spongy dosas stacked with a vegetable kurma. Filling enough to carry someone through the day.',
    mrpPaise: 11000,
    image: IMG('photo-1596797038530-2c107229654b'),
    category: 'Dosa',
    servingSize: '3 pieces',
    sortOrder: 8,
  },
  {
    name: 'Onion Uttapam',
    description:
      'Thick rice pancake studded with onion, tomato and coriander. Hearty, and it keeps its heat.',
    mrpPaise: 12000,
    image: IMG('photo-1567337710282-00832b415979'),
    category: 'Uttapam',
    servingSize: 'Serves 1',
    sortOrder: 9,
  },
  {
    name: 'Ghee Podi Dosa',
    description:
      'Dosa brushed with ghee and gunpowder podi. Simple, rich, and the one people ask for by name.',
    mrpPaise: 14000,
    image: IMG('photo-1585032226651-759b368d7246'),
    category: 'Dosa',
    servingSize: 'Serves 1',
    sortOrder: 10,
  },
  {
    name: 'Curd Rice',
    description:
      'Cooled rice folded through curd with mustard and curry leaf. What we cook when the afternoon is unbearable.',
    mrpPaise: 9000,
    image: IMG('photo-1601050690597-df0568f70950'),
    category: 'Rice',
    servingSize: 'Serves 1',
    sortOrder: 11,
  },
  {
    name: 'Sambhar Rice',
    description:
      'Rice cooked down with lentils, tamarind and vegetables, finished with ghee. A complete meal in one box.',
    mrpPaise: 9500,
    image: IMG('photo-1604152135912-04a022e23696'),
    category: 'Rice',
    servingSize: 'Serves 1',
    sortOrder: 12,
  },
];

export const donorPool = [
  { name: 'Ananya Rao', email: 'ananya.rao@example.com', phone: '9820011223' },
  { name: 'Vikram Mehta', email: 'vikram.mehta@example.com', phone: '9820044556' },
  { name: 'Fatima Sheikh', email: 'fatima.sheikh@example.com', phone: '9820077889' },
  { name: 'Rohan Iyer', email: 'rohan.iyer@example.com', phone: '9820022334' },
  { name: 'Priya Nambiar', email: 'priya.nambiar@example.com', phone: '9820055667' },
  { name: 'Aditya Kulkarni', email: 'aditya.kulkarni@example.com', phone: '9820088990' },
  { name: 'Meera Joshi', email: 'meera.joshi@example.com', phone: '9820033445' },
];

export const donorMessages = [
  'For Amma, on her 70th birthday. She always said no one should eat alone.',
  'A small thank you to the city that raised me.',
  '',
  'In memory of my father, who ran a tea stall on this very street.',
  'Because our team closed a good quarter and this felt like the right way to mark it.',
  '',
  'Happy Diwali to whoever receives this plate.',
];
