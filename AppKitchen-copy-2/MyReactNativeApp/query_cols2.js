const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://xutxuhypqpxobujxdhfz.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1dHh1aHlwcXB4b2J1anhkaGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMjYzNTIsImV4cCI6MjA4NzgwMjM1Mn0.ojXb8Y1l1o-MFRMFzPk8zUewDehp5UzMw_EJzz3rTI4');

async function run() {
  const { data: q1, error: e1 } = await supabase.rpc('get_table_info', { table_name: 'tasks' });
  console.log('tasks:', Object.keys((await supabase.from('tasks').select('*').limit(1)).data[0] || {}));
  console.log('notifs:', Object.keys((await supabase.from('notifications').select('*').limit(1)).data[0] || {}));
}
run();
