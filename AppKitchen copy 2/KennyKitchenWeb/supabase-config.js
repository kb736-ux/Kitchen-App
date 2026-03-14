// =============================================================
// SUPABASE CONFIG — Kenny Kitchen Web (Manager Dashboard)
// =============================================================
// No login required. RLS is disabled for local MVP development.
//
// FIRST RUN ONLY:
//   1. Open index.html in browser
//   2. Open DevTools console (Cmd+Option+I → Console tab)
//   3. Copy the ORG_ID that gets printed
//   4. Paste it into ORG_ID below
// =============================================================

const SUPABASE_URL      = 'https://xutxuhypqpxobujxdhfz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1dHh1aHlwcXB4b2J1anhkaGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMjYzNTIsImV4cCI6MjA4NzgwMjM1Mn0.ojXb8Y1l1o-MFRMFzPk8zUewDehp5UzMw_EJzz3rTI4';

// ── FILL THIS IN after first run ─────────────────────────────
const ORG_ID = 'f4121c7b-53ed-45b3-9966-57af9b40cb5d';

// Employee display name → Supabase UUID map.
// Get UUIDs from: Supabase Dashboard → Authentication → Users
window.EMPLOYEE_IDS = {
  // 'Kenny': 'uuid-of-kenny-here',
  // 'Rohan': 'uuid-of-rohan-here',
};
// ─────────────────────────────────────────────────────────────

(function () {
  const { createClient } = window.supabase;
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  window.supabaseClient = client;
  window.ORG_ID = ORG_ID || localStorage.getItem('kk_org_id') || null;

  async function bootstrap() {
    // If org ID is already known, skip creation
    if (!window.ORG_ID) {
      // Check if any org exists already
      const { data: orgs } = await client.from('orgs').select('id').limit(1);

      if (orgs && orgs.length > 0) {
        window.ORG_ID = orgs[0].id;
      } else {
        // Create the org for the first time
        const { data, error } = await client
          .from('orgs')
          .insert({ name: 'Kenny Kitchen' })
          .select()
          .single();

        if (error) {
          console.error('[Supabase] Could not create org:', error.message);
          return;
        }
        window.ORG_ID = data.id;
      }

      localStorage.setItem('kk_org_id', window.ORG_ID);
      console.log(
        '%c[Supabase] ORG_ID: ' + window.ORG_ID,
        'color: green; font-weight: bold; font-size: 14px'
      );
      console.log('👆 Copy that ID and paste it into supabase-config.js as: const ORG_ID = \'' + window.ORG_ID + '\';');
    }

    // Seed employees if org has none (so shift assignment dropdown shows options)
    const { data: existingEmployees } = await client
      .from('employee_positions')
      .select('id')
      .eq('org_id', window.ORG_ID)
      .limit(1);
    if (!existingEmployees?.length) {
      const employees = [
        { employee_name: 'Kenny', positions: ['Server'] },
        { employee_name: 'Rohan', positions: ['Server'] },
        { employee_name: 'Natalie', positions: ['Server'] },
        { employee_name: 'Jake', positions: ['Line Cook', 'Dish'] },
        { employee_name: 'Sam', positions: ['Line Cook'] },
        { employee_name: 'Sophia', positions: ['Prep'] },
        { employee_name: 'Aria', positions: ['Line Cook'] },
        { employee_name: 'Alex', positions: ['Line Cook'] },
        { employee_name: 'Meagan', positions: ['Dishwasher'] },
        { employee_name: 'Josh', positions: ['Dessert'] },
        { employee_name: 'Ben', positions: ['Hot Foods'] },
        { employee_name: 'Justin', positions: ['MOD'] },
        { employee_name: 'Hannah', positions: ['Cold Foods'] },
        { employee_name: 'Gary', positions: ['Expo'] },
      ];
      for (const e of employees) {
        await client.from('employee_positions').insert({
          org_id: window.ORG_ID,
          employee_name: e.employee_name,
          positions: e.positions,
        });
      }
      console.log('[Supabase] Seeded', employees.length, 'employees.');
    }

    window.dispatchEvent(new Event('supabase-ready'));
    console.log('[Supabase] ✅ Ready! org:', window.ORG_ID);
  }

  bootstrap();
})();
