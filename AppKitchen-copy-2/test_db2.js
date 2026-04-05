const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const content = fs.readFileSync('MyReactNativeApp/utils/supabase.js', 'utf8');
const urlMatch = content.match(/const SUPABASE_URL\s*=\s*['"]([^'"]+)['"]/);
const keyMatch = content.match(/const SUPABASE_ANON_KEY\s*=\s*['"]([^'"]+)['"]/);
const supabase = createClient(urlMatch[1], keyMatch[1]);
async function run() {
  const { data: profiles, error } = await supabase.from('profiles').select('*').eq('email', 'klb10012004@gmail.com');
  console.log('Profile:', profiles);
  const { data: positions } = await supabase.from('employee_positions').select('*').eq('employee_name', 'Lulu');
  console.log('Employee Positions:', positions);
  const { data: allPos } = await supabase.from('employee_positions').select('employee_name');
  if (allPos) {
      console.log('All Positions names:', allPos.map(x=>x.employee_name));
  }
}
run();
