const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://xutxuhypqpxobujxdhfz.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1dHh1aHlwcXB4b2J1anhkaGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMjYzNTIsImV4cCI6MjA4NzgwMjM1Mn0.ojXb8Y1l1o-MFRMFzPk8zUewDehp5UzMw_EJzz3rTI4');

async function run() {
  const { data, error } = await supabase.from('tasks').delete().is('employee_id', null);
  console.log('delete unassigned rows:', error || 'success');
}
run();
