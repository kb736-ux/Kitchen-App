const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://xutxuhypqpxobujxdhfz.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1dHh1aHlwcXB4b2J1anhkaGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMjYzNTIsImV4cCI6MjA4NzgwMjM1Mn0.ojXb8Y1l1o-MFRMFzPk8zUewDehp5UzMw_EJzz3rTI4';

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    const { data, error } = await supabase.from('profiles').select('push_token').limit(1);
    console.log("Profiles push_token column exists if no error:", error || "Yes");
}
check();
