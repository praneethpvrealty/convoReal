const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function test() {
  const { data: profiles } = await supabase.from('profiles').select('account_id').limit(1);
  const accountId = profiles[0].account_id;
  console.log('Account ID:', accountId);

  const { data: limits } = await supabase
    .from('account_plan_limits')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle();

  console.log('Limits:', limits);

  const { count } = await supabase
    .from('properties')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', accountId);

  console.log('Properties count:', count);
}

test();
