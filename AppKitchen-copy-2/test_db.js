const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const content = fs.readFileSync('MyReactNativeApp/utils/supabase.js', 'utf8');
const urlMatch = content.match(/const SUPABASE_URL\s*=\s*['"]([^'"]+)['"]/);
const keyMatch = content.match(/const SUPABASE_ANON_KEY\s*=\s*['"]([^'"]+)['"]/);
const supabase = createClient(urlMatch[1], keyMatch[1]);
async function run() {
  const { data, error } = await supabase.from('tasks').select('*').limit(1);
  if (error) { console.log('error', error); }
  else { console.log('tasks cols:', data && data[0] ? Object.keys(data[0]) : 'no task rows'); }
}
run();
