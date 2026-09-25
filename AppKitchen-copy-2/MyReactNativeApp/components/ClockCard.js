import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../utils/supabase';
import { useEmployee } from '../EmployeeContext';
import { Colors } from '../constants/theme';
import {
  currentWeekRange,
  evaluateClockIn,
  formatClockDate,
  formatClockTime,
  formatDurationMs,
  latestOpenPunch,
  pairPunches,
} from '../utils/earlyPunch';
import {
  fetchClockEnabled,
  fetchWeekPunches,
  scheduledStartFromShift,
  submitPunch,
} from '../utils/timeClock';

function pairLabel(pair) {
  const startAt = pair.in?.punched_at;
  const endAt = pair.out?.punched_at;
  if (!startAt && endAt) {
    return `${formatClockDate(endAt)}  Out ${formatClockTime(endAt)}`;
  }
  const day = formatClockDate(startAt);
  const start = formatClockTime(startAt);
  if (!endAt) return `${day}  ${start} – now`;
  const ms = new Date(endAt).getTime() - new Date(startAt).getTime();
  return `${day}  ${start} – ${formatClockTime(endAt)}  ·  ${formatDurationMs(ms)}`;
}

const ClockCard = ({ orgId, todayShift }) => {
  const { employeeName, displayName, employeeId, authUserId } = useEmployee();
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [loadingPunches, setLoadingPunches] = useState(false);
  const [busy, setBusy] = useState(false);
  const [punches, setPunches] = useState([]);
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState('muted');
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    if (!orgId) {
      setEnabled(false);
      setReady(true);
      return;
    }
    const on = await fetchClockEnabled(supabase, orgId);
    setEnabled(on);
    if (!on) {
      setPunches([]);
      setReady(true);
      return;
    }
    setLoadingPunches(true);
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth?.user?.id || authUserId;
    const rows = await fetchWeekPunches(supabase, orgId, { userId });
    setPunches(rows);
    setLoadingPunches(false);
    setReady(true);
  }, [orgId, authUserId]);

  useEffect(() => {
    setReady(false);
    load();
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!ready || !enabled) return null;

  const scheduledStart = scheduledStartFromShift(todayShift);
  const now = new Date();
  const decision = evaluateClockIn({ now, scheduledStart });
  const openPunch = latestOpenPunch(punches);
  const clockedIn = !!openPunch;
  const pairs = pairPunches(punches).slice().reverse();
  const { start: weekStart, end: weekEnd } = currentWeekRange(now);
  const weekLabel = `${formatClockDate(weekStart)} – ${formatClockDate(new Date(weekEnd.getTime() - 1))}`;
  void tick;

  const elapsed = clockedIn
    ? formatDurationMs(now.getTime() - new Date(openPunch.punched_at).getTime())
    : '';

  async function onPunch(punchType) {
    if (busy) return;
    setMessage('');
    setBusy(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth?.user?.id || authUserId;
      const result = await submitPunch(supabase, {
        orgId,
        userId,
        employeeId,
        employeeName: displayName || employeeName,
        punchType,
        todayShift,
        now: new Date(),
      });
      if (!result.ok) {
        // Early clock-in is already a disabled button. Do not repeat a warning.
        if (result.blockedEarly) return;
        setMessageTone('error');
        setMessage(result.message || 'Could not save punch.');
        return;
      }
      setMessageTone('ok');
      setMessage(punchType === 'out' ? 'Clocked out.' : 'Clocked in.');
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.iconBg}>
          <Ionicons name="finger-print-outline" size={20} color={Colors.primary} />
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.title}>Clock in / out</Text>
          <Text style={styles.sub}>
            {clockedIn
              ? `In since ${formatClockTime(openPunch.punched_at)} · ${elapsed}`
              : todayShift
                ? `Shift ${formatClockTime(scheduledStart)} – ${formatClockTime(parseShiftEnd(todayShift))}`
                : 'No shift scheduled today'}
          </Text>
        </View>
        <View style={[styles.statusPill, clockedIn ? styles.statusIn : styles.statusOut]}>
          <Text style={[styles.statusText, clockedIn ? styles.statusInText : styles.statusOutText]}>
            {clockedIn ? 'In' : 'Out'}
          </Text>
        </View>
      </View>

      {loadingPunches ? (
        <ActivityIndicator color={Colors.primary} style={{ marginVertical: 12 }} />
      ) : (
        <>
          {message ? (
            <Text
              style={[
                styles.feedback,
                messageTone === 'error' && styles.feedbackError,
                messageTone === 'ok' && styles.feedbackOk,
              ]}
            >
              {message}
            </Text>
          ) : null}

          <TouchableOpacity
            style={[
              styles.punchBtn,
              clockedIn ? styles.punchOut : styles.punchIn,
              ((!clockedIn && decision.isEarly) || busy) && styles.punchDisabled,
            ]}
            activeOpacity={0.85}
            disabled={busy || (!clockedIn && decision.isEarly)}
            onPress={() => onPunch(clockedIn ? 'out' : 'in')}
          >
            {busy ? (
              <ActivityIndicator color={Colors.onPrimary} />
            ) : (
              <Text style={styles.punchBtnText}>
                {clockedIn ? 'Clock out' : 'Clock in'}
              </Text>
            )}
          </TouchableOpacity>

          <Text style={styles.weekLabel}>This week · {weekLabel}</Text>
          {pairs.length === 0 ? (
            <Text style={styles.empty}>No punches yet this week.</Text>
          ) : (
            pairs.map((pair, i) => (
              <View key={pair.in?.id || pair.out?.id || String(i)} style={styles.row}>
                <Ionicons
                  name={pair.out ? 'checkmark-circle-outline' : 'time-outline'}
                  size={14}
                  color={pair.out ? Colors.success : Colors.warning}
                />
                <Text style={styles.rowText}>{pairLabel(pair)}</Text>
              </View>
            ))
          )}
        </>
      )}
    </View>
  );
};

function parseShiftEnd(shift) {
  if (!shift?.shift_date || !shift?.end_time) return null;
  const timeKey = String(shift.end_time).trim().match(/^(\d{1,2}:\d{2}(?::\d{2})?)/)?.[1];
  if (!timeKey) return null;
  const hhmmss = timeKey.length === 5 ? `${timeKey}:00` : timeKey;
  const dateKey = String(shift.shift_date).trim().match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  if (!dateKey) return null;
  const d = new Date(`${dateKey}T${hhmmss}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  iconBg: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: Colors.primarySoft,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: { fontSize: 15, fontWeight: '700', color: Colors.text },
  sub: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statusIn: { backgroundColor: Colors.successSoft },
  statusOut: { backgroundColor: Colors.primarySoft },
  statusText: { fontSize: 12, fontWeight: '700' },
  statusInText: { color: Colors.success },
  statusOutText: { color: Colors.secondary },
  feedback: { fontSize: 13, marginBottom: 8, color: Colors.textMuted },
  feedbackError: { color: Colors.error },
  feedbackOk: { color: Colors.success },
  punchBtn: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 14,
  },
  punchIn: { backgroundColor: Colors.primary },
  punchOut: { backgroundColor: Colors.success },
  punchDisabled: { opacity: 0.45 },
  punchBtnText: { color: Colors.onPrimary, fontSize: 16, fontWeight: '700' },
  weekLabel: { fontSize: 11, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 },
  empty: { fontSize: 13, color: Colors.textMuted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 },
  rowText: { flex: 1, fontSize: 13, color: Colors.text },
});

export default ClockCard;
