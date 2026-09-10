import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../utils/supabase';
import { useEmployee } from '../EmployeeContext';
import { shiftRowMatchesEmployee, formatLocalDateYMD } from '../utils/shiftMatching';

const DAY_HEADERS = ['M', 'T', 'W', 'Th', 'F', 'S', 'S'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shiftRowKey(s) {
  if (!s) return '';
  if (s.id != null) return `id:${s.id}`;
  return `${s.shift_date}|${s.employee_name}|${s.start_time}|${s.end_time}`;
}

function buildProfileLabel(profile) {
  const firstLast = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim();
  return firstLast || (profile?.display_name || '').trim() || (profile?.employee_name || '').trim();
}

function getInitials(name) {
  return String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?';
}

function mergeShiftRows(prev, incoming) {
  const map = new Map();
  (prev || []).forEach((row) => map.set(shiftRowKey(row), row));
  (incoming || []).forEach((row) => map.set(shiftRowKey(row), row));
  return Array.from(map.values()).sort((a, b) => {
    const c = (a.shift_date || '').localeCompare(b.shift_date || '');
    return c !== 0 ? c : String(a.start_time || '').localeCompare(String(b.start_time || ''));
  });
}

function addDaysToYmd(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return formatLocalDateYMD(d);
}

function addMonthsToYmd(dateStr, months) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setMonth(d.getMonth() + months);
  return formatLocalDateYMD(d);
}

function getShiftSeriesInterval(prevDate, nextDate) {
  if (!prevDate || !nextDate) return null;
  if (addDaysToYmd(prevDate, 7) === nextDate) return 'weekly';
  if (addMonthsToYmd(prevDate, 1) === nextDate) return 'monthly';
  return null;
}

function groupRepeatingShifts(rows) {
  const byPattern = new Map();
  (rows || []).forEach((row) => {
    const key = [
      row.employee_name || '',
      row.position || '',
      row.start_time || '',
      row.end_time || '',
    ].join('|');
    if (!byPattern.has(key)) byPattern.set(key, []);
    byPattern.get(key).push(row);
  });

  const groups = [];
  byPattern.forEach((list) => {
    const sorted = [...list].sort((a, b) => (a.shift_date || '').localeCompare(b.shift_date || ''));
    if (sorted.length === 0) return;

    let run = [sorted[0]];
    let runInterval = null;

    const flush = () => {
      if (run.length === 0) return;
      groups.push({
        shift: run[0],
        shifts: [...run],
        repeatInterval: run.length > 1 ? runInterval : null,
        repeatCount: run.length,
        repeatUntil: run[run.length - 1]?.shift_date || run[0]?.shift_date || '',
      });
    };

    for (let i = 1; i < sorted.length; i += 1) {
      const prev = run[run.length - 1];
      const curr = sorted[i];
      const step = getShiftSeriesInterval(prev.shift_date, curr.shift_date);

      if (run.length === 1) {
        if (step) {
          runInterval = step;
          run.push(curr);
        } else {
          flush();
          run = [curr];
          runInterval = null;
        }
        continue;
      }

      if (step && step === runInterval) {
        run.push(curr);
      } else {
        flush();
        run = [curr];
        runInterval = null;
      }
    }

    flush();
  });

  return groups.sort((a, b) => (a.shift?.shift_date || '').localeCompare(b.shift?.shift_date || ''));
}

