const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const supabase = createClient('https://xutxuhypqpxobujxdhfz.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1dHh1aHlwcXB4b2J1anhkaGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMjYzNTIsImV4cCI6MjA4NzgwMjM1Mn0.ojXb8Y1l1o-MFRMFzPk8zUewDehp5UzMw_EJzz3rTI4');

async function testUpload() {
    try {
        const { error } = await supabase.storage
            .from('avatars')
            .upload('test.txt', 'hello world', { contentType: 'text/plain', upsert: true });
        console.log("Upload error:", error);
    } catch (e) {
        console.log("Exception:", e);
    }
}
testUpload();
