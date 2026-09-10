import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, ActivityIndicator, Image, TextInput, Alert, AppState } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { supabase } from '../utils/supabase';
import { useEmployee } from '../EmployeeContext';
import { ShiftMatching, shiftRowMatchesEmployee } from '../utils/shiftMatching';
import { APP_BRAND_NAME } from '../constants/branding';
import { Colors } from '../constants/theme';

const DAY_LETTERS = ['M', 'T', 'W', 'Th', 'F', 'S', 'S'];

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAYS_FULL = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

const SHORT_MONTHS_HP = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAY_ABBR = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function normEmployeeKey(v) {
  return (v || '').trim().toLowerCase();
}

function buildProfileDisplayLabel(p) {
  const firstLast = [p?.first_name, p?.last_name].filter(Boolean).join(' ').trim();
  return firstLast || (p?.display_name || '').trim() || (p?.employee_name || '').trim();
}

/** Map normalized name keys → best display label (matches Schedule / web dashboard behavior). */
function buildEmployeeDisplayLabelMap(profiles) {
  const map = new Map();
  (profiles || []).forEach((p) => {
    const label = buildProfileDisplayLabel(p);
    if (!label) return;
    const keys = [
      normEmployeeKey(p.employee_name),
      normEmployeeKey(p.display_name),
      normEmployeeKey(label),
      normEmployeeKey(p.first_name),
      normEmployeeKey(p.last_name),
    ].filter(Boolean);
    keys.forEach((k) => {
      if (!map.has(k)) map.set(k, label);
    });
  });
  return map;
}

function resolveEmployeeDisplayLabel(labelMap, raw) {
  const key = normEmployeeKey(raw);
  if (!key) return (raw || '').trim();
  return labelMap.get(key) || (raw || '').trim();
}

/** Web scheduling uses "Select Position" as dropdown placeholder; don't show that as a real role. */
function displayShiftPosition(pos) {
  const p = String(pos || '').trim();
  if (!p || /^select position$/i.test(p)) return 'Staff';
  return p;
}

