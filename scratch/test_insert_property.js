const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function test() {
  const { data: profiles, error: profErr } = await supabase.from('profiles').select('account_id, user_id').limit(1);
  if (profErr || !profiles || profiles.length === 0) {
    console.error('Error fetching profile:', profErr);
    return;
  }
  const { account_id, user_id } = profiles[0];
  console.log('Using account_id:', account_id, 'user_id:', user_id);

  const insertPayload = {
    account_id: account_id,
    user_id: user_id,
    title: "Commercial Space for Rent on 100' Road, Indiranagar",
    description: "Ingested via test script",
    price: 3000000,
    location: "100' Road, Indiranagar",
    type: "Commercial",
    status: 'Available',
    bedrooms: null,
    bathrooms: null,
    area_sqft: 15000,
    is_published: true,
    features: ["Grade-A address", "West Facing", "G+2 floors"],
    nearby_highlights: ["100' Road"],
    images: [],
    rental_income: null,
    roi: null,
    google_map_link: null,
    land_area: null,
    land_area_unit: 'Sq.Ft.',
    owner_contact_id: null,
    listing_source: 'owner',
    listing_type: 'Rent',
    rent_per_month: 3000000,
    maintenance: null,
    advance: 24000000,
    gst: 18,
    notes: "Test ingestion"
  };

  const { data, error } = await supabase.from('properties').insert(insertPayload).select();
  if (error) {
    console.error('INSERT FAILED:', error);
  } else {
    console.log('INSERT SUCCESS:', data);
  }
}

test();