const SchedulePage = ({ orgId, profileData = {} }) => {
  const {
    employeeName,
    displayName,
    employeeId,
    authUserId,
    email,
    firstName,
    lastName,
    defaultEmployeeName,
    authLoading,
  } = useEmployee();
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(null);

  // Time-off modal state
  const [showTimeOffModal, setShowTimeOffModal] = useState(false);
  const [modalMonth, setModalMonth] = useState(new Date());
  const [rangeStart, setRangeStart] = useState(null);
  const [rangeEnd, setRangeEnd] = useState(null);

  // Shift action modal state
  const [showShiftModal, setShowShiftModal] = useState(false);
  const [selectedShift, setSelectedShift] = useState(null);
  const [shiftTasks, setShiftTasks] = useState([]);
  const [loadingShiftTasks, setLoadingShiftTasks] = useState(false);
  const [shiftNote, setShiftNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Day roster modal state
  const [showRoster, setShowRoster] = useState(false);
  const [rosterDate, setRosterDate] = useState(null);
  const [rosterShifts, setRosterShifts] = useState([]);
  const [loadingRoster, setLoadingRoster] = useState(false);

  // Transfer picker state
  const [showTransferPicker, setShowTransferPicker] = useState(false);
  const [transferCoworkers, setTransferCoworkers] = useState([]);
  const [loadingTransfer, setLoadingTransfer] = useState(false);
  const [selectedTransferTarget, setSelectedTransferTarget] = useState(null);
  const [transferSearch, setTransferSearch] = useState('');

  // Notifications state
  const [notifications, setNotifications] = useState([]);
  const [showNotifPanel, setShowNotifPanel] = useState(false);

  useEffect(() => {
    if (orgId) {
      fetchShifts();
      fetchNotifications();
    } else {
      setLoading(false);
    }
  }, [orgId, employeeId, employeeName, displayName, firstName, lastName, defaultEmployeeName]);

  /**
   * Dots on the month grid only reflect rows in `shifts`. The rolling fetch below is bounded;
   * this always loads the month you are looking at from Supabase and merges (so June / far
   * future months match what you see when you tap a day — roster was already correct).
   */
  useEffect(() => {
    if (!orgId) return;
    const y = currentMonth.getFullYear();
    const m = currentMonth.getMonth();
    const first = new Date(y, m, 1);
    const last = new Date(y, m + 1, 0);
    const startStr = formatLocalDateYMD(first);
    const endStr = formatLocalDateYMD(last);
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('shifts')
        .select('*')
        .eq('org_id', orgId)
        .gte('shift_date', startStr)
        .lte('shift_date', endStr)
        .order('shift_date', { ascending: true });
      if (cancelled || error) return;
      setShifts((prev) => mergeShiftRows(prev, data || []));
    })();
    return () => {
      cancelled = true;
    };
  }, [currentMonth, orgId]);

  async function fetchNotifications() {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('org_id', orgId)
      .eq('employee_name', employeeName)
      .order('created_at', { ascending: false })
      .limit(30);
    if (!error) {
      // Open-shift alerts are disabled in-app for now (manager web may still create these rows).
      setNotifications((data || []).filter((n) => n.type !== 'open_shift'));
    }
  }

  async function markAllRead() {
    const unreadIds = notifications.filter(n => !n.read).map(n => n.id);
    if (unreadIds.length === 0) return;
    await supabase.from('notifications').update({ read: true }).in('id', unreadIds);
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }

  async function fetchShifts(isRefresh = false) {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const now = new Date();
      const past = new Date(now);
      past.setDate(past.getDate() - 365);
      const future = new Date(now);
      future.setDate(future.getDate() + 365);
      const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

      const { data, error } = await supabase
        .from('shifts')
        .select('*')
        .eq('org_id', orgId)
        .gte('shift_date', fmt(past))
        .lte('shift_date', fmt(future))
        .order('shift_date', { ascending: true });

      if (error) {
        console.warn('[Schedule] fetchShifts RLS/query error:', JSON.stringify({ message: error.message, details: error.details, hint: error.hint, code: error.code }), 'orgId:', orgId);
      } else {
        const rows = data || [];
        if (__DEV__) {
          console.log('[Schedule] fetchShifts returned', rows.length, 'rows for org', orgId);
          if (rows.length > 0) {
            console.log('[Schedule] sample shift:', JSON.stringify({ id: rows[0].id, employee_name: rows[0].employee_name, employee_id: rows[0].employee_id, shift_date: rows[0].shift_date, position: rows[0].position }));
          }
        }
        setShifts((prev) => mergeShiftRows(prev, rows));
      }
    } catch (e) {
      console.warn('[Schedule] fetchShifts exception:', e?.message || e);
    } finally {
      if (isRefresh) setRefreshing(false);
      else setLoading(false);
    }
  }

  const onRefresh = () => { fetchShifts(true); fetchNotifications(); };

  const shiftNameCandidates = useMemo(() => {
    const combined = [firstName, lastName].filter(Boolean).join(' ').trim();
    const pCombined = [profileData?.firstName, profileData?.lastName].filter(Boolean).join(' ').trim();
    return Array.from(
      new Set(
        [
          employeeName,
          displayName,
          defaultEmployeeName,
          combined,
          firstName,
          lastName,
          (email || '').split('@')[0],
          profileData?.displayName,
          profileData?.employeeNameFromProfile,
          pCombined,
          profileData?.firstName,
          profileData?.lastName,
        ]
          .map((n) => (n || '').trim())
          .filter(Boolean)
      )
    );
  }, [employeeName, displayName, defaultEmployeeName, firstName, lastName, email, profileData]);

  const myShifts = useMemo(() => {
    if (authLoading) return [];
    const matched = shifts.filter((s) => shiftRowMatchesEmployee(s, employeeId, shiftNameCandidates, authUserId));
    if (__DEV__) {
      console.log('[Schedule] myShifts filter:', matched.length, '/', shifts.length, 'matched | employeeId:', employeeId, '| authUserId:', authUserId, '| candidates:', JSON.stringify(shiftNameCandidates));
    }
    return matched;
  }, [shifts, employeeId, shiftNameCandidates, authLoading, authUserId]);

  const scheduleUiLoading = loading || (!!orgId && authLoading);

  const shiftDateSet = new Set(myShifts.map((s) => s.shift_date));

  const formatTime = (timeStr) => {
    if (!timeStr) return '';
    const [h, m] = timeStr.split(':');
    const hour = parseInt(h);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    return `${hour % 12 || 12}:${m} ${ampm}`;
  };

  const formatDate = (dateStr) => {
    const d = new Date(dateStr + 'T00:00:00');
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()}`;
  };

  const getCalendarDays = () => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startOffset = (firstDay.getDay() + 6) % 7;
    const days = [];

    for (let i = 0; i < startOffset; i++) {
      const d = new Date(year, month, 1 - (startOffset - i));
      days.push({ date: d, isCurrentMonth: false });
    }
    for (let d = 1; d <= lastDay.getDate(); d++) {
      days.push({ date: new Date(year, month, d), isCurrentMonth: true });
    }
    while (days.length < 42) {
      const d = new Date(year, month + 1, days.length - lastDay.getDate() - startOffset + 1);
      days.push({ date: d, isCurrentMonth: false });
    }
    return days;
  };

  const toDateStr = (d) => formatLocalDateYMD(d);
  const todayStr = formatLocalDateYMD(new Date());

  const navigateMonth = (dir) => {
    const next = new Date(currentMonth);
    next.setMonth(currentMonth.getMonth() + dir);
    setCurrentMonth(next);
  };

  const calendarDays = getCalendarDays();
  const scheduleShifts = myShifts.filter((s) => s.shift_date >= todayStr);
  const groupedScheduleShifts = useMemo(
    () => groupRepeatingShifts(scheduleShifts),
    [scheduleShifts]
  );

  const getRepeatSummary = (group) => {
    if (!group?.repeatInterval || !group?.repeatCount || group.repeatCount < 2) return '';
    const unit = group.repeatInterval === 'monthly' ? 'month' : 'week';
    const everyLabel = group.repeatInterval === 'monthly' ? 'monthly' : 'weekly';
    const countLabel = `${group.repeatCount} ${unit}${group.repeatCount === 1 ? '' : 's'}`;
    return `Repeats ${everyLabel} for ${countLabel} until ${formatDate(group.repeatUntil)}`;
  };

  // ── Time-off modal helpers ─────────────────────────────────────────────────
  const getModalCalendarDays = () => {
    const year = modalMonth.getFullYear();
    const month = modalMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startOffset = (firstDay.getDay() + 6) % 7;
    const days = [];
    for (let i = 0; i < startOffset; i++) {
      days.push({ date: new Date(year, month, 1 - (startOffset - i)), isCurrentMonth: false });
    }
    for (let d = 1; d <= lastDay.getDate(); d++) {
      days.push({ date: new Date(year, month, d), isCurrentMonth: true });
    }
    while (days.length < 42) {
      days.push({ date: new Date(year, month + 1, days.length - lastDay.getDate() - startOffset + 1), isCurrentMonth: false });
    }
    return days;
  };

  const handleModalDayPress = (date) => {
    if (!rangeStart || (rangeStart && rangeEnd)) {
      setRangeStart(date);
      setRangeEnd(null);
    } else {
      if (date < rangeStart) {
        setRangeEnd(rangeStart);
        setRangeStart(date);
      } else {
        setRangeEnd(date);
      }
    }
  };

  const isInRange = (date) => {
    if (!rangeStart || !rangeEnd) return false;
    return date > rangeStart && date < rangeEnd;
  };

  const formatShortDate = (date) => {
    if (!date) return '—';
    return `${SHORT_MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  };

  const handleSubmitTimeOff = async () => {
    if (!rangeStart) {
      Alert.alert('Select Dates', 'Please select at least one date.');
      return;
    }
    const from = formatShortDate(rangeStart);
    const to = rangeEnd ? formatShortDate(rangeEnd) : from;
    const note = rangeEnd ? `${from} – ${to}` : from;
    setShowTimeOffModal(false);
    setRangeStart(null);
    setRangeEnd(null);

    try {
      const startDate = rangeStart;
      const endDate = rangeEnd || rangeStart;
      const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

      const startISO = fmt(startDate);
      const endISO = fmt(endDate);

      // One row per time-off period so the manager approves once and the web app can block
      // scheduling for the whole range (time_off_start_date / time_off_end_date).
      const payload = {
        org_id: orgId,
        shift_id: null,
        employee_name: employeeName,
        request_type: 'time_off',
        note,
        target_employee: null,
        status: 'pending',
        time_off_start_date: startISO,
        time_off_end_date: endISO,
      };
      console.log('[TimeOff] orgId:', orgId, '| employeeName:', employeeName, '| range:', startISO, '-', endISO);
      console.log('[TimeOff] inserting single shift_request:', JSON.stringify(payload));
      const { data: inserted, error } = await supabase.from('shift_requests').insert(payload).select();
      if (error) {
        console.warn('[TimeOff] insert FAILED:', error.message, error.hint || '', error.code || '');
        throw error;
      }
      console.log('[TimeOff] insert OK, row:', JSON.stringify(inserted));
      const insertedCount = 1;

      const { error: notifErr } = await supabase.from('notifications').insert({
        org_id: orgId,
        employee_name: 'Manager',
        type: 'shift_request',
        title: 'New Time Off Request',
        body: `${employeeName} requested time off ${note}`,
        read: false,
      });
      if (notifErr) console.warn('[TimeOff] notification insert failed:', notifErr.message);

      Alert.alert(
        'Request Submitted',
        `Your Time Off request for ${note} has been sent to your manager. (${insertedCount} shift request(s) created)`
      );
    } catch (e) {
      const msg = e?.message || 'Unknown error';
      Alert.alert('Error', `Could not submit request: ${msg}`);
      console.warn('[Supabase] shift_request failed:', msg);
    }
  };

  const modalDays = getModalCalendarDays();

  // ── Shift action modal helpers ─────────────────────────────────────────────
  const openShiftModal = (shift) => {
    setSelectedShift(shift);
    setShiftNote('');
    setShowShiftModal(true);
  };

  const closeShiftModal = () => {
    setShowShiftModal(false);
    setSelectedShift(null);
    setShiftTasks([]);
    setLoadingShiftTasks(false);
    setShiftNote('');
    setShowTransferPicker(false);
    setSelectedTransferTarget(null);
    setTransferCoworkers([]);
  };

  useEffect(() => {
    let cancelled = false;

    async function fetchShiftTasks() {
      if (!orgId || !selectedShift?.id || !showShiftModal) {
        setShiftTasks([]);
        setLoadingShiftTasks(false);
        return;
      }

      setLoadingShiftTasks(true);
      const { data, error } = await supabase
        .from('tasks')
        .select('id, text, status, completed_at, created_at, shift_id')
        .eq('org_id', orgId)
        .eq('shift_id', selectedShift.id)
        .order('id', { ascending: true });

      if (cancelled) return;

      if (error) {
        console.warn('[Schedule] fetchShiftTasks error:', error.message);
        setShiftTasks([]);
      } else {
        let rows = data || [];

        // Fallback: if the visible shift row has a different id than the one
        // tasks were originally linked to, look up sibling shift rows that
        // share the same employee/date/time and pull tasks from any of them.
        if (
          rows.length === 0 &&
          selectedShift?.shift_date &&
          selectedShift?.start_time &&
          selectedShift?.end_time
        ) {
          const { data: siblingShifts, error: siblingErr } = await supabase
            .from('shifts')
            .select('id')
            .eq('org_id', orgId)
            .eq('shift_date', selectedShift.shift_date)
            .eq('start_time', selectedShift.start_time)
            .eq('end_time', selectedShift.end_time)
            .eq('employee_name', selectedShift.employee_name || '');

          if (cancelled) return;

          if (siblingErr) {
            console.warn('[Schedule] fetchShiftTasks sibling shift lookup error:', siblingErr.message);
          } else {
            const siblingIds = [...new Set((siblingShifts || []).map((s) => s.id).filter(Boolean))];
            if (siblingIds.length > 0) {
              const { data: fallbackTasks, error: fallbackErr } = await supabase
                .from('tasks')
                .select('id, text, status, completed_at, created_at, shift_id')
                .eq('org_id', orgId)
                .in('shift_id', siblingIds)
                .order('id', { ascending: true });

              if (cancelled) return;

              if (fallbackErr) {
                console.warn('[Schedule] fetchShiftTasks fallback task lookup error:', fallbackErr.message);
              } else {
                rows = fallbackTasks || [];
              }
            }
          }
        }

        setShiftTasks(rows);
      }
      setLoadingShiftTasks(false);
    }

    fetchShiftTasks();
    return () => {
      cancelled = true;
    };
  }, [orgId, selectedShift?.id, showShiftModal]);

  const openDayRoster = async (dateStr) => {
    setRosterDate(dateStr);
    setRosterShifts([]);
    setShowRoster(true);
    setLoadingRoster(true);
    try {
      const { data, error } = await supabase
        .from('shifts')
        .select('employee_name, position, start_time, end_time')
        .eq('org_id', orgId)
        .eq('shift_date', dateStr)
        .order('start_time', { ascending: true });
      if (!error) setRosterShifts(data || []);
    } catch (e) {
      console.warn('[Roster] fetch error:', e.message);
    } finally {
      setLoadingRoster(false);
    }
  };

  const fetchAvailableCoworkers = async (shift) => {
    setLoadingTransfer(true);
    setTransferCoworkers([]);
    setTransferSearch('');
    try {
      const norm = (v) => (v || '').trim().toLowerCase();
      const shiftPos = norm(shift?.position);
      const selfNames = new Set(shiftNameCandidates.map(norm).filter(Boolean));

      const [{ data: dayShifts }, { data: capabilityRows }, profileRes] = await Promise.all([
        supabase
          .from('shifts')
          .select('employee_name')
          .eq('org_id', orgId)
          .eq('shift_date', shift.shift_date),
        supabase
          .from('employee_positions')
          .select('employee_name, positions')
          .eq('org_id', orgId),
        supabase
          .from('profiles')
          .select('employee_name, display_name, first_name, last_name, avatar_url, avatar_color')
          .eq('org_id', orgId),
      ]);
      if (profileRes.error) {
        console.warn('[Transfer] profiles query error:', profileRes.error.message);
      }
      const profiles = profileRes.data;

      const profileByKey = new Map();
      (profiles || []).forEach((p) => {
        const label = buildProfileLabel(p);
        const info = {
          rawName: (p.employee_name || '').trim() || label,
          label,
          avatarUrl: (p.avatar_url || '').trim() || null,
          avatarColor: (p.avatar_color || '').trim() || '#4CAF50',
        };
        const empKey = norm(p.employee_name);
        const displayKey = norm(p.display_name);
        const labelKey = norm(label);
        const firstKey = norm(p.first_name);
        const lastKey = norm(p.last_name);
        if (empKey) profileByKey.set(empKey, info);
        if (displayKey) profileByKey.set(displayKey, info);
        if (labelKey) profileByKey.set(labelKey, info);
        if (firstKey && !profileByKey.has(firstKey)) profileByKey.set(firstKey, info);
        if (lastKey && !profileByKey.has(lastKey)) profileByKey.set(lastKey, info);
      });

      const scheduledOnDay = new Set();
      (dayShifts || []).forEach((s) => {
        const raw = norm(s.employee_name);
        if (!raw) return;
        scheduledOnDay.add(raw);
        const profileInfo = profileByKey.get(raw);
        if (profileInfo?.label) scheduledOnDay.add(norm(profileInfo.label));
        if (profileInfo?.rawName) scheduledOnDay.add(norm(profileInfo.rawName));
      });

      const capableByKey = new Map();
      (capabilityRows || []).forEach((row) => {
        const rawName = (row.employee_name || '').trim();
        const rawKey = norm(rawName);
        const positions = Array.isArray(row.positions) ? row.positions : [];
        const canDoPosition = positions.some((p) => {
          const name = typeof p === 'string' ? p : (p?.name || '');
          return norm(name) === shiftPos;
        });
        if (!rawKey || !canDoPosition) return;
        const profileInfo = profileByKey.get(rawKey);
        const label = profileInfo?.label || rawName;
        const labelKey = norm(label);
        if (selfNames.has(rawKey) || selfNames.has(labelKey)) return;
        if (scheduledOnDay.has(rawKey) || scheduledOnDay.has(labelKey)) return;
        capableByKey.set(rawKey, {
          rawName,
          label,
          avatarUrl: profileInfo?.avatarUrl || null,
          avatarColor: profileInfo?.avatarColor || '#4CAF50',
        });
      });

      setTransferCoworkers(
        Array.from(capableByKey.values()).sort((a, b) => a.label.localeCompare(b.label))
      );
    } catch (e) {
      console.warn('[Transfer] fetchAvailableCoworkers error:', e.message);
    } finally {
      setLoadingTransfer(false);
    }
  };

  const handleShiftRequest = async (type, targetEmployee = null) => {
    if (!selectedShift) return;
    setSubmitting(true);
    try {
      const targetEmployeeName =
        typeof targetEmployee === 'string'
          ? targetEmployee
          : (targetEmployee?.rawName || null);
      const targetEmployeeLabel =
        typeof targetEmployee === 'string'
          ? targetEmployee
          : (targetEmployee?.label || targetEmployee?.rawName || null);
      const payload = {
        org_id: orgId,
        shift_id: selectedShift.id,
        employee_name: employeeName,
        request_type: type,
        note: shiftNote.trim() || null,
        target_employee: targetEmployeeName,
        status: 'pending',
      };
      console.log('[ShiftRequest] inserting:', JSON.stringify(payload));
      const { data: inserted, error } = await supabase.from('shift_requests').insert(payload).select();
      if (error) {
        console.warn('[ShiftRequest] insert FAILED:', error.message, error.hint || '', error.code || '');
        throw error;
      }
      console.log('[ShiftRequest] insert OK:', JSON.stringify(inserted));
      const label = type === 'time_off'
        ? 'Time Off'
        : targetEmployeeLabel
          ? `Transfer to ${targetEmployeeLabel}`
          : 'Transfer';
      const notePart = shiftNote.trim() ? ` — Note: ${shiftNote.trim()}` : '';
      const { error: notifErr } = await supabase.from('notifications').insert({
        org_id: orgId,
        employee_name: 'Manager',
        type: 'shift_request',
        title: 'New Shift Request',
        body: `${employeeName} requested ${label} for ${formatDate(selectedShift.shift_date)}${notePart}`,
        read: false,
        shift_id: selectedShift.id,
      });
      if (notifErr) console.warn('[ShiftRequest] notification insert failed:', notifErr.message);
      closeShiftModal();
      Alert.alert(
        'Request Submitted',
        `Your ${label} request for ${formatDate(selectedShift.shift_date)} has been sent to your manager.`
      );
    } catch (e) {
      const msg = e?.message || 'Unknown error';
      const hint = /stack depth/i.test(msg)
        ? '\n\nFix: Supabase → SQL Editor → run rls-fix-org-members-shifts.sql in Supabase SQL Editor.'
        : '';
      Alert.alert('Error', `Could not submit request: ${msg}${hint}`);
      console.warn('[Supabase] shift_request failed:', msg);
    } finally {
      setSubmitting(false);
    }
  };

  // When a calendar day is tapped, always show the day roster
  const handleCalendarDayPress = (item) => {
    if (!item.isCurrentMonth) return;
    setSelectedDate(item.date);
    const ds = toDateStr(item.date);
    openDayRoster(ds);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Schedule</Text>
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#4CAF50" />
        }
      >
        {scheduleUiLoading ? (
          <ActivityIndicator size="large" color="#4CAF50" style={{ marginTop: 40, marginBottom: 24 }} />
        ) : (
        <>
        {/* Inline Calendar */}
        <View style={styles.calendarCard}>
          <View style={styles.monthNav}>
            <TouchableOpacity onPress={() => navigateMonth(-1)} style={styles.navBtn}>
              <Ionicons name="chevron-back" size={22} color="#4a5568" />
            </TouchableOpacity>
            <Text style={styles.monthTitle}>
              {MONTH_NAMES[currentMonth.getMonth()]} {currentMonth.getFullYear()}
            </Text>
            <TouchableOpacity onPress={() => navigateMonth(1)} style={styles.navBtn}>
              <Ionicons name="chevron-forward" size={22} color="#4a5568" />
            </TouchableOpacity>
          </View>

          <View style={styles.dayHeadersRow}>
            {DAY_HEADERS.map((d, i) => (
              <View key={i} style={styles.dayHeaderCell}>
                <Text style={styles.dayHeaderText}>{d}</Text>
              </View>
            ))}
          </View>

          <View style={styles.calendarGrid}>
            {calendarDays.map((item, i) => {
              const ds = toDateStr(item.date);
              const isToday = ds === todayStr;
              const isSelected = selectedDate && toDateStr(selectedDate) === ds;
              const isShift = shiftDateSet.has(ds) && item.isCurrentMonth;

              return (
                <TouchableOpacity
                  key={i}
                  style={[
                    styles.dayCell,
                    !item.isCurrentMonth && styles.dayCellInactive,
                    isShift && !isSelected && styles.dayCellShift,
                    isToday && !isSelected && styles.dayCellToday,
                    isSelected && styles.dayCellSelected,
                  ]}
                  onPress={() => handleCalendarDayPress(item)}
                >
                  <Text style={[
                    styles.dayText,
                    !item.isCurrentMonth && styles.dayTextInactive,
                    isShift && !isSelected && styles.dayTextShift,
                    isToday && !isSelected && styles.dayTextToday,
                    isSelected && styles.dayTextSelected,
                  ]}>
                    {item.date.getDate()}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity
            style={styles.requestTimeOffBtn}
            onPress={() => {
              setRangeStart(null);
              setRangeEnd(null);
              setModalMonth(new Date());
              setShowTimeOffModal(true);
            }}
          >
            <Ionicons name="calendar-outline" size={18} color="#4CAF50" style={{ marginRight: 8 }} />
            <Text style={styles.requestTimeOffBtnText}>Request Time Off</Text>
          </TouchableOpacity>
        </View>

        {/* Shifts List (today onwards) */}
        <Text style={styles.sectionTitle}>Shifts</Text>

        {groupedScheduleShifts.length === 0 ? (
          <Text style={styles.emptyText}>No upcoming shifts scheduled.</Text>
        ) : (
          <View style={styles.scheduleList}>
            {groupedScheduleShifts.map((group) => {
              const shift = group.shift;
              const repeatSummary = getRepeatSummary(group);
              return (
              <TouchableOpacity
                key={`${shift.id || shiftRowKey(shift)}|${group.repeatUntil || shift.shift_date}`}
                style={styles.staffItem}
                onPress={() => openShiftModal(shift)}
                activeOpacity={0.7}
              >
                <View>
                  <Text style={styles.staffName}>{formatDate(shift.shift_date)}</Text>
                  <Text style={styles.shiftTime}>
                    {formatTime(shift.start_time)} – {formatTime(shift.end_time)}
                  </Text>
                  {repeatSummary ? (
                    <Text style={styles.repeatSummary}>{repeatSummary}</Text>
                  ) : null}
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.staffPosition}>{shift.position || '—'}</Text>
                  {shift.employee_name ? (
                    <Text style={styles.employeeTag}>{shift.employee_name}</Text>
                  ) : null}
                  <Ionicons name="chevron-forward" size={14} color="#a0aec0" style={{ marginTop: 4 }} />
                </View>
              </TouchableOpacity>
            );})}
          </View>
        )}

        </>
        )}
      </ScrollView>

      {/* Day Roster Modal */}
      <Modal
        visible={showRoster}
        transparent
        animationType="slide"
        onRequestClose={() => setShowRoster(false)}
      >
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowRoster(false)}>
          <TouchableOpacity activeOpacity={1} style={[styles.modalCard, { maxHeight: '75%' }]}>
            <View style={styles.shiftModalHandle} />

            {/* Header */}
            <View style={styles.rosterHeader}>
              <View style={styles.rosterIconBg}>
                <Ionicons name="people" size={20} color="#4CAF50" />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.rosterTitle}>Who's Working</Text>
                {rosterDate && (
                  <Text style={styles.rosterSubtitle}>
                    {(() => {
                      const d = new Date(rosterDate + 'T00:00:00');
                      const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
                      return `${days[d.getDay()]}, ${SHORT_MONTHS[d.getMonth()]} ${d.getDate()}`;
                    })()}
                  </Text>
                )}
              </View>
              <TouchableOpacity onPress={() => setShowRoster(false)}>
                <Ionicons name="close" size={22} color="#a0aec0" />
              </TouchableOpacity>
            </View>

            <View style={styles.shiftModalDivider} />

            {loadingRoster ? (
              <ActivityIndicator color="#4CAF50" style={{ paddingVertical: 30 }} />
            ) : rosterShifts.length === 0 ? (
              <View style={styles.rosterEmpty}>
                <Ionicons name="calendar-outline" size={36} color="#cbd5e0" />
                <Text style={styles.rosterEmptyText}>No shifts scheduled this day</Text>
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 340 }}>
                {rosterShifts.map((s, i) => {
                  const isMe = (s.employee_name || '').toLowerCase() === employeeName.toLowerCase();
                  const myShiftOnDay = isMe ? myShifts.find((sh) => sh.shift_date === rosterDate) : null;
                  return (
                    <View key={i} style={[styles.rosterRow, isMe && styles.rosterRowMe]}>
                      <View style={[styles.rosterAvatar, isMe && styles.rosterAvatarMe]}>
                        <Text style={styles.rosterAvatarText}>
                          {(s.employee_name || '?').charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={styles.rosterNameRow}>
                          <Text style={[styles.rosterName, isMe && styles.rosterNameMe]}>
                            {isMe ? 'You' : s.employee_name}
                          </Text>
                          {isMe && <View style={styles.meBadge}><Text style={styles.meBadgeText}>Me</Text></View>}
                        </View>
                        <Text style={styles.rosterPosition}>{s.position || '—'}</Text>
                        <Text style={styles.rosterTime}>
                          {formatTime(s.start_time)} – {formatTime(s.end_time)}
                        </Text>
                      </View>
                      {isMe && myShiftOnDay && (
                        <TouchableOpacity
                          style={styles.rosterActionBtn}
                          onPress={() => { setShowRoster(false); openShiftModal(myShiftOnDay); }}
                        >
                          <Text style={styles.rosterActionText}>Manage</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })}
              </ScrollView>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Notification Panel */}
      <Modal
        visible={showNotifPanel}
        transparent
        animationType="slide"
        onRequestClose={() => setShowNotifPanel(false)}
      >
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowNotifPanel(false)}>
          <TouchableOpacity activeOpacity={1} style={[styles.modalCard, { maxHeight: '75%' }]}>
            <View style={styles.shiftModalHandle} />

            <View style={styles.notifPanelHeader}>
              <Text style={styles.notifPanelTitle}>Notifications</Text>
              <TouchableOpacity onPress={() => setShowNotifPanel(false)}>
                <Ionicons name="close" size={22} color="#4a5568" />
              </TouchableOpacity>
            </View>

            {notifications.length === 0 ? (
              <View style={styles.notifEmpty}>
                <Ionicons name="notifications-off-outline" size={40} color="#e2e8f0" />
                <Text style={styles.notifEmptyText}>No notifications yet</Text>
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                {notifications.map((notif) => {
                  const d = new Date(notif.created_at);
                  const timeAgo = (() => {
                    const diff = Math.floor((Date.now() - d.getTime()) / 1000);
                    if (diff < 60) return 'just now';
                    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
                    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
                    return `${Math.floor(diff / 86400)}d ago`;
                  })();
                  return (
                    <TouchableOpacity
                      key={notif.id}
                      style={[styles.notifRow, !notif.read && styles.notifRowUnread]}
                      onPress={() => {
                        setShowNotifPanel(false);
                        fetchShifts();
                      }}
                      activeOpacity={0.75}
                    >
                      <View style={[styles.notifIconBg, !notif.read && styles.notifIconBgUnread]}>
                        <Ionicons
                          name={notif.type === 'shift_assigned' ? 'calendar' : 'information-circle'}
                          size={18}
                          color={notif.read ? '#718096' : '#4CAF50'}
                        />
                      </View>
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={[styles.notifTitle, !notif.read && styles.notifTitleUnread]}>
                          {notif.title}
                        </Text>
                        <Text style={styles.notifBody}>{notif.body}</Text>
                        <Text style={styles.notifTime}>{timeAgo}</Text>
                      </View>
                      {!notif.read && <View style={styles.notifDot} />}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Shift Action Modal */}
      <Modal
        visible={showShiftModal}
        transparent
        animationType="slide"
        onRequestClose={closeShiftModal}
      >
        <KeyboardAvoidingView
          style={styles.modalKeyboardRoot}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
        >
          <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={closeShiftModal}>
            <View style={[styles.modalCard, styles.shiftModalCard]}>
              <View style={styles.shiftModalHandle} />

              <ScrollView
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
                showsVerticalScrollIndicator={false}
                bounces={false}
                contentContainerStyle={styles.shiftModalScrollContent}
              >
                {selectedShift && (
                  <>
                    <View style={styles.shiftModalHeader}>
                      <View style={styles.shiftModalIconBg}>
                        <Ionicons name="calendar" size={22} color="#4CAF50" />
                      </View>
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={styles.shiftModalDate}>{formatDate(selectedShift.shift_date)}</Text>
                        <Text style={styles.shiftModalTime}>
                          {formatTime(selectedShift.start_time)} – {formatTime(selectedShift.end_time)}
                        </Text>
                      </View>
                      <View style={styles.shiftModalBadge}>
                        <Text style={styles.shiftModalBadgeText}>{selectedShift.position || '—'}</Text>
                      </View>
                    </View>

                    <View style={styles.shiftModalDivider} />

                    <Text style={styles.shiftModalSectionLabel}>Assigned Tasks</Text>
                    {loadingShiftTasks ? (
                      <ActivityIndicator color="#4CAF50" style={{ paddingVertical: 12 }} />
                    ) : shiftTasks.length > 0 ? (
                      <View style={styles.shiftTasksList}>
                        {shiftTasks.map((task) => {
                          const isDone =
                        String(task.status || '').toLowerCase() === 'completed' ||
                        task.completed === true ||
                        !!task.completed_at;
                          return (
                            <View
                              key={task.id}
                              style={[styles.shiftTaskRow, isDone && styles.shiftTaskRowCompleted]}
                            >
                              <Ionicons
                                name={isDone ? 'checkmark-circle' : 'ellipse-outline'}
                                size={18}
                                color={isDone ? '#4CAF50' : '#94a3b8'}
                                style={{ marginRight: 10, marginTop: 1 }}
                              />
                              <Text style={[styles.shiftTaskText, isDone && styles.shiftTaskTextCompleted]}>
                                {task.text}
                              </Text>
                            </View>
                          );
                        })}
                      </View>
                    ) : (
                      <Text style={styles.shiftTasksEmpty}>
                        No tasks assigned to this shift yet.
                      </Text>
                    )}

                    <View style={styles.shiftModalDivider} />

                    <Text style={styles.shiftModalNoteLabel}>Note to manager (optional)</Text>
                    <TextInput
                      style={styles.shiftModalNoteInput}
                      placeholder="e.g. doctor's appointment, family event…"
                      placeholderTextColor="#a0aec0"
                      value={shiftNote}
                      onChangeText={setShiftNote}
                      multiline
                      maxLength={200}
                    />

                    {showTransferPicker ? (
                      <View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                          <Ionicons name="swap-horizontal-outline" size={16} color="#2b6cb0" style={{ marginRight: 6 }} />
                          <Text style={[styles.shiftModalNoteLabel, { marginBottom: 0 }]}>
                            Available Coworkers — {selectedShift.position || 'Same Role'}
                          </Text>
                        </View>

                        {loadingTransfer ? (
                          <ActivityIndicator color="#4CAF50" style={{ paddingVertical: 20 }} />
                        ) : transferCoworkers.length === 0 ? (
                          <View style={styles.transferEmpty}>
                            <Ionicons name="people-outline" size={32} color="#cbd5e0" />
                            <Text style={styles.transferEmptyText}>
                              No available coworkers for this position on this day.
                            </Text>
                          </View>
                        ) : (
                          <>
                            <View style={styles.transferSearchContainer}>
                              <Ionicons name="search" size={16} color="#4a5568" style={{ marginRight: 6 }} />
                              <TextInput
                                style={styles.transferSearchInput}
                                placeholder="Search coworkers..."
                                placeholderTextColor="#a0aec0"
                                value={transferSearch}
                                onChangeText={setTransferSearch}
                              />
                              {transferSearch.length > 0 && (
                                <TouchableOpacity onPress={() => setTransferSearch('')}>
                                  <Ionicons name="close-circle" size={16} color="#a0aec0" />
                                </TouchableOpacity>
                              )}
                            </View>
                            {transferCoworkers
                              .filter((coworker) => {
                                const needle = transferSearch.trim().toLowerCase();
                                if (!needle) return true;
                                return [coworker.label, coworker.rawName]
                                  .filter(Boolean)
                                  .some((value) => value.toLowerCase().includes(needle));
                              })
                              .map((coworker) => (
                                <TouchableOpacity
                                  key={coworker.rawName || coworker.label}
                                  style={[
                                    styles.coworkerRow,
                                    selectedTransferTarget === coworker.rawName && styles.coworkerRowSelected,
                                  ]}
                                  onPress={() => setSelectedTransferTarget(coworker.rawName)}
                                  activeOpacity={0.7}
                                >
                                  {coworker.avatarUrl ? (
                                    <Image source={{ uri: coworker.avatarUrl }} style={styles.coworkerAvatarImage} />
                                  ) : (
                                    <View style={[styles.coworkerAvatar, { backgroundColor: coworker.avatarColor || '#4CAF50' }]}>
                                      <Text style={styles.coworkerAvatarText}>
                                        {getInitials(coworker.label || coworker.rawName)}
                                      </Text>
                                    </View>
                                  )}
                                  <Text style={styles.coworkerName}>{coworker.label || coworker.rawName}</Text>
                                  {selectedTransferTarget === coworker.rawName && (
                                    <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
                                  )}
                                </TouchableOpacity>
                              ))}
                          </>
                        )}

                        {selectedTransferTarget && (
                          <TouchableOpacity
                            style={[styles.shiftActionBtn, styles.shiftActionTransfer, { marginTop: 12 }]}
                            onPress={() => handleShiftRequest('transfer', transferCoworkers.find((coworker) => coworker.rawName === selectedTransferTarget) || selectedTransferTarget)}
                            disabled={submitting}
                          >
                            <Ionicons name="swap-horizontal-outline" size={18} color="#2b6cb0" style={{ marginRight: 6 }} />
                            <Text style={styles.shiftActionTransferText}>
                              {submitting
                                ? 'Sending…'
                                : `Send to ${transferCoworkers.find((coworker) => coworker.rawName === selectedTransferTarget)?.label || selectedTransferTarget}`}
                            </Text>
                          </TouchableOpacity>
                        )}

                        <TouchableOpacity
                          style={{ alignItems: 'center', paddingVertical: 12 }}
                          onPress={() => { setShowTransferPicker(false); setSelectedTransferTarget(null); }}
                        >
                          <Text style={{ fontSize: 14, color: '#718096' }}>← Back</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <View style={styles.shiftModalActions}>
                        <TouchableOpacity
                          style={[styles.shiftActionBtn, styles.shiftActionTimeOff]}
                          onPress={() => handleShiftRequest('time_off')}
                          disabled={submitting}
                        >
                          <Ionicons name="time-outline" size={18} color="#c05621" style={{ marginRight: 6 }} />
                          <Text style={styles.shiftActionTimeOffText}>Request Time Off</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[styles.shiftActionBtn, styles.shiftActionTransfer]}
                          onPress={() => { setShowTransferPicker(true); fetchAvailableCoworkers(selectedShift); }}
                          disabled={submitting}
                        >
                          <Ionicons name="swap-horizontal-outline" size={18} color="#2b6cb0" style={{ marginRight: 6 }} />
                          <Text style={styles.shiftActionTransferText}>Request Transfer</Text>
                        </TouchableOpacity>
                      </View>
                    )}

                    <TouchableOpacity style={styles.shiftModalCancelBtn} onPress={closeShiftModal}>
                      <Text style={styles.shiftModalCancelText}>Cancel</Text>
                    </TouchableOpacity>
                  </>
                )}
              </ScrollView>
            </View>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>

      {/* Time Off Modal */}
      <Modal
        visible={showTimeOffModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowTimeOffModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Request Time Off</Text>
              <TouchableOpacity onPress={() => { setShowTimeOffModal(false); setRangeStart(null); setRangeEnd(null); }}>
                <Ionicons name="close" size={24} color="#4a5568" />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSubtitle}>Tap a start date, then tap an end date</Text>

            {/* Selected Range Display */}
            <View style={styles.rangeDisplay}>
              <View style={styles.rangeBox}>
                <Text style={styles.rangeLabel}>From</Text>
                <Text style={[styles.rangeValue, rangeStart && styles.rangeValueActive]}>
                  {formatShortDate(rangeStart)}
                </Text>
              </View>
              <Ionicons name="arrow-forward" size={16} color="#a0aec0" style={{ marginTop: 16 }} />
              <View style={styles.rangeBox}>
                <Text style={styles.rangeLabel}>To</Text>
                <Text style={[styles.rangeValue, rangeEnd && styles.rangeValueActive]}>
                  {formatShortDate(rangeEnd)}
                </Text>
              </View>
            </View>

            {/* Modal Calendar */}
            <View style={styles.modalMonthNav}>
              <TouchableOpacity onPress={() => { const m = new Date(modalMonth); m.setMonth(m.getMonth() - 1); setModalMonth(m); }} style={styles.navBtn}>
                <Ionicons name="chevron-back" size={20} color="#4a5568" />
              </TouchableOpacity>
              <Text style={styles.modalMonthTitle}>
                {MONTH_NAMES[modalMonth.getMonth()]} {modalMonth.getFullYear()}
              </Text>
              <TouchableOpacity onPress={() => { const m = new Date(modalMonth); m.setMonth(m.getMonth() + 1); setModalMonth(m); }} style={styles.navBtn}>
                <Ionicons name="chevron-forward" size={20} color="#4a5568" />
              </TouchableOpacity>
            </View>

            <View style={styles.dayHeadersRow}>
              {DAY_HEADERS.map((d, i) => (
                <View key={i} style={styles.dayHeaderCell}>
                  <Text style={styles.dayHeaderText}>{d}</Text>
                </View>
              ))}
            </View>

            <View style={styles.calendarGrid}>
              {modalDays.map((item, i) => {
                const ds = toDateStr(item.date);
                const isStart = rangeStart && toDateStr(rangeStart) === ds;
                const isEnd = rangeEnd && toDateStr(rangeEnd) === ds;
                const inRange = isInRange(item.date);
                const isPast = item.date < new Date(new Date().setHours(0,0,0,0));

                return (
                  <TouchableOpacity
                    key={i}
                    style={[
                      styles.modalDayCell,
                      !item.isCurrentMonth && styles.dayCellInactive,
                      inRange && styles.modalDayCellRange,
                      (isStart || isEnd) && styles.modalDayCellEndpoint,
                      isPast && item.isCurrentMonth && styles.modalDayCellPast,
                    ]}
                    onPress={() => item.isCurrentMonth && !isPast && handleModalDayPress(item.date)}
                    disabled={!item.isCurrentMonth || isPast}
                  >
                    <Text style={[
                      styles.dayText,
                      !item.isCurrentMonth && styles.dayTextInactive,
                      inRange && styles.modalDayTextRange,
                      (isStart || isEnd) && styles.dayTextSelected,
                      isPast && item.isCurrentMonth && styles.modalDayTextPast,
                    ]}>
                      {item.date.getDate()}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Action Buttons */}
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => { setShowTimeOffModal(false); setRangeStart(null); setRangeEnd(null); }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSubmitBtn} onPress={handleSubmitTimeOff}>
                <Text style={styles.modalSubmitText}>Submit Request</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fa' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 50,
    paddingBottom: 15,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  headerTitle: { fontSize: 22, fontWeight: '700', color: '#2d3748' },
  notificationIcon: { padding: 8 },
  content: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },

  // Calendar
  calendarCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  monthNav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  navBtn: { padding: 8 },
  monthTitle: { fontSize: 16, fontWeight: '700', color: '#2d3748' },
  dayHeadersRow: { flexDirection: 'row', marginBottom: 4 },
  dayHeaderCell: { flex: 1, alignItems: 'center', paddingVertical: 6 },
  dayHeaderText: { fontSize: 12, fontWeight: '600', color: '#4a5568' },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: {
    width: '14.28%',
    aspectRatio: 1,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  dayCellInactive: { opacity: 0.25 },
  dayCellShift: { backgroundColor: '#e8f5e9', borderWidth: 1.5, borderColor: '#4CAF50' },
  dayCellToday: { backgroundColor: '#2d3748' },
  dayCellSelected: { backgroundColor: '#4CAF50' },
  dayText: { fontSize: 14, color: '#2d3748', fontWeight: '500' },
  dayTextInactive: { color: '#e2e8f0' },
  dayTextShift: { color: '#2e7d32', fontWeight: '600' },
  dayTextToday: { color: 'white', fontWeight: 'bold' },
  dayTextSelected: { color: 'white', fontWeight: 'bold' },
  requestTimeOffBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#e8f5e9',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#4CAF50',
  },
  requestTimeOffBtnText: { fontSize: 15, fontWeight: '600', color: '#2e7d32' },

  // Shifts list
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#4a5568', marginBottom: 12 },
  emptyText: { fontSize: 15, color: '#718096', textAlign: 'center', marginTop: 20 },
  scheduleList: { marginBottom: 24 },
  staffItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  staffName: { fontSize: 16, fontWeight: '600', color: '#2d3748' },
  shiftTime: { fontSize: 13, color: '#718096', marginTop: 2 },
  repeatSummary: { fontSize: 12, color: '#4CAF50', marginTop: 6, fontWeight: '600', maxWidth: 220, lineHeight: 16 },
  staffPosition: { fontSize: 15, color: '#4CAF50', fontWeight: '500' },
  employeeTag: { fontSize: 12, color: '#718096', marginTop: 2 },

  // Bell badge
  notifBadge: {
    position: 'absolute', top: 4, right: 4,
    backgroundColor: '#e53e3e', borderRadius: 8,
    minWidth: 16, height: 16, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 3,
  },
  notifBadgeText: { color: 'white', fontSize: 10, fontWeight: '700' },

  // Notification panel
  notifPanelHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16,
  },
  notifPanelTitle: { fontSize: 20, fontWeight: '700', color: '#2d3748' },
  notifEmpty: { alignItems: 'center', paddingVertical: 40, gap: 12 },
  notifEmptyText: { fontSize: 14, color: '#a0aec0' },
  notifRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
  },
  notifRowUnread: { backgroundColor: '#f0fff4', marginHorizontal: -24, paddingHorizontal: 24, borderRadius: 0 },
  notifIconBg: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: '#f7fafc', justifyContent: 'center', alignItems: 'center',
  },
  notifIconBgUnread: { backgroundColor: '#e8f5e9' },
  notifTitle: { fontSize: 14, fontWeight: '600', color: '#4a5568' },
  notifTitleUnread: { color: '#2d3748' },
  notifBody: { fontSize: 13, color: '#718096', marginTop: 2 },
  notifTime: { fontSize: 11, color: '#a0aec0', marginTop: 4 },
  notifDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4CAF50', marginTop: 6, marginLeft: 8 },

  // Shift action modal
  shiftModalHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: '#e2e8f0', alignSelf: 'center', marginBottom: 20,
  },
  shiftModalHeader: {
    flexDirection: 'row', alignItems: 'center', marginBottom: 20,
  },
  shiftModalIconBg: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: '#f0fff4', justifyContent: 'center', alignItems: 'center',
  },
  shiftModalDate: { fontSize: 16, fontWeight: '700', color: '#2d3748' },
  shiftModalTime: { fontSize: 13, color: '#718096', marginTop: 2 },
  shiftModalBadge: {
    backgroundColor: '#ebf8ff', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20,
  },
  shiftModalBadgeText: { fontSize: 12, fontWeight: '600', color: '#2b6cb0' },
  shiftModalDivider: { height: 1, backgroundColor: '#e2e8f0', marginBottom: 16 },
  shiftModalSectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#718096',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  shiftTasksList: { marginBottom: 18, gap: 8 },
  shiftTaskRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
  },
  shiftTaskRowCompleted: {
    backgroundColor: '#f0fff4',
    borderColor: '#c6f6d5',
  },
  shiftTaskText: { flex: 1, fontSize: 14, color: '#2d3748', lineHeight: 20 },
  shiftTaskTextCompleted: { color: '#718096', textDecorationLine: 'line-through' },
  shiftTasksEmpty: {
    fontSize: 14,
    color: '#94a3b8',
    marginBottom: 18,
    fontStyle: 'italic',
  },
  shiftModalNoteLabel: { fontSize: 12, fontWeight: '600', color: '#718096', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  shiftModalNoteInput: {
    borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10,
    padding: 12, fontSize: 14, color: '#2d3748',
    minHeight: 70, textAlignVertical: 'top', marginBottom: 20,
  },
  shiftModalActions: { gap: 10, marginBottom: 12 },
  shiftActionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 14, borderRadius: 12,
  },
  shiftActionTimeOff: { backgroundColor: '#fff5eb', borderWidth: 1.5, borderColor: '#f6ad55' },
  shiftActionTimeOffText: { fontSize: 15, fontWeight: '700', color: '#c05621' },
  shiftActionTransfer: { backgroundColor: '#ebf8ff', borderWidth: 1.5, borderColor: '#63b3ed' },
  shiftActionTransferText: { fontSize: 15, fontWeight: '700', color: '#2b6cb0' },
  shiftModalCancelBtn: { alignItems: 'center', paddingVertical: 12 },
  shiftModalCancelText: { fontSize: 15, color: '#718096', fontWeight: '500' },

  // Day Roster Modal
  rosterHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  rosterIconBg: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: '#f0fff4', justifyContent: 'center', alignItems: 'center',
  },
  rosterTitle: { fontSize: 17, fontWeight: '700', color: '#2d3748' },
  rosterSubtitle: { fontSize: 13, color: '#718096', marginTop: 1 },
  rosterEmpty: { alignItems: 'center', paddingVertical: 32, gap: 10 },
  rosterEmptyText: { fontSize: 14, color: '#a0aec0' },
  rosterRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0', gap: 12,
  },
  rosterRowMe: { backgroundColor: '#f0fff4', marginHorizontal: -24, paddingHorizontal: 24, borderRadius: 0 },
  rosterAvatar: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: '#e2e8f0', justifyContent: 'center', alignItems: 'center',
  },
  rosterAvatarMe: { backgroundColor: '#4CAF50' },
  rosterAvatarText: { color: 'white', fontWeight: '700', fontSize: 16 },
  rosterNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  rosterName: { fontSize: 15, fontWeight: '600', color: '#2d3748' },
  rosterNameMe: { color: '#276749' },
  rosterPosition: { fontSize: 12, color: '#4CAF50', fontWeight: '600', marginBottom: 1 },
  rosterTime: { fontSize: 12, color: '#718096' },
  meBadge: {
    backgroundColor: '#c6f6d5', borderRadius: 20,
    paddingHorizontal: 7, paddingVertical: 2,
  },
  meBadgeText: { fontSize: 10, fontWeight: '700', color: '#276749' },
  rosterActionBtn: {
    backgroundColor: '#ebf8ff', borderWidth: 1.5, borderColor: '#63b3ed',
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6,
  },
  rosterActionText: { fontSize: 12, fontWeight: '700', color: '#2b6cb0' },

  // Transfer coworker picker
  transferEmpty: { alignItems: 'center', paddingVertical: 24, gap: 10 },
  transferEmptyText: { fontSize: 13, color: '#a0aec0', textAlign: 'center' },
  transferSearchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 10,
    backgroundColor: '#f7fafc',
    gap: 6,
  },
  transferSearchInput: {
    flex: 1,
    fontSize: 14,
    color: '#2d3748',
  },
  coworkerRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, paddingHorizontal: 12,
    borderRadius: 10, marginBottom: 6,
    borderWidth: 1.5, borderColor: '#e2e8f0', backgroundColor: '#f7fafc',
  },
  coworkerRowSelected: {
    borderColor: '#4CAF50', backgroundColor: '#f0fff4',
  },
  coworkerAvatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#4CAF50', justifyContent: 'center', alignItems: 'center',
    marginRight: 12,
  },
  coworkerAvatarImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginRight: 12,
    backgroundColor: '#e2e8f0',
  },
  coworkerAvatarText: { color: 'white', fontWeight: '700', fontSize: 15 },
  coworkerName: { flex: 1, fontSize: 15, fontWeight: '600', color: '#2d3748' },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 36,
  },
  modalKeyboardRoot: {
    flex: 1,
  },
  shiftModalCard: {
    maxHeight: '92%',
    width: '100%',
    paddingBottom: 20,
  },
  shiftModalScrollContent: {
    paddingBottom: 8,
    flexGrow: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#2d3748' },
  modalSubtitle: { fontSize: 13, color: '#718096', marginBottom: 16 },
  rangeDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f8f9fa',
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    gap: 8,
  },
  rangeBox: { flex: 1, alignItems: 'center' },
  rangeLabel: { fontSize: 11, fontWeight: '600', color: '#718096', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  rangeValue: { fontSize: 14, fontWeight: '600', color: '#a0aec0' },
  rangeValueActive: { color: '#2d3748' },
  modalMonthNav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  modalMonthTitle: { fontSize: 15, fontWeight: '700', color: '#2d3748' },
  modalDayCell: {
    width: '14.28%',
    aspectRatio: 1,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  modalDayCellRange: { backgroundColor: 'rgba(76,175,80,0.15)', borderRadius: 0 },
  modalDayCellEndpoint: { backgroundColor: '#4CAF50', borderRadius: 8 },
  modalDayCellPast: { opacity: 0.3 },
  modalDayTextRange: { color: '#2e7d32', fontWeight: '600' },
  modalDayTextPast: { color: '#a0aec0' },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
  },
  modalCancelText: { fontSize: 15, fontWeight: '600', color: '#4a5568' },
  modalSubmitBtn: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#4CAF50',
    alignItems: 'center',
  },
  modalSubmitText: { fontSize: 15, fontWeight: '700', color: 'white' },
});

export default SchedulePage;