const HomePage = ({
  orgId,
  currentOrgName = '',
  canSwitchOrg = false,
  onOpenOrgPicker,
  tasks,
  urgentTasks: urgentTasksProp = [],
  todayShift,
  nextShift,
  taskStats = { total: 0, completed: 0 },
  onProfilePress,
  profileData,
  onTasksPress,
  onSchedulePress,
  addUrgentTask,
  takeUrgentTask,
  onUrgentTaskPress,
}) => {
  const { employeeName, displayName, employeeId, authUserId, email, firstName, lastName, defaultEmployeeName, authLoading } = useEmployee();
  const welcomeName = (profileData?.displayName || displayName || employeeName || '').trim() || employeeName;
  const [shiftDates, setShiftDates] = useState(new Set());
  /** YYYY-MM-DD in visible week where current user has approved time off */
  const [timeOffDates, setTimeOffDates] = useState(new Set());
  const [announcements, setAnnouncements] = useState([]);
  const [recentRequests, setRecentRequests] = useState([]);
  const [newShiftNotifCount, setNewShiftNotifCount] = useState(0);

  // Day roster modal
  const [showRoster, setShowRoster] = useState(false);
  const [rosterDate, setRosterDate] = useState(null);
  const [rosterShifts, setRosterShifts] = useState([]);
  const [loadingRoster, setLoadingRoster] = useState(false);

  const [urgentInput, setUrgentInput] = useState('');
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);

  useEffect(() => {
    if (!orgId || authLoading) return;
    fetchWeekShifts();
    fetchApprovedTimeOffWeek();
    fetchAnnouncements();
    fetchRecentRequests();
    fetchNewShiftNotifCount();
  }, [
    orgId,
    authLoading,
    authUserId,
    employeeId,
    employeeName,
    displayName,
    email,
    firstName,
    lastName,
    defaultEmployeeName,
    profileData?.displayName,
    profileData?.employeeNameFromProfile,
    profileData?.firstName,
    profileData?.lastName,
  ]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && orgId) {
        fetchNewShiftNotifCount();
        fetchRecentRequests();
        fetchApprovedTimeOffWeek();
      }
    });
    return () => sub?.remove();
  }, [
    orgId,
    authLoading,
    authUserId,
    employeeId,
    employeeName,
    displayName,
    email,
    firstName,
    lastName,
    defaultEmployeeName,
    profileData?.displayName,
    profileData?.employeeNameFromProfile,
    profileData?.firstName,
    profileData?.lastName,
  ]);

  async function fetchNewShiftNotifCount() {
    if (!orgId) return;
    let query = supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('type', 'shift_assigned')
      .eq('read', false);
    if (employeeId) {
      query = query.eq('employee_id', employeeId);
    } else {
      query = query.eq('employee_name', employeeName);
    }
    const { count } = await query;
    setNewShiftNotifCount(count || 0);
  }

  async function markShiftNotifsReadAndNavigate() {
    if (!orgId) return;
    let query = supabase
      .from('notifications')
      .select('id')
      .eq('org_id', orgId)
      .eq('type', 'shift_assigned')
      .eq('read', false);
    if (employeeId) {
      query = query.eq('employee_id', employeeId);
    } else {
      query = query.eq('employee_name', employeeName);
    }
    const { data } = await query;
    if (data?.length) {
      await supabase.from('notifications').update({ read: true }).in('id', data.map(n => n.id));
      setNewShiftNotifCount(0);
    }
    onSchedulePress?.();
  }

  useEffect(() => {
    setAvatarLoadFailed(false);
  }, [profileData?.avatarUrl]);

  function buildHomeNameCandidates() {
    const combined = [firstName, lastName].filter(Boolean).join(' ').trim();
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
        ]
          .map((n) => (n || '').trim())
          .filter(Boolean)
      )
    );
  }

  function getVisibleWeekRange() {
    const today = new Date();
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const fmt = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { monday, sunday, weekStart: fmt(monday), weekEnd: fmt(sunday), fmt };
  }

  async function fetchWeekShifts() {
    const { monday, sunday, fmt } = getVisibleWeekRange();

    const [{ data }, { data: profileRows }] = await Promise.all([
      supabase
        .from('shifts')
        .select('shift_date, employee_name, employee_id')
        .eq('org_id', orgId)
        .gte('shift_date', fmt(monday))
        .lte('shift_date', fmt(sunday)),
      supabase
        .from('profiles')
        .select('id, user_id, employee_name, display_name, first_name, last_name, email')
        .eq('org_id', orgId)
        .limit(400),
    ]);

    const identity = {
      employeeId,
      authUserId,
      email,
      employeeName,
      displayName,
      defaultEmployeeName,
      firstName,
      lastName,
      profileData,
    };
    const candidates = ShiftMatching.collectNameCandidates(identity, profileRows || []);
    const knownIds = ShiftMatching.profileIdsForMember(profileRows || [], identity);
    const dates = new Set();
    (data || []).forEach((row) => {
      if (ShiftMatching.rowMatchesEmployee(row, employeeId, candidates, authUserId, knownIds)) {
        const key = ShiftMatching.dateKey(row.shift_date);
        if (key) dates.add(key);
      }
    });
    setShiftDates(dates);
  }

  async function fetchApprovedTimeOffWeek() {
    if (!orgId || authLoading) return;
    const { weekStart, weekEnd, fmt } = getVisibleWeekRange();
    const candidates = buildHomeNameCandidates();

    const { data, error } = await supabase
      .from('shift_requests')
      .select('employee_name, time_off_start_date, time_off_end_date, status')
      .eq('org_id', orgId)
      .eq('request_type', 'time_off')
      .in('status', ['approved', 'accepted']);

    if (error) {
      console.warn('[Home] fetchApprovedTimeOffWeek failed:', error.message);
      setTimeOffDates(new Set());
      return;
    }

    const dates = new Set();
    (data || []).forEach((row) => {
      if (
        !shiftRowMatchesEmployee(
          { employee_name: row.employee_name, employee_id: null },
          employeeId,
          candidates,
          authUserId
        )
      ) {
        return;
      }
      const start = row.time_off_start_date;
      const end = row.time_off_end_date || start;
      if (!start) return;
      let s = start;
      let e = end;
      if (s > e) {
        const t = s;
        s = e;
        e = t;
      }
      const clipStart = s < weekStart ? weekStart : s;
      const clipEnd = e > weekEnd ? weekEnd : e;
      if (clipStart > clipEnd) return;

      let curStr = clipStart;
      while (curStr <= clipEnd) {
        dates.add(curStr);
        const next = new Date(curStr + 'T12:00:00');
        next.setDate(next.getDate() + 1);
        curStr = fmt(next);
      }
    });
    setTimeOffDates(dates);
  }

  async function fetchAnnouncements() {
    const { data } = await supabase
      .from('announcements')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(2);
    if (data) setAnnouncements(data);
  }

  async function fetchRecentRequests() {
    if (!orgId || authLoading) return;
    const since = new Date();
    since.setDate(since.getDate() - 14);
    const sinceIso = since.toISOString();

    const candidateNames = Array.from(
      new Set(
        [
          employeeName,
          displayName,
          defaultEmployeeName,
          [firstName, lastName].filter(Boolean).join(' ').trim(),
          (email || '').split('@')[0],
          profileData?.displayName,
          profileData?.employeeNameFromProfile,
          [profileData?.firstName, profileData?.lastName].filter(Boolean).join(' ').trim(),
        ]
          .map((n) => (n || '').trim())
          .filter(Boolean)
      )
    );

    const { data, error } = await supabase
      .from('shift_requests')
      .select('id, employee_name, request_type, status, note, target_employee, shift_id, created_at, time_off_start_date, time_off_end_date')
      .eq('org_id', orgId)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(80);

    if (error) {
      console.warn('[Home] fetchRecentRequests failed:', error.message);
      setRecentRequests([]);
      return;
    }

    const mine = (data || [])
      .map((row) => {
        const isRequester = shiftRowMatchesEmployee(
          { employee_name: row.employee_name, employee_id: null },
          employeeId,
          candidateNames,
          authUserId
        );
        const isIncomingRecipient =
          !!row.target_employee &&
          shiftRowMatchesEmployee(
            { employee_name: row.target_employee, employee_id: null },
            employeeId,
            candidateNames,
            authUserId
          );
        if (!isRequester && !isIncomingRecipient) return null;
        const requestRole = isRequester ? 'outgoing' : 'incoming';
        return { ...row, requestRole };
      })
      .filter(Boolean);

    const shiftIds = [...new Set(mine.map((r) => r.shift_id).filter(Boolean))];
    let shiftMap = {};
    if (shiftIds.length > 0) {
      const { data: shiftRows } = await supabase
        .from('shifts')
        .select('id, shift_date, start_time, end_time, position')
        .in('id', shiftIds);
      (shiftRows || []).forEach((s) => {
        shiftMap[s.id] = s;
      });
    }

    const { data: profRows, error: profErr } = await supabase
      .from('profiles')
      .select('employee_name, display_name, first_name, last_name')
      .eq('org_id', orgId);
    if (profErr) {
      console.warn('[Home] fetchRecentRequests profiles:', profErr.message);
    }
    const displayLabelMap = buildEmployeeDisplayLabelMap(profRows);

    setRecentRequests(
      mine.map((r) => ({
        ...r,
        shift: r.shift_id ? shiftMap[r.shift_id] || null : null,
        _requesterDisplayName: resolveEmployeeDisplayLabel(displayLabelMap, r.employee_name),
        _targetDisplayName: r.target_employee
          ? resolveEmployeeDisplayLabel(displayLabelMap, r.target_employee)
          : null,
      }))
    );
  }

  async function deleteShiftRequest(requestId) {
    if (!requestId) return;
    const { error } = await supabase.from('shift_requests').delete().eq('id', requestId);
    if (error) {
      console.warn('[Home] deleteShiftRequest failed:', error.message);
      Alert.alert('Could not delete', error.message || 'You may not have permission to remove this request.');
      return;
    }
    setRecentRequests((prev) => prev.filter((r) => r.id !== requestId));
  }

  function confirmDeleteRequest(req) {
    if (!req?.id) return;
    Alert.alert(
      'Delete request',
      'Remove this request? Managers will no longer see it in the queue.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteShiftRequest(req.id) },
      ]
    );
  }

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

  const formatTimeHP = (t) => {
    if (!t) return '';
    const [h, m] = t.split(':');
    const hr = parseInt(h);
    return `${hr % 12 || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}`;
  };

  // ── Week strip ─────────────────────────────────────────────────────────────
  const weekDates = (() => {
    const today = new Date();
    const start = new Date(today);
    start.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    return DAY_LETTERS.map((day, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const fmt = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      return { day, date: d.getDate(), dateStr: fmt, isToday: d.toDateString() === today.toDateString() };
    });
  })();

  // ── Helpers ────────────────────────────────────────────────────────────────
  const formatTime = (t) => {
    if (!t) return '';
    const [h, m] = t.split(':');
    const hr = parseInt(h);
    return `${hr % 12 || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}`;
  };

  const formatRequestStatus = (status) => {
    const s = String(status || '').trim().toLowerCase();
    if (s === 'approved' || s === 'accepted') return 'Accepted';
    if (s === 'denied' || s === 'declined') return 'Denied';
    return 'Awaiting approval';
  };

  const getRequestStatusStyle = (status) => {
    const s = String(status || '').trim().toLowerCase();
    if (s === 'approved' || s === 'accepted') return styles.requestStatusAccepted;
    if (s === 'denied' || s === 'declined') return styles.requestStatusDenied;
    return styles.requestStatusPending;
  };

  const formatRequestDetail = (req) => {
    if (!req) return '';
    if (req.request_type === 'time_off') {
      const start = req.time_off_start_date ? formatShiftDate(req.time_off_start_date) : '';
      const end = req.time_off_end_date && req.time_off_end_date !== req.time_off_start_date
        ? formatShiftDate(req.time_off_end_date)
        : '';
      return end ? `${start} to ${end}` : start || req.note || 'Requested time off';
    }
    if (req.shift?.shift_date) {
      const time = req.shift.start_time ? ` · ${formatTime(req.shift.start_time)} – ${formatTime(req.shift.end_time)}` : '';
      return `${formatShiftDate(req.shift.shift_date)}${time}`;
    }
    return req.note || 'Shift transfer request';
  };

  const requestRowTitle = (req) => {
    if (req.request_type === 'time_off') return 'Time Off';
    if (req.requestRole === 'incoming') return 'Shift transferred to you';
    return 'Your shift transfer';
  };

  const requestRowMeta = (req) => {
    if (req.request_type === 'time_off') return null;
    if (req.requestRole === 'incoming') {
      const from = (req._requesterDisplayName || req.employee_name || '').trim();
      return from ? `From ${from}` : null;
    }
    if (req.target_employee) {
      const to = (req._targetDisplayName || req.target_employee || '').trim();
      return to ? `Transfer to ${to}` : null;
    }
    return null;
  };

  const formatShiftDate = (dateStr) => {
    const d = new Date(dateStr + 'T00:00:00');
    return `${DAYS_FULL[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}`;
  };

  // ── Derived values ─────────────────────────────────────────────────────────
  const isShiftDay = !!todayShift;
  const todayYmd = weekDates.find((w) => w.isToday)?.dateStr || '';
  const isApprovedTimeOffToday = !!(todayYmd && timeOffDates.has(todayYmd));
  /** Task progress / urgent only on scheduled shift days (tasks are hidden when off shift). */
  const showWorkMode = isShiftDay;
  const urgentTasks = showWorkMode ? (urgentTasksProp || []).filter(t => t.is_urgent && !t.completed) : [];
  const progressPct = taskStats.total > 0
    ? Math.round((taskStats.completed / taskStats.total) * 100)
    : 0;

  return (
    <>
      <View style={styles.header}>
        <View style={styles.headerBrand}>
          <Image source={require('../assets/logo.png')} style={styles.headerLogo} />
          <View>
            <Text style={styles.brandName}>{APP_BRAND_NAME}</Text>
            {canSwitchOrg && currentOrgName ? (
              <TouchableOpacity
                onPress={onOpenOrgPicker}
                activeOpacity={0.7}
                style={styles.orgSubrow}
              >
                <Text style={styles.orgSubtitle} numberOfLines={1}>
                  {currentOrgName}
                </Text>
                <Ionicons name="chevron-down" size={14} color="#64748b" style={{ marginLeft: 4 }} />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
        <TouchableOpacity style={styles.profileBtn} onPress={onProfilePress} activeOpacity={0.8}>
          {profileData?.avatarUrl && !avatarLoadFailed ? (
            <Image
              source={{ uri: profileData.avatarUrl }}
              style={styles.profileAvatar}
              onError={() => setAvatarLoadFailed(true)}
            />
          ) : (
            <View style={[styles.profileAvatar, { backgroundColor: profileData?.avatarColor || Colors.primary }]}>
              <Text style={styles.profileAvatarText}>
                {(profileData?.displayName || employeeName)
                  .split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Week Strip */}
      <View style={styles.weekContainer}>
        {weekDates.map((item, i) => {
          const hasShift = shiftDates.has(item.dateStr);
          const hasTimeOff = timeOffDates.has(item.dateStr);
          return (
            <TouchableOpacity
              key={i}
              style={styles.dayContainer}
              onPress={() => openDayRoster(item.dateStr)}
              activeOpacity={0.7}
            >
              <Text style={styles.dayText}>{item.day}</Text>
              <View
                style={[
                  styles.dateCircle,
                  hasShift && styles.dateCircleShift,
                  hasTimeOff && !hasShift && styles.dateCircleTimeOff,
                  item.isToday && !hasShift && !hasTimeOff && styles.dateCircleToday,
                ]}
              >
                <Text
                  style={[
                    styles.dateNum,
                    hasShift && styles.dateNumActive,
                    hasTimeOff && !hasShift && styles.dateNumActive,
                    item.isToday && !hasShift && !hasTimeOff && styles.dateNumActive,
                  ]}
                >
                  {item.date}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.welcomeText}>Welcome</Text>
        <Text style={styles.nameText}>{welcomeName}</Text>

        {/* New shifts assigned notification */}
        {newShiftNotifCount > 0 && (
          <TouchableOpacity
            style={styles.newShiftBanner}
            onPress={markShiftNotifsReadAndNavigate}
            activeOpacity={0.85}
          >
            <View style={styles.newShiftBannerContent}>
              <Ionicons name="calendar" size={22} color="#fff" style={styles.newShiftBannerIcon} />
              <View style={{ flex: 1 }}>
                <Text style={styles.newShiftBannerTitle}>Hey, you were assigned new shifts!</Text>
                <Text style={styles.newShiftBannerSub}>Tap to view your schedule</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.9)" />
            </View>
          </TouchableOpacity>
        )}

        {/* Shift Card */}
        {isShiftDay ? (
          <View style={styles.shiftCard}>
            <View style={styles.shiftCardLeft}>
              <View style={styles.shiftIconBg}>
                <Ionicons name="time" size={20} color={Colors.success} />
              </View>
              <View style={{ marginLeft: 12 }}>
                <Text style={styles.shiftCardLabel}>Today's Shift</Text>
                <Text style={styles.shiftCardTime}>
                  {formatTime(todayShift.start_time)} – {formatTime(todayShift.end_time)}
                </Text>
              </View>
            </View>
            <View style={styles.shiftBadge}>
              <Text style={styles.shiftBadgeText}>{displayShiftPosition(todayShift.position)}</Text>
            </View>
          </View>
        ) : nextShift ? (
          <View style={[styles.shiftCard, styles.shiftCardNext]}>
            <View style={styles.shiftCardLeft}>
              <View style={[styles.shiftIconBg, { backgroundColor: '#ebf8ff' }]}>
                <Ionicons name="calendar-outline" size={20} color="#3182ce" />
              </View>
              <View style={{ marginLeft: 12 }}>
                <Text style={[styles.shiftCardLabel, { color: '#3182ce' }]}>Next Shift</Text>
                <Text style={styles.shiftCardTime}>
                  {formatShiftDate(nextShift.shift_date)}
                </Text>
                <Text style={styles.shiftCardSubtime}>
                  {formatTime(nextShift.start_time)} – {formatTime(nextShift.end_time)}
                </Text>
              </View>
            </View>
            <View style={[styles.shiftBadge, { backgroundColor: '#ebf8ff' }]}>
              <Text style={[styles.shiftBadgeText, { color: '#2b6cb0' }]}>
                {displayShiftPosition(nextShift.position)}
              </Text>
            </View>
          </View>
        ) : (
          <View style={[styles.shiftCard, styles.shiftCardNone]}>
            <View style={styles.shiftCardLeft}>
              <View style={[styles.shiftIconBg, { backgroundColor: '#f7fafc' }]}>
                <Ionicons name="moon-outline" size={20} color="#a0aec0" />
              </View>
              <View style={{ marginLeft: 12 }}>
                <Text style={[styles.shiftCardLabel, { color: '#a0aec0' }]}>No Upcoming Shifts</Text>
                <Text style={[styles.shiftCardTime, { color: '#cbd5e0', fontSize: 13 }]}>
                  Check back later
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Task Progress — shift day or any assigned tasks */}
        {showWorkMode && (
          <TouchableOpacity
            style={styles.progressCard}
            onPress={onTasksPress}
            activeOpacity={0.8}
          >
            <View style={styles.progressHeader}>
              <Text style={styles.progressTitle}>Task Progress</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={styles.progressCount}>
                  {taskStats.completed} / {taskStats.total} done
                </Text>
                <Ionicons name="chevron-forward" size={14} color="#a0aec0" />
              </View>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: progressPct + '%' }]} />
            </View>
            <Text style={styles.progressPct}>
              {progressPct === 100 ? 'All tasks complete! 🎉' : progressPct + '% complete'}
            </Text>
          </TouchableOpacity>
        )}

        {/* Announcements */}
        {announcements.length > 0 && (
          <View style={styles.announcementsCard}>
            <View style={styles.announcementsHeader}>
              <Ionicons name="megaphone-outline" size={16} color="#744210" />
              <Text style={styles.announcementsTitle}>Announcements</Text>
            </View>
            {announcements.map((a, i) => (
              <View key={a.id} style={[styles.announcementRow, i > 0 && styles.announcementRowBorder]}>
                <Text style={styles.announcementText}>{a.message}</Text>
                <Text style={styles.announcementMeta}>
                  {a.created_by || 'Manager'} · {(() => {
                    const diff = Math.floor((Date.now() - new Date(a.created_at).getTime()) / 1000);
                    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
                    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
                    return `${Math.floor(diff / 86400)}d ago`;
                  })()}
                </Text>
              </View>
            ))}
          </View>
        )}

        <View style={styles.requestsCard}>
          <View style={styles.requestsHeader}>
            <Ionicons name="time-outline" size={16} color="#2b6cb0" />
            <Text style={styles.requestsTitle}>Your Requests</Text>
          </View>
          {recentRequests.length > 0 ? (
            <Text style={styles.requestsHint}>Hold a request to delete it</Text>
          ) : null}
          {recentRequests.length === 0 ? (
            <Text style={styles.requestsEmpty}>You have no pending requests</Text>
          ) : (
            recentRequests.map((req, i) => {
              const meta = requestRowMeta(req);
              return (
                <TouchableOpacity
                  key={req.id || `${req.created_at}-${i}`}
                  style={styles.requestRowOutline}
                  activeOpacity={0.92}
                  delayLongPress={450}
                  onLongPress={() => confirmDeleteRequest(req)}
                  accessibilityLabel={`${requestRowTitle(req)}, ${formatRequestStatus(req.status)}. Long press to delete.`}
                >
                  <View style={styles.requestRow}>
                    <View style={styles.requestRowTop}>
                      <Text style={styles.requestType}>
                        {requestRowTitle(req)}
                      </Text>
                      <View style={[styles.requestStatusPill, getRequestStatusStyle(req.status)]}>
                        <Text style={styles.requestStatusText}>{formatRequestStatus(req.status)}</Text>
                      </View>
                    </View>
                    <Text style={styles.requestDetail}>{formatRequestDetail(req)}</Text>
                    {meta ? (
                      <Text style={styles.requestMeta}>{meta}</Text>
                    ) : null}
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </View>

        {/* ── Urgent Tasks / Off Day ─────────────────────────────────────── */}
        {showWorkMode ? (
          <View style={styles.urgentCard}>
            <Text style={styles.urgentTitle}>Urgent Tasks</Text>
            {urgentTasks.length === 0 ? (
              <Text style={styles.noUrgentText}>No urgent tasks right now 🎉</Text>
            ) : (
              urgentTasks.map(task => {
                const claimed = !!task.employee_name;
                const isMe = (task.employee_name || '').toLowerCase() === employeeName.toLowerCase();
                return (
                  <TouchableOpacity
                    key={task.id}
                    style={[styles.urgentRow, styles.urgentRowButton, claimed && styles.urgentRowClaimed]}
                    onPress={() => {
                      if (claimed) {
                        onUrgentTaskPress?.(task.id);
                      } else {
                        Alert.alert(
                          'Move to your list?',
                          'Do you want to move this task to your list of tasks?',
                          [
                            { text: 'No', style: 'cancel' },
                            { text: 'Yes', onPress: () => takeUrgentTask?.(task.id) },
                          ]
                        );
                      }
                    }}
                    activeOpacity={0.8}
                  >
                    {claimed && (
                      <View style={styles.urgentClaimedBadge}>
                        <Ionicons name="checkmark-circle" size={22} color={isMe ? Colors.success : '#b45309'} />
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.urgentText, claimed && styles.urgentTextClaimed]}>{task.text}</Text>
                      {claimed && (
                        <Text style={styles.urgentClaimedBy}>
                          {isMe ? 'You are working on it' : `${task.employee_name} is working on it`}
                        </Text>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </View>
        ) : isApprovedTimeOffToday ? (
          <View style={styles.offDayCard}>
            <Text style={styles.offDayEmoji}>☀️</Text>
            <Text style={styles.offDayTitle}>You're off today</Text>
            <Text style={styles.offDaySub}>Approved time off — enjoy your day!</Text>
          </View>
        ) : (
          <View style={styles.offDayCard}>
            <Text style={styles.offDayEmoji}>📅</Text>
            <Text style={styles.offDayTitle}>No shift today</Text>
            <Text style={styles.offDaySub}>You're not scheduled for a shift. Open Schedule to see the full calendar.</Text>
          </View>
        )}

        {/* Add urgent task from home — when on shift or you have tasks */}
        {addUrgentTask && showWorkMode && (
          <View style={styles.urgentAddRow}>
            <View style={styles.urgentAddIcon}>
              <Ionicons name="flame" size={18} color="#e53e3e" />
            </View>
            <TextInput
              style={styles.urgentAddInput}
              placeholder="Add an urgent task…"
              placeholderTextColor="#a0aec0"
              value={urgentInput}
              onChangeText={setUrgentInput}
              onSubmitEditing={() => {
                if (urgentInput.trim()) { addUrgentTask(urgentInput); setUrgentInput(''); }
              }}
              returnKeyType="done"
            />
            <TouchableOpacity
              style={[styles.urgentAddBtn, !urgentInput.trim() && styles.urgentAddBtnDisabled]}
              onPress={() => {
                if (urgentInput.trim()) { addUrgentTask(urgentInput); setUrgentInput(''); }
              }}
              disabled={!urgentInput.trim()}
            >
              <Text style={styles.urgentAddBtnText}>Add</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={{ height: 24 }} />
      </ScrollView>

      {/* Day Roster Modal */}
      <Modal
        visible={showRoster}
        transparent
        animationType="slide"
        onRequestClose={() => setShowRoster(false)}
      >
        <TouchableOpacity
          style={styles.rosterOverlay}
          activeOpacity={1}
          onPress={() => setShowRoster(false)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.rosterCard}>
            <View style={styles.rosterHandle} />

            <View style={styles.rosterHeaderRow}>
              <View style={styles.rosterIconBg}>
                <Ionicons name="people" size={20} color={Colors.primary} />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.rosterTitle}>Who's Working</Text>
                {rosterDate && (
                  <Text style={styles.rosterSubtitle}>
                    {(() => {
                      const d = new Date(rosterDate + 'T00:00:00');
                      return `${DAY_ABBR[d.getDay()]}, ${SHORT_MONTHS_HP[d.getMonth()]} ${d.getDate()}`;
                    })()}
                  </Text>
                )}
              </View>
              <TouchableOpacity onPress={() => setShowRoster(false)}>
                <Ionicons name="close" size={22} color="#a0aec0" />
              </TouchableOpacity>
            </View>

            <View style={styles.rosterDivider} />

            {loadingRoster ? (
              <ActivityIndicator color={Colors.primary} style={{ paddingVertical: 30 }} />
            ) : rosterShifts.length === 0 ? (
              <View style={styles.rosterEmpty}>
                <Ionicons name="calendar-outline" size={36} color="#cbd5e0" />
                <Text style={styles.rosterEmptyText}>No shifts scheduled this day</Text>
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 320 }}>
                {rosterShifts.map((s, i) => {
                  const isMe = (s.employee_name || '').toLowerCase() === employeeName.toLowerCase();
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
                          {isMe && (
                            <View style={styles.meBadge}>
                              <Text style={styles.meBadgeText}>Me</Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.rosterPosition}>{s.position || '—'}</Text>
                        <Text style={styles.rosterTime}>
                          {formatTimeHP(s.start_time)} – {formatTimeHP(s.end_time)}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 50,
    paddingBottom: 15,
  },
  headerLeft: { flex: 1 },
  headerBrand: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  headerLogo: { width: 32, height: 32, borderRadius: 8, marginRight: 8 },
  brandName: { fontSize: 18, fontWeight: '800', color: Colors.text, letterSpacing: 0.3 },
  orgSubrow: { flexDirection: 'row', alignItems: 'center', marginTop: 2, maxWidth: '92%' },
  orgSubtitle: { fontSize: 13, fontWeight: '600', color: '#64748b' },
  profileBtn: { padding: 2 },
  profileAvatar: {
    width: 36, height: 36, borderRadius: 18,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15, shadowRadius: 4, elevation: 3,
  },
  profileAvatarText: { color: 'white', fontWeight: '800', fontSize: 14 },
  notificationIcon: { padding: 8 },

  // Week strip
  weekContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 20,
    paddingVertical: 15,
    backgroundColor: Colors.surface,
    marginHorizontal: 15,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  dayContainer: { alignItems: 'center' },
  dayText: { fontSize: 13, fontWeight: '600', color: '#4a5568', marginBottom: 8 },
  dateCircle: {
    width: 32, height: 32, borderRadius: 16,
    justifyContent: 'center', alignItems: 'center',
  },
  dateCircleShift: { backgroundColor: Colors.primary },
  dateCircleTimeOff: { backgroundColor: Colors.error },
  dateCircleToday: { backgroundColor: '#2d3748' },
  dateNum: { fontSize: 15, fontWeight: '600', color: '#2d3748' },
  dateNumActive: { color: 'white' },

  content: { flex: 1, paddingHorizontal: 20, paddingTop: 24 },
  welcomeText: { fontSize: 28, fontWeight: 'bold', color: '#2d3748', textAlign: 'center', marginBottom: 2 },
  nameText: { fontSize: 28, fontWeight: 'bold', color: '#2d3748', textAlign: 'center', marginBottom: 20 },

  newShiftBanner: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 3,
  },
  newShiftBannerContent: { flexDirection: 'row', alignItems: 'center' },
  newShiftBannerIcon: { marginRight: 12 },
  newShiftBannerTitle: { fontSize: 16, fontWeight: '700', color: '#fff' },
  newShiftBannerSub: { fontSize: 13, color: 'rgba(255,255,255,0.9)', marginTop: 2 },

  // Shift card
  shiftCard: {
    backgroundColor: Colors.successSoft,
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1.5,
    borderColor: Colors.success,
  },
  shiftCardNext: { backgroundColor: '#ebf8ff', borderColor: '#90cdf4' },
  shiftCardNone: { backgroundColor: '#f7fafc', borderColor: '#e2e8f0' },
  shiftCardLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  shiftIconBg: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: Colors.successSoft, justifyContent: 'center', alignItems: 'center',
  },
  shiftCardLabel: { fontSize: 11, fontWeight: '700', color: Colors.success, textTransform: 'uppercase', letterSpacing: 0.5 },
  shiftCardTime: { fontSize: 17, fontWeight: '700', color: '#2d3748', marginTop: 2 },
  shiftCardSubtime: { fontSize: 13, color: '#718096', marginTop: 1 },
  shiftBadge: {
    backgroundColor: Colors.successSoft,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20,
  },
  shiftBadgeText: { fontSize: 12, fontWeight: '700', color: Colors.success },

  // Progress bar
  progressCard: {
    backgroundColor: 'white',
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  progressTitle: { fontSize: 15, fontWeight: '700', color: '#2d3748' },
  progressCount: { fontSize: 13, fontWeight: '600', color: '#718096' },
  progressTrack: {
    height: 8, backgroundColor: '#e2e8f0', borderRadius: 4, overflow: 'hidden',
  },
  progressFill: {
    height: 8, backgroundColor: Colors.success, borderRadius: 4,
  },
  progressPct: { fontSize: 12, color: '#718096', marginTop: 8, textAlign: 'right' },

  // Announcements
  announcementsCard: {
    backgroundColor: '#fffbeb',
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1.5,
    borderColor: '#f6e05e',
  },
  announcementsHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  announcementsTitle: { fontSize: 13, fontWeight: '700', color: '#744210', textTransform: 'uppercase', letterSpacing: 0.5 },
  announcementRow: { paddingVertical: 8 },
  announcementRowBorder: { borderTopWidth: 1, borderTopColor: '#fef08a' },
  announcementText: { fontSize: 14, color: '#78350f', fontWeight: '500', lineHeight: 20 },
  announcementMeta: { fontSize: 11, color: '#b7791f', marginTop: 3 },

  requestsCard: {
    backgroundColor: '#eff6ff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1.5,
    borderColor: '#bfdbfe',
  },
  requestsHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  requestsTitle: { fontSize: 13, fontWeight: '700', color: '#1e3a8a', textTransform: 'uppercase', letterSpacing: 0.5 },
  requestsHint: { fontSize: 12, color: '#64748b', marginBottom: 10 },
  requestsEmpty: { fontSize: 14, color: '#475569', fontStyle: 'italic' },
  requestRowOutline: {
    borderWidth: 1.5,
    borderColor: '#2563eb',
    borderRadius: 12,
    backgroundColor: '#ffffff',
    marginBottom: 10,
    overflow: 'hidden',
  },
  requestRow: { paddingVertical: 10, paddingHorizontal: 12 },
  requestRowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  requestType: { fontSize: 14, fontWeight: '700', color: '#1e40af' },
  requestDetail: { fontSize: 13, color: '#334155', marginTop: 6, lineHeight: 18 },
  requestMeta: { fontSize: 12, color: '#64748b', marginTop: 4 },
  requestStatusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  requestStatusPending: { backgroundColor: '#fef3c7' },
  requestStatusAccepted: { backgroundColor: '#dcfce7' },
  requestStatusDenied: { backgroundColor: '#fee2e2' },
  requestStatusText: { fontSize: 11, fontWeight: '700', color: '#1f2937' },

  // Urgent tasks
  urgentCard: {
    backgroundColor: Colors.error,
    borderRadius: 14,
    padding: 18,
    marginBottom: 14,
  },
  urgentTitle: { fontSize: 16, fontWeight: 'bold', color: 'white', marginBottom: 12 },
  noUrgentText: { fontSize: 14, color: 'rgba(255,255,255,0.85)', fontStyle: 'italic' },
  urgentRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6, paddingVertical: 10, paddingHorizontal: 4 },
  urgentRowClaimed: { backgroundColor: '#fef3c7', marginHorizontal: -4, marginVertical: -4, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 10, marginBottom: 2 },
  urgentRowButton: { borderRadius: 10, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.4)' },
  urgentClaimedBadge: { marginRight: 10, justifyContent: 'center' },
  urgentText: { fontSize: 15, color: 'white', flex: 1 },
  urgentTextClaimed: { color: '#92400e', fontWeight: '600' },
  urgentClaimedBy: { fontSize: 12, color: '#b45309', marginTop: 2, fontStyle: 'italic' },

  urgentAddRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'white',
    borderRadius: 14,
    marginBottom: 14,
    gap: 10,
    borderWidth: 1.5,
    borderColor: '#fed7d7',
  },
  urgentAddIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#fff5f5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  urgentAddInput: {
    flex: 1,
    height: 40,
    backgroundColor: '#fff5f5',
    borderRadius: 20,
    paddingHorizontal: 16,
    fontSize: 15,
    color: '#2d3748',
    borderWidth: 1,
    borderColor: '#fed7d7',
  },
  urgentAddBtn: {
    backgroundColor: Colors.error,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 9,
  },
  urgentAddBtnDisabled: {
    backgroundColor: '#fc8181',
    opacity: 0.5,
  },
  urgentAddBtnText: {
    color: 'white',
    fontWeight: '700',
    fontSize: 14,
  },

  // Off day
  offDayCard: {
    backgroundColor: 'white',
    borderRadius: 14,
    padding: 24,
    marginBottom: 14,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  offDayEmoji: { fontSize: 36, marginBottom: 10 },
  offDayTitle: { fontSize: 18, fontWeight: '700', color: '#2d3748', marginBottom: 6 },
  offDaySub: { fontSize: 14, color: '#718096', textAlign: 'center' },

  // Day roster modal
  rosterOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  rosterCard: {
    backgroundColor: 'white', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 24, paddingBottom: 34, paddingTop: 12,
    maxHeight: '75%',
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1, shadowRadius: 12, elevation: 20,
  },
  rosterHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: '#e2e8f0', alignSelf: 'center', marginBottom: 20,
  },
  rosterHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  rosterIconBg: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: Colors.primarySoft, justifyContent: 'center', alignItems: 'center',
  },
  rosterTitle: { fontSize: 17, fontWeight: '700', color: '#2d3748' },
  rosterSubtitle: { fontSize: 13, color: '#718096', marginTop: 1 },
  rosterDivider: { height: 1, backgroundColor: '#e2e8f0', marginBottom: 12 },
  rosterEmpty: { alignItems: 'center', paddingVertical: 32, gap: 10 },
  rosterEmptyText: { fontSize: 14, color: '#a0aec0' },
  rosterRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0', gap: 12,
  },
  rosterRowMe: { backgroundColor: Colors.primarySoft, marginHorizontal: -24, paddingHorizontal: 24 },
  rosterAvatar: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: '#e2e8f0', justifyContent: 'center', alignItems: 'center',
  },
  rosterAvatarMe: { backgroundColor: Colors.primary },
  rosterAvatarText: { color: 'white', fontWeight: '700', fontSize: 16 },
  rosterNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  rosterName: { fontSize: 15, fontWeight: '600', color: '#2d3748' },
  rosterNameMe: { color: Colors.success },
  rosterPosition: { fontSize: 12, color: Colors.primary, fontWeight: '600', marginBottom: 1 },
  rosterTime: { fontSize: 12, color: '#718096' },
  meBadge: {
    backgroundColor: Colors.successSoft, borderRadius: 20,
    paddingHorizontal: 7, paddingVertical: 2,
  },
  meBadgeText: { fontSize: 10, fontWeight: '700', color: Colors.success },
});

export default HomePage;
