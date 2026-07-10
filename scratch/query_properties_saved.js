const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function test() {
  const { data: props, error } = await supabase
    .from('properties')
    .select('*')
    .ilike('title', '%Indiranagar%')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to query properties:', error);
    return;
  }

  console.log('Properties found:', props.length);
  for (const prop of props) {
    console.log(`\n--- Property ID: ${prop.id} | Code: ${prop.property_code} ---`);
    console.log(`Title: ${prop.title}`);
    console.log(`Price: ${prop.price}`);
    console.log(`Rent per month: ${prop.rent_per_month}`);
    console.log(`Advance: ${prop.advance}`);
    console.log(`Created: ${prop.created_at}`);
  }
}

test();
