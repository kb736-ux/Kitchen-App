const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = 'https://xutxuhypqpxobujxdhfz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1dHh1aHlwcXB4b2J1anhkaGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMjYzNTIsImV4cCI6MjA4NzgwMjM1Mn0.ojXb8Y1l1o-MFRMFzPk8zUewDehp5UzMw_EJzz3rTI4';
const ORG_ID = 'f4121c7b-53ed-45b3-9966-57af9b40cb5d';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function run() {
  const { data: profiles, error: pErr } = await supabase.from('profiles').select('*');
  console.log('Profiles:', profiles, pErr);
  const { data: org_members, error: omErr } = await supabase.from('org_members').select('*, profiles(*)');
  console.log('Org Members:', JSON.stringify(org_members, null, 2), omErr);
  const { data: emp_pos, error: epErr } = await supabase.from('employee_positions').select('*');
  console.log('Employee positions:', emp_pos, epErr);
}
run();
