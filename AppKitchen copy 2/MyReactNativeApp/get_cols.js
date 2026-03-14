const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://xutxuhypqpxobujxdhfz.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1dHh1aHlwcXB4b2J1anhkaGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMjYzNTIsImV4cCI6MjA4NzgwMjM1Mn0.ojXb8Y1l1o-MFRMFzPk8zUewDehp5UzMw_EJzz3rTI4');

async function run() {
  const { data, error } = await supabase.rpc('get_table_info', { table_name: 'tasks' });
  // let's just insert one temporary notification to see if it allows employee_name
  const hr = await supabase.from('notifications').insert({ org_id: 'f4121c7b-53ed-45b3-9966-57af9b40cb5d', employee_name: 'test', title: 't', body: 'b', type: 't' });
  console.log('notifications insert error:', hr.error);
}
run();
