const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://xutxuhypqpxobujxdhfz.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1dHh1aHlwcXB4b2J1anhkaGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMjYzNTIsImV4cCI6MjA4NzgwMjM1Mn0.ojXb8Y1l1o-MFRMFzPk8zUewDehp5UzMw_EJzz3rTI4');

async function run() {
  const { data: tasks, error: tasksErr } = await supabase.from('tasks').select('*');
  console.log('tasks:', tasks);
  const { data: positions, error: posErr } = await supabase.from('employee_positions').select('*');
  console.log('positions:', positions);
}
run();
