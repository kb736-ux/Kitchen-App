import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Modal, TextInput, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase, ORG_ID } from '../utils/supabase';
import { useEmployee } from '../EmployeeContext';

const DAY_HEADERS = ['M', 'T', 'W', 'Th', 'F', 'S', 'S'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const SchedulePage = ({ onOpenShiftsPress, orgId }) => {
  const { employeeName } = useEmployee();
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

  const getCurrentDate = () => {
    const today = new Date();
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${days[today.getDay()]} ${months[today.getMonth()]}/${today.getDate()}`;
  };

  useEffect(() => {
    if (orgId) {
      fetchShifts();
      fetchNotifications();
    } else {
      setLoading(false);
    }
  }, [orgId]);

  async function fetchNotifications() {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('org_id', ORG_ID)
      .eq('employee_name', employeeName)
      .order('created_at', { ascending: false })
      .limit(30);
    if (!error) setNotifications(data || []);
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

    // Fetch 90 days back and 60 days forward so past shifts are visible
    const now = new Date();
    const past = new Date(now);
    past.setDate(past.getDate() - 90);
    const future = new Date(now);
    future.setDate(future.getDate() + 60);
    const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const { data, error } = await supabase
      .from('shifts')
      .select('*')
      .eq('org_id', orgId)
      .gte('shift_date', fmt(past))
      .lte('shift_date', fmt(future))
      .order('shift_date', { ascending: true });

    if (error) {
      console.warn('[Supabase] fetchShifts failed:', error.message);
    } else {
      setShifts(data || []);
    }
    if (isRefresh) setRefreshing(false);
    else setLoading(false);
  }

  const onRefresh = () => { fetchShifts(true); fetchNotifications(); };

  const shiftDateSet = new Set(shifts.map(s => s.shift_date));

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

  const toDateStr = (d) => d.toISOString().split('T')[0];
  const todayStr = toDateStr(new Date());

  const navigateMonth = (dir) => {
    const next = new Date(currentMonth);
    next.setMonth(currentMonth.getMonth() + dir);
    setCurrentMonth(next);
  };

  const calendarDays = getCalendarDays();
  const scheduleShifts = shifts.filter(s => s.shift_date >= todayStr);

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
      const { error } = await supabase.from('shift_requests').insert({
        org_id: ORG_ID,
        shift_id: null,
        employee_name: employeeName,
        request_type: 'time_off',
        note,
        target_employee: null,
        status: 'pending',
      });
      if (error) throw error;
      await supabase.from('notifications').insert({
        org_id: ORG_ID,
        employee_name: 'Manager',
        type: 'shift_request',
        title: 'New Time Off Request',
        body: `${employeeName} requested time off from ${from} to ${to}`,
        read: false,
      });
      Alert.alert('Request Submitted', `Time off requested from ${from} to ${to}. Your manager will be notified.`);
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
    setShiftNote('');
    setShowTransferPicker(false);
    setSelectedTransferTarget(null);
    setTransferCoworkers([]);
  };

  const openDayRoster = async (dateStr) => {
    setRosterDate(dateStr);
    setRosterShifts([]);
    setShowRoster(true);
    setLoadingRoster(true);
    try {
      const { data, error } = await supabase
        .from('shifts')
        .select('employee_name, position, start_time, end_time')
        .eq('org_id', ORG_ID)
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
      // Find who is already scheduled on that date
      const { data: dayShifts } = await supabase
        .from('shifts')
        .select('employee_name')
        .eq('org_id', ORG_ID)
        .eq('shift_date', shift.shift_date);

      const scheduledOnDay = new Set(
        (dayShifts || []).map(s => (s.employee_name || '').toLowerCase())
      );

      // Find all employees who have ever been scheduled with this position
      const { data: positionShifts } = await supabase
        .from('shifts')
        .select('employee_name')
        .eq('org_id', ORG_ID)
        .eq('position', shift.position);

      const allWithPosition = [
        ...new Set(
          (positionShifts || [])
            .map(s => s.employee_name)
            .filter(name => name && name.toLowerCase() !== employeeName.toLowerCase())
        ),
      ];

      // Keep only those NOT already scheduled that day
      const available = allWithPosition.filter(
        name => !scheduledOnDay.has(name.toLowerCase())
      );
      setTransferCoworkers(available);
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
      const { error } = await supabase.from('shift_requests').insert({
        org_id: ORG_ID,
        shift_id: selectedShift.id,
        employee_name: employeeName,
        request_type: type,
        note: shiftNote.trim() || null,
        target_employee: targetEmployee,
        status: 'pending',
      });
      if (error) throw error;
      const label = type === 'time_off' ? 'Time Off' : targetEmployee ? `Transfer to ${targetEmployee}` : 'Transfer';
      const notePart = shiftNote.trim() ? ` — Note: ${shiftNote.trim()}` : '';
      await supabase.from('notifications').insert({
        org_id: ORG_ID,
        employee_name: 'Manager',
        type: 'shift_request',
        title: 'New Shift Request',
        body: `${employeeName} requested ${label} for ${formatDate(selectedShift.shift_date)}${notePart}`,
        read: false,
        shift_id: selectedShift.id,
      });
      closeShiftModal();
      Alert.alert(
        'Request Submitted',
        `Your ${label} request for ${formatDate(selectedShift.shift_date)} has been sent to your manager.`
      );
    } catch (e) {
      const msg = e?.message || 'Unknown error';
      Alert.alert('Error', `Could not submit request: ${msg}`);
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
        <View style={styles.headerLeft} />
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#4CAF50" />
        }
      >
        <Text style={styles.dateText}>{getCurrentDate()}</Text>

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

          <View style={styles.calendarLegend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#4CAF50' }]} />
              <Text style={styles.legendText}>Work day</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#2d3748' }]} />
              <Text style={styles.legendText}>Today</Text>
            </View>
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

        {loading ? (
          <ActivityIndicator size="small" color="#4CAF50" style={{ marginTop: 20 }} />
        ) : scheduleShifts.length === 0 ? (
          <Text style={styles.emptyText}>No shifts scheduled from today onwards.</Text>
        ) : (
          <View style={styles.scheduleList}>
            {scheduleShifts.map((shift) => (
              <TouchableOpacity
                key={shift.id}
                style={styles.staffItem}
                onPress={() => openShiftModal(shift)}
                activeOpacity={0.7}
              >
                <View>
                  <Text style={styles.staffName}>{formatDate(shift.shift_date)}</Text>
                  <Text style={styles.shiftTime}>
                    {formatTime(shift.start_time)} – {formatTime(shift.end_time)}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.staffPosition}>{shift.position || '—'}</Text>
                  {shift.employee_name ? (
                    <Text style={styles.employeeTag}>{shift.employee_name}</Text>
                  ) : null}
                  <Ionicons name="chevron-forward" size={14} color="#a0aec0" style={{ marginTop: 4 }} />
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Bottom Buttons */}
        <View style={styles.bottomButtons}>
          <TouchableOpacity style={styles.bottomButton} onPress={onOpenShiftsPress}>
            <Ionicons name="calendar-outline" size={18} color="#4a5568" style={styles.btnIcon} />
            <Text style={styles.bottomButtonText}>Open Shifts</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.bottomButton, styles.requestButton]}
            onPress={() => { setModalMonth(new Date()); setShowTimeOffModal(true); }}
          >
            <Ionicons name="time-outline" size={18} color="#4CAF50" style={styles.btnIcon} />
            <Text style={[styles.bottomButtonText, styles.requestButtonText]}>Request Time Off</Text>
          </TouchableOpacity>
        </View>
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
                  const myShiftOnDay = isMe ? shifts.find(sh => sh.shift_date === rosterDate) : null;
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
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={closeShiftModal}>
          <TouchableOpacity activeOpacity={1} style={styles.modalCard}>
            {/* Handle bar */}
            <View style={styles.shiftModalHandle} />

            {/* Shift summary */}
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
                  /* Transfer coworker picker */
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
                          .filter(name =>
                            name.toLowerCase().includes(transferSearch.trim().toLowerCase())
                          )
                          .map(name => (
                        <TouchableOpacity
                          key={name}
                          style={[
                            styles.coworkerRow,
                            selectedTransferTarget === name && styles.coworkerRowSelected,
                          ]}
                          onPress={() => setSelectedTransferTarget(name)}
                          activeOpacity={0.7}
                        >
                          <View style={styles.coworkerAvatar}>
                            <Text style={styles.coworkerAvatarText}>
                              {name.charAt(0).toUpperCase()}
                            </Text>
                          </View>
                          <Text style={styles.coworkerName}>{name}</Text>
                          {selectedTransferTarget === name && (
                            <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
                          )}
                        </TouchableOpacity>
                      ))}
                      </>
                    )}

                    {selectedTransferTarget && (
                      <TouchableOpacity
                        style={[styles.shiftActionBtn, styles.shiftActionTransfer, { marginTop: 12 }]}
                        onPress={() => handleShiftRequest('transfer', selectedTransferTarget)}
                        disabled={submitting}
                      >
                        <Ionicons name="swap-horizontal-outline" size={18} color="#2b6cb0" style={{ marginRight: 6 }} />
                        <Text style={styles.shiftActionTransferText}>
                          {submitting ? 'Sending…' : `Send to ${selectedTransferTarget}`}
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
          </TouchableOpacity>
        </TouchableOpacity>
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
  },
  headerLeft: { flex: 1 },
  notificationIcon: { padding: 8 },
  content: { flex: 1, paddingHorizontal: 20, paddingTop: 20 },
  dateText: { fontSize: 24, fontWeight: 'bold', color: '#2d3748', marginBottom: 16 },

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
  calendarLegend: { flexDirection: 'row', marginTop: 12, gap: 16 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 12, color: '#718096' },
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
  coworkerAvatarText: { color: 'white', fontWeight: '700', fontSize: 15 },
  coworkerName: { flex: 1, fontSize: 15, fontWeight: '600', color: '#2d3748' },

  // Bottom buttons
  bottomButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 20,
    gap: 12,
  },
  bottomButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'white',
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  requestButton: {
    borderColor: '#4CAF50',
    backgroundColor: '#f0fff4',
  },
  btnIcon: { marginRight: 6 },
  bottomButtonText: { fontSize: 14, fontWeight: '600', color: '#2d3748' },
  requestButtonText: { color: '#2e7d32' },

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
