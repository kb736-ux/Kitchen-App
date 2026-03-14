import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, ActivityIndicator, Image, TextInput, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { supabase } from '../utils/supabase';
import { useEmployee } from '../EmployeeContext';

const DAY_LETTERS = ['M', 'T', 'W', 'Th', 'F', 'S', 'S'];

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAYS_FULL = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

const SHORT_MONTHS_HP = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAY_ABBR = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

const HomePage = ({ orgId, restaurantName: restaurantNameProp, tasks, todayShift, nextShift, taskStats = { total: 0, completed: 0 }, onProfilePress, profileData, onTasksPress, addUrgentTask, takeUrgentTask, onUrgentTaskPress }) => {
  const { employeeName, displayName } = useEmployee();
  const restaurantName = (restaurantNameProp || '').trim() || 'My Kitchen';
  const welcomeName = (profileData?.displayName || displayName || employeeName || '').trim() || employeeName;
  const [shiftDates, setShiftDates] = useState(new Set());
  const [announcements, setAnnouncements] = useState([]);

  // Day roster modal
  const [showRoster, setShowRoster] = useState(false);
  const [rosterDate, setRosterDate] = useState(null);
  const [rosterShifts, setRosterShifts] = useState([]);
  const [loadingRoster, setLoadingRoster] = useState(false);

  const [urgentInput, setUrgentInput] = useState('');

  useEffect(() => {
    if (!orgId) return;
    fetchWeekShifts();
    fetchAnnouncements();
  }, [orgId]);

  async function fetchWeekShifts() {
    const today = new Date();
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

    const { data } = await supabase
      .from('shifts')
      .select('shift_date')
      .eq('org_id', orgId)
      .gte('shift_date', fmt(monday))
      .lte('shift_date', fmt(sunday));

    if (data) setShiftDates(new Set(data.map(s => s.shift_date)));
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

  const formatShiftDate = (dateStr) => {
    const d = new Date(dateStr + 'T00:00:00');
    return `${DAYS_FULL[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}`;
  };

  // ── Derived values ─────────────────────────────────────────────────────────
  const isShiftDay = !!todayShift;
  const urgentTasks = isShiftDay ? (tasks || []).filter(t => t.is_urgent && !t.completed) : [];
  const progressPct = taskStats.total > 0
    ? Math.round((taskStats.completed / taskStats.total) * 100)
    : 0;

  return (
    <>
      <View style={styles.header}>
        <View style={styles.headerBrand}>
          <Ionicons name="restaurant" size={18} color="#4CAF50" style={{ marginRight: 6 }} />
          <Text style={styles.brandName}>{restaurantName}</Text>
        </View>
        <TouchableOpacity style={styles.profileBtn} onPress={onProfilePress} activeOpacity={0.8}>
          {profileData?.avatarUrl ? (
            <Image source={{ uri: profileData.avatarUrl }} style={styles.profileAvatar} />
          ) : (
            <View style={[styles.profileAvatar, { backgroundColor: profileData?.avatarColor || '#4CAF50' }]}>
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
          return (
            <TouchableOpacity
              key={i}
              style={styles.dayContainer}
              onPress={() => openDayRoster(item.dateStr)}
              activeOpacity={0.7}
            >
              <Text style={styles.dayText}>{item.day}</Text>
              <View style={[
                styles.dateCircle,
                hasShift && styles.dateCircleShift,
                item.isToday && styles.dateCircleToday,
              ]}>
                <Text style={[styles.dateNum, (hasShift || item.isToday) && styles.dateNumActive]}>
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

        {/* Shift Card */}
        {isShiftDay ? (
          <View style={styles.shiftCard}>
            <View style={styles.shiftCardLeft}>
              <View style={styles.shiftIconBg}>
                <Ionicons name="time" size={20} color="#4CAF50" />
              </View>
              <View style={{ marginLeft: 12 }}>
                <Text style={styles.shiftCardLabel}>Today's Shift</Text>
                <Text style={styles.shiftCardTime}>
                  {formatTime(todayShift.start_time)} – {formatTime(todayShift.end_time)}
                </Text>
              </View>
            </View>
            <View style={styles.shiftBadge}>
              <Text style={styles.shiftBadgeText}>{todayShift.position || 'Staff'}</Text>
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
                {nextShift.position || 'Staff'}
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

        {/* Task Progress Bar — only on shift days */}
        {isShiftDay && (
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

        {/* ── Urgent Tasks / Off Day ─────────────────────────────────────── */}
        {isShiftDay ? (
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
                        <Ionicons name="checkmark-circle" size={22} color={isMe ? '#4CAF50' : '#b45309'} />
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
        ) : (
          <View style={styles.offDayCard}>
            <Text style={styles.offDayEmoji}>☀️</Text>
            <Text style={styles.offDayTitle}>You're off today</Text>
            <Text style={styles.offDaySub}>No shifts scheduled — enjoy your time off!</Text>
          </View>
        )}

        {/* Add urgent task from home — only when on shift */}
        {addUrgentTask && isShiftDay && (
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
                <Ionicons name="people" size={20} color="#4CAF50" />
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
              <ActivityIndicator color="#4CAF50" style={{ paddingVertical: 30 }} />
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
  brandName: { fontSize: 18, fontWeight: '800', color: '#2d3748', letterSpacing: 0.3 },
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
    backgroundColor: 'white',
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
  dateCircleShift: { backgroundColor: '#4CAF50' },
  dateCircleToday: { backgroundColor: '#2d3748' },
  dateNum: { fontSize: 15, fontWeight: '600', color: '#2d3748' },
  dateNumActive: { color: 'white' },

  content: { flex: 1, paddingHorizontal: 20, paddingTop: 24 },
  welcomeText: { fontSize: 28, fontWeight: 'bold', color: '#2d3748', textAlign: 'center', marginBottom: 2 },
  nameText: { fontSize: 28, fontWeight: 'bold', color: '#2d3748', textAlign: 'center', marginBottom: 20 },

  // Shift card
  shiftCard: {
    backgroundColor: '#f0fff4',
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1.5,
    borderColor: '#9ae6b4',
  },
  shiftCardNext: { backgroundColor: '#ebf8ff', borderColor: '#90cdf4' },
  shiftCardNone: { backgroundColor: '#f7fafc', borderColor: '#e2e8f0' },
  shiftCardLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  shiftIconBg: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: '#e8f5e9', justifyContent: 'center', alignItems: 'center',
  },
  shiftCardLabel: { fontSize: 11, fontWeight: '700', color: '#276749', textTransform: 'uppercase', letterSpacing: 0.5 },
  shiftCardTime: { fontSize: 17, fontWeight: '700', color: '#2d3748', marginTop: 2 },
  shiftCardSubtime: { fontSize: 13, color: '#718096', marginTop: 1 },
  shiftBadge: {
    backgroundColor: '#c6f6d5',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20,
  },
  shiftBadgeText: { fontSize: 12, fontWeight: '700', color: '#276749' },

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
    height: 8, backgroundColor: '#4CAF50', borderRadius: 4,
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

  // Urgent tasks
  urgentCard: {
    backgroundColor: '#e53e3e',
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
    backgroundColor: '#e53e3e',
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
    backgroundColor: '#f0fff4', justifyContent: 'center', alignItems: 'center',
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
  rosterRowMe: { backgroundColor: '#f0fff4', marginHorizontal: -24, paddingHorizontal: 24 },
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
});

export default HomePage;
