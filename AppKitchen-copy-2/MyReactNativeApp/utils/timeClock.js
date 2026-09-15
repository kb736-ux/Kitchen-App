import {
  currentWeekRange,
  evaluateClockIn,
  evaluateClockOut,
  latestOpenPunch,
  parseShiftStart,
} from './earlyPunch';

function isMissingClockSchema(err) {
  const msg = String(err?.message || err?.code || '').toLowerCase();
  return (
    msg.includes('clock_in_out_enabled') ||
    msg.includes('time_punches') ||
    msg.includes('schema cache') ||
    msg.includes('does not exist')
  );
}

export async function fetchClockEnabled(supabase, orgId) {
  if (!supabase || !orgId) return false;
  try {
    const { data, error } = await supabase
      .from('orgs')
      .select('clock_in_out_enabled')
      .eq('id', orgId)
      .maybeSingle();
    if (error) {
      if (isMissingClockSchema(error)) return false;
      console.warn('[Clock] fetchClockEnabled:', error.message);
      return false;
    }
    return !!data?.clock_in_out_enabled;
  } catch (e) {
    console.warn('[Clock] fetchClockEnabled failed:', e?.message || e);
    return false;
  }
}

export async function fetchWeekPunches(supabase, orgId, { userId = null, managerView = false } = {}) {
  if (!supabase || !orgId) return [];
  const { start, end } = currentWeekRange(new Date());
  try {
    let query = supabase
      .from('time_punches')
      .select('id, org_id, user_id, employee_id, employee_name, punch_type, punched_at, shift_id, scheduled_start, is_early')
      .eq('org_id', orgId)
      .gte('punched_at', start.toISOString())
      .lt('punched_at', end.toISOString())
      .order('punched_at', { ascending: true });
    if (!managerView && userId) {
      query = query.eq('user_id', userId);
    }
    const { data, error } = await query;
    if (error) {
      if (isMissingClockSchema(error)) return [];
      console.warn('[Clock] fetchWeekPunches:', error.message);
      return [];
    }
    return data || [];
  } catch (e) {
    console.warn('[Clock] fetchWeekPunches failed:', e?.message || e);
    return [];
  }
}

export function scheduledStartFromShift(shift) {
  if (!shift) return null;
  return parseShiftStart(shift.shift_date, shift.start_time);
}

export function evaluateStaffClockIn({ now = new Date(), todayShift = null } = {}) {
  return evaluateClockIn({
    now,
    scheduledStart: scheduledStartFromShift(todayShift),
  });
}

export async function submitPunch(supabase, {
  orgId,
  userId,
  employeeId = null,
  employeeName = '',
  punchType,
  todayShift = null,
  now = new Date(),
} = {}) {
  if (!supabase || !orgId || !userId) {
    return { ok: false, message: 'Missing organization or login.' };
  }
  const type = String(punchType || '').toLowerCase() === 'out' ? 'out' : 'in';
  const punches = await fetchWeekPunches(supabase, orgId, { userId });
  const openPunch = latestOpenPunch(punches);

  if (type === 'in') {
    if (openPunch) {
      return { ok: false, message: 'You are already clocked in.' };
    }
    const decision = evaluateStaffClockIn({ now, todayShift });
    if (!decision.allowed) {
      return { ok: false, blockedEarly: true, message: decision.message, decision };
    }
  } else {
    const decision = evaluateClockOut({ openPunch });
    if (!decision.allowed) {
      return { ok: false, message: decision.message, decision };
    }
  }

  const scheduledStart = scheduledStartFromShift(todayShift);
  const payload = {
    org_id: orgId,
    user_id: userId,
    employee_id: employeeId || null,
    employee_name: (employeeName || '').trim() || null,
    punch_type: type,
    punched_at: now.toISOString(),
    shift_id: todayShift?.id || null,
    scheduled_start: scheduledStart ? scheduledStart.toISOString() : null,
    is_early: false,
  };

  const { data, error } = await supabase.from('time_punches').insert(payload).select('*').maybeSingle();
  if (error) {
    if (isMissingClockSchema(error)) {
      return {
        ok: false,
        message: 'Clock in/out is not set up yet. Ask a manager to run supabase-clock-in-out.sql.',
      };
    }
    return { ok: false, message: error.message || 'Could not save punch.' };
  }
  return { ok: true, punch: data };
}
