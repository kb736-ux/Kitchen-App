import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/theme';
import {
  formatShiftDate,
  formatShiftTimeRange,
  getRepeatSummary,
  isShiftSeries,
  seriesGroupKey,
} from '../utils/shiftSeries';

const wrapSafe = Platform.select({
  android: { textBreakStrategy: 'simple', android_hyphenationFrequency: 'none' },
  default: {},
});

export default function ShiftSeriesRow({
  group,
  onPress,
  onAccept,
  onDeny,
  submitting = false,
  showChevron = true,
}) {
  const shift = group?.shift;
  if (!shift) return null;
  const repeatSummary = getRepeatSummary(group);
  const series = isShiftSeries(group);

  return (
    <View style={styles.row} testID={`shift-series-row-${seriesGroupKey(group)}`}>
      <TouchableOpacity
        style={styles.copyHit}
        onPress={onPress}
        activeOpacity={0.7}
        disabled={!onPress}
      >
        <View style={styles.copy}>
          <View style={styles.dateRow}>
            <Text
              style={styles.date}
              numberOfLines={1}
              ellipsizeMode="clip"
              {...wrapSafe}
            >
              {formatShiftDate(shift.shift_date)}
            </Text>
            {showChevron ? (
              <Ionicons name="chevron-forward" size={16} color="#a0aec0" style={styles.chevron} />
            ) : null}
          </View>
          <Text style={styles.time} numberOfLines={1} ellipsizeMode="clip" {...wrapSafe}>
            {formatShiftTimeRange(shift.start_time, shift.end_time)}
          </Text>
          <Text style={styles.role} numberOfLines={1} ellipsizeMode="tail" {...wrapSafe}>
            {shift.position || '—'}
          </Text>
          {repeatSummary ? (
            <Text style={styles.repeat} {...wrapSafe}>
              {repeatSummary}
            </Text>
          ) : null}
        </View>
      </TouchableOpacity>
      {series && (onAccept || onDeny) ? (
        <View style={styles.actions}>
          {onAccept ? (
            <TouchableOpacity
              style={[styles.btn, styles.btnAccept]}
              onPress={onAccept}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel="Accept series"
            >
              <Text style={styles.btnAcceptText}>Accept series</Text>
            </TouchableOpacity>
          ) : null}
          {onDeny ? (
            <TouchableOpacity
              style={[styles.btn, styles.btnDeny]}
              onPress={onDeny}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel="Deny series"
            >
              <Text style={styles.btnDenyText}>Deny series</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    width: '100%',
    flexDirection: 'column',
    alignItems: 'stretch',
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    gap: 12,
  },
  copyHit: {
    width: '100%',
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  copy: {
    width: '100%',
    minWidth: 0,
    flexShrink: 1,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  date: {
    flex: 1,
    minWidth: 0,
    fontSize: 16,
    fontWeight: '700',
    color: '#2d3748',
    flexShrink: 1,
  },
  chevron: {
    marginLeft: 8,
    flexShrink: 0,
  },
  time: {
    fontSize: 13,
    color: '#718096',
    marginTop: 2,
    width: '100%',
  },
  role: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: '600',
    marginTop: 4,
    width: '100%',
  },
  repeat: {
    fontSize: 12,
    color: Colors.primary,
    marginTop: 6,
    fontWeight: '600',
    lineHeight: 18,
    width: '100%',
    flexShrink: 1,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'stretch',
    gap: 8,
    width: '100%',
  },
  btn: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 22,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnAccept: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  btnAcceptText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.onPrimary,
  },
  btnDeny: {
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
  },
  btnDenyText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.primary,
  },
});
