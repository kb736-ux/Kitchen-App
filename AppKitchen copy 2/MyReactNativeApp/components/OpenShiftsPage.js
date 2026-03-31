import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../utils/supabase';
import { useEmployee } from '../EmployeeContext';
import { formatLocalDateYMD } from '../utils/shiftMatching';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const OpenShiftsPage = ({ onBack, orgId }) => {
  const { employeeName, employeeId } = useEmployee();
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (orgId) {
      fetchOpenShifts();
    } else {
      setLoading(false);
    }
  }, [orgId]);

  async function fetchOpenShifts() {
    setLoading(true);
    const today = formatLocalDateYMD(new Date());
    const nextMonth = new Date();
    nextMonth.setDate(nextMonth.getDate() + 30);

    const { data, error } = await supabase
      .from('shifts')
      .select('*')
      .eq('org_id', orgId)
      .eq('status', 'open')
      .gte('shift_date', today)
      .lte('shift_date', formatLocalDateYMD(nextMonth))
      .order('shift_date', { ascending: true });

    if (error) console.warn('[Supabase] fetchOpenShifts failed:', error.message);
    setShifts(data || []);
    setLoading(false);
  }

  async function handleRequestShift(shift) {
    Alert.alert(
      'Claim This Shift?',
      `${shift.position || 'Open Shift'}\n${formatTime(shift.start_time)} – ${formatTime(shift.end_time)}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Claim Shift',
          onPress: async () => {
            const { error } = await supabase
              .from('shifts')
              .update({
                employee_name: employeeName,
                employee_id: employeeId || null,
                status: 'assigned',
              })
              .eq('id', shift.id);

            if (error) {
              Alert.alert('Error', 'Could not claim shift. Please try again.');
            } else {
              Alert.alert(
                'Shift Claimed!',
                `You've been added to ${shift.position || 'this shift'} on ${new Date(shift.shift_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}.`
              );
              fetchOpenShifts();
            }
          },
        },
      ]
    );
  }

  const formatTime = (timeStr) => {
    if (!timeStr) return '';
    const [h, m] = timeStr.split(':');
    const hour = parseInt(h);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    return `${hour % 12 || 12}:${m} ${ampm}`;
  };

  // Group shifts by day-of-week label
  const shiftsByDay = {};
  shifts.forEach(shift => {
    const d = new Date(shift.shift_date + 'T00:00:00');
    const label = `${DAYS[d.getDay()]} ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    if (!shiftsByDay[label]) shiftsByDay[label] = [];
    shiftsByDay[label].push(shift);
  });

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Ionicons name="arrow-back" size={24} color="#2d3748" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Open Shifts</Text>
      </View>

      <ScrollView style={styles.content}>
        {loading ? (
          <ActivityIndicator size="small" color="#4CAF50" style={{ marginTop: 40 }} />
        ) : shifts.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No open shifts available right now.</Text>
          </View>
        ) : (
          Object.entries(shiftsByDay).map(([dayLabel, dayShifts]) => (
            <View key={dayLabel} style={styles.daySection}>
              <Text style={styles.dayTitle}>{dayLabel}</Text>
              <View style={styles.shiftsContainer}>
                {dayShifts.map((shift) => (
                  <View key={shift.id} style={styles.shiftItem}>
                    <View style={styles.shiftInfo}>
                      <Text style={styles.shiftPosition}>{shift.position || 'Open Shift'}</Text>
                      <Text style={styles.shiftTime}>
                        {formatTime(shift.start_time)} – {formatTime(shift.end_time)}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.requestButton}
                      onPress={() => handleRequestShift(shift)}
                    >
                      <Text style={styles.requestButtonText}>Request</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fa' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 50,
    paddingBottom: 20,
    backgroundColor: 'white',
  },
  backButton: { padding: 8 },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#2d3748' },
  content: { flex: 1, paddingHorizontal: 20, paddingTop: 20 },
  emptyContainer: { alignItems: 'center', paddingTop: 60 },
  emptyText: { fontSize: 16, color: '#718096' },
  daySection: { marginBottom: 25 },
  dayTitle: { fontSize: 18, fontWeight: 'bold', color: '#2d3748', marginBottom: 10 },
  shiftsContainer: { paddingLeft: 10 },
  shiftItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    marginBottom: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  shiftInfo: { flex: 1 },
  shiftPosition: { fontSize: 16, color: '#2d3748', fontWeight: '500' },
  shiftTime: { fontSize: 13, color: '#718096', marginTop: 2 },
  requestButton: {
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  requestedButton: {
    backgroundColor: '#e8f5e9',
    borderColor: '#4CAF50',
  },
  requestButtonText: { fontSize: 14, color: '#2d3748', fontWeight: '500' },
  requestedButtonText: { color: '#4CAF50' },
});

export default OpenShiftsPage;
