import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const CalendarPage = ({ onBack }) => {
  const [selectedDate, setSelectedDate] = useState(null);
  const [currentMonth, setCurrentMonth] = useState(new Date(2024, 0, 1)); // Start in January 2024

  // Work days for January 2024 (realistic restaurant schedule - weekends + some weekdays)
  const workDays = [
    2, 4, 6, 7, 11, 13, 14, 18, 20, 21, 25, 27, 28
  ];

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const dayNames = ['M', 'T', 'W', 'Th', 'F', 'S', 'S'];

  const getDaysInMonth = (date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = (firstDay.getDay() + 6) % 7; // Adjust for Monday start

    const days = [];
    
    // Add empty cells for days before the first day of the month
    for (let i = 0; i < startingDayOfWeek; i++) {
      const prevMonthDay = new Date(year, month, 1 - (startingDayOfWeek - i));
      days.push({ 
        day: prevMonthDay.getDate(), 
        isCurrentMonth: false,
        date: prevMonthDay
      });
    }

    // Add days of the current month
    for (let day = 1; day <= daysInMonth; day++) {
      days.push({ 
        day, 
        isCurrentMonth: true,
        date: new Date(year, month, day)
      });
    }

    // Add days from next month to fill the grid
    const remainingCells = 42 - days.length; // 6 rows × 7 days
    for (let day = 1; day <= remainingCells; day++) {
      const nextMonthDay = new Date(year, month + 1, day);
      days.push({ 
        day: nextMonthDay.getDate(), 
        isCurrentMonth: false,
        date: nextMonthDay
      });
    }

    return days;
  };

  const navigateMonth = (direction) => {
    const newMonth = new Date(currentMonth);
    newMonth.setMonth(currentMonth.getMonth() + direction);
    setCurrentMonth(newMonth);
  };

  const handleDatePress = (dateObj) => {
    if (dateObj.isCurrentMonth) {
      setSelectedDate(dateObj.date);
    }
  };

  const handleRequestTimeOff = () => {
    // Handle time off request logic
    console.log('Request time off pressed');
  };

  const isWorkDay = (dateObj) => {
    // Only show work days for January 2024
    if (dateObj.isCurrentMonth && 
        currentMonth.getMonth() === 0 && // January
        currentMonth.getFullYear() === 2024) {
      return workDays.includes(dateObj.day);
    }
    return false;
  };

  const days = getDaysInMonth(currentMonth);

  return (
    <View style={styles.container}>
      {/* Header with back button */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Ionicons name="arrow-back" size={24} color="#2d3748" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Calendar</Text>
      </View>

      <ScrollView style={styles.content}>
        {/* Month Navigation */}
        <View style={styles.monthHeader}>
          <TouchableOpacity onPress={() => navigateMonth(-1)} style={styles.navButton}>
            <Ionicons name="chevron-back" size={24} color="#4a5568" />
          </TouchableOpacity>
          <Text style={styles.monthTitle}>
            {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
          </Text>
          <TouchableOpacity onPress={() => navigateMonth(1)} style={styles.navButton}>
            <Ionicons name="chevron-forward" size={24} color="#4a5568" />
          </TouchableOpacity>
        </View>

        {/* Calendar Grid */}
        <View style={styles.calendarContainer}>
          {/* Day Headers */}
          <View style={styles.dayHeadersRow}>
            {dayNames.map((day, index) => (
              <View key={index} style={styles.dayHeader}>
                <Text style={styles.dayHeaderText}>{day}</Text>
              </View>
            ))}
          </View>

          {/* Calendar Days */}
          <View style={styles.calendarGrid}>
            {days.map((dateObj, index) => {
              const isSelected = selectedDate && 
                selectedDate.toDateString() === dateObj.date.toDateString();
              const isWorking = isWorkDay(dateObj);
              
              return (
                <TouchableOpacity
                  key={index}
                  style={[
                    styles.dayCell,
                    !dateObj.isCurrentMonth && styles.dayCellInactive,
                    isSelected && styles.dayCellSelected,
                    isWorking && !isSelected && styles.dayCellWorking
                  ]}
                  onPress={() => handleDatePress(dateObj)}
                >
                  <Text style={[
                    styles.dayText,
                    !dateObj.isCurrentMonth && styles.dayTextInactive,
                    isSelected && styles.dayTextSelected,
                    isWorking && !isSelected && styles.dayTextWorking
                  ]}>
                    {dateObj.day}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Request Time Off Button */}
        <TouchableOpacity style={styles.requestButton} onPress={handleRequestTimeOff}>
          <Ionicons name="calendar-outline" size={20} color="#4a5568" style={styles.requestIcon} />
          <Text style={styles.requestButtonText}>Request Time Off</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 50,
    paddingBottom: 20,
    backgroundColor: 'white',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2d3748',
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  monthHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    paddingHorizontal: 10,
  },
  navButton: {
    padding: 10,
  },
  monthTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2d3748',
  },
  calendarContainer: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 15,
    marginBottom: 30,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  dayHeadersRow: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  dayHeader: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
  },
  dayHeaderText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4a5568',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: '14.28%', // 100% / 7 days
    aspectRatio: 1,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
    margin: 1,
  },
  dayCellInactive: {
    opacity: 0.3,
  },
  dayCellSelected: {
    backgroundColor: '#4CAF50',
  },
  dayCellWorking: {
    backgroundColor: '#e8f5e8',
    borderWidth: 2,
    borderColor: '#4CAF50',
  },
  dayText: {
    fontSize: 16,
    color: '#2d3748',
    fontWeight: '500',
  },
  dayTextInactive: {
    color: '#e2e8f0',
  },
  dayTextSelected: {
    color: 'white',
    fontWeight: 'bold',
  },
  dayTextWorking: {
    color: '#2e7d32',
    fontWeight: '600',
  },
  requestButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'white',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  requestIcon: {
    marginRight: 10,
  },
  requestButtonText: {
    fontSize: 18,
    fontWeight: '500',
    color: '#2d3748',
  },
});

export default CalendarPage;