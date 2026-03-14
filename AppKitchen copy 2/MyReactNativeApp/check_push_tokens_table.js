const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://xutxuhypqpxobujxdhfz.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1dHh1aHlwcXB4b2J1anhkaGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMjYzNTIsImV4cCI6MjA4NzgwMjM1Mn0.ojXb8Y1l1o-MFRMFzPk8zUewDehp5UzMw_EJzz3rTI4';

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    const { data, error } = await supabase.from('push_tokens').select('*').limit(1);
    console.log("Push tokens table test:", error || "Yes, and data is " + JSON.stringify(data));
}
check();
