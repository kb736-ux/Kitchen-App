const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const content = fs.readFileSync('MyReactNativeApp/utils/supabase.js', 'utf8');
const urlMatch = content.match(/const SUPABASE_URL\s*=\s*['"]([^'"]+)['"]/);
const keyMatch = content.match(/const SUPABASE_ANON_KEY\s*=\s*['"]([^'"]+)['"]/);
const supabase = createClient(urlMatch[1], keyMatch[1]);
async function run() {
  const { data: allProfiles } = await supabase.from('profiles').select('*');
  console.log('All Profiles:', allProfiles ? allProfiles : 'NULL returned');
  const { data: allOrgs } = await supabase.from('orgs').select('*');
  console.log('All Orgs:', allOrgs ? allOrgs : 'NULL returned');
  const { data: allPos } = await supabase.from('employee_positions').select('*');
  console.log('All employee_positions:', allPos ? allPos : 'NULL returned');
}
run();
