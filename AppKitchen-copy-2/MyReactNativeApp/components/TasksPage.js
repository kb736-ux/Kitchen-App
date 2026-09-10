import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated, PanResponder, TextInput, KeyboardAvoidingView, Platform, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/theme';

const SWIPE_THRESHOLD = 80;
const REVEAL_WIDTH = 120;

// Swipeable row wrapper — swipe right to reveal, tap to confirm
const SwipeableTask = ({ children, onSwipe, isUrgent }) => {
  const translateX = useRef(new Animated.Value(0)).current;

  const snapBack = () => {
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true, tension: 80, friction: 12 }).start();
  };

  const handleConfirm = () => {
    onSwipe?.();
    snapBack();
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderMove: (_, g) => {
        if (g.dx > 0) translateX.setValue(Math.min(g.dx, REVEAL_WIDTH));
      },
      onPanResponderRelease: (_, g) => {
        if (g.dx >= SWIPE_THRESHOLD) {
          Animated.spring(translateX, { toValue: REVEAL_WIDTH, useNativeDriver: true, tension: 80, friction: 12 }).start();
        } else {
          snapBack();
        }
      },
      onPanResponderTerminate: () => snapBack(),
    })
  ).current;

  return (
    <View style={swipeStyles.container}>
      {/* Revealed action (left side) — tap to confirm */}
      <TouchableOpacity
        activeOpacity={1}
        style={[swipeStyles.revealBg, isUrgent ? swipeStyles.revealBgOff : swipeStyles.revealBgOn]}
        onPress={handleConfirm}
      >
        <Ionicons name={isUrgent ? 'flame-outline' : 'flame'} size={20} color="white" />
        <Text style={swipeStyles.revealText}>{isUrgent ? 'Remove Urgent' : 'Mark Urgent'}</Text>
      </TouchableOpacity>
      {/* Sliding content — solid bg so it fully covers reveal when closed */}
      <Animated.View
        {...panResponder.panHandlers}
        style={[swipeStyles.slidingContent, { transform: [{ translateX }] }]}
      >
        {children}
      </Animated.View>
    </View>
  );
};

const swipeStyles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    borderRadius: 12,
    marginBottom: 8,
  },
  revealBg: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: REVEAL_WIDTH,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
    gap: 8,
    borderRadius: 12,
  },
  revealBgOn:  { backgroundColor: Colors.error },
  revealBgOff: { backgroundColor: '#718096' },
  revealText: { color: 'white', fontWeight: '700', fontSize: 14 },
  slidingContent: {
    backgroundColor: 'white',
    borderRadius: 12,
    zIndex: 1,
  },
});

const TasksPage = ({ onProgressPress, tasks, toggleTask, onTaskPress, todayIsShift, toggleUrgent, addUrgentTask, onRefresh }) => {
  const [urgentInput, setUrgentInput] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const inputRef = useRef(null);

  const handleRefresh = async () => {
    setRefreshing(true);
    await onRefresh?.();
    setRefreshing(false);
  };

  const handleAddUrgent = () => {
    if (!urgentInput.trim()) return;
    addUrgentTask && addUrgentTask(urgentInput);
    setUrgentInput('');
    inputRef.current?.blur();
  };

  const getCurrentDate = () => {
    const today = new Date();
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    const dayName = days[today.getDay()];
    const date = today.getDate();
    const month = months[today.getMonth()];
    
    return `${dayName}, ${month} ${date}`;
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.header}>
        <TouchableOpacity style={styles.progressButton} onPress={onProgressPress}>
          <Ionicons name="analytics" size={20} color="#4a5568" />
          <Text style={styles.progressText}>Progress</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[Colors.primary]} />
        }
      >
        {/* Date */}
        <Text style={styles.dateText}>{getCurrentDate()}</Text>
        
        {/* Title */}
        <Text style={styles.title}>My tasks</Text>

        {/* Tasks List */}
        <View style={styles.tasksList}>
          {!todayIsShift && tasks.length === 0 && (
            <Text style={styles.offShiftTasksHint}>
              You're not scheduled today. Your task list appears on days you have a shift.
            </Text>
          )}
          {/* Hint */}
          {todayIsShift && tasks.some(t => !t.completed) && (
            <Text style={styles.swipeHint}>Swipe right to reveal, then tap to mark urgent</Text>
          )}
          {tasks.map((task) => {
            const showUrgent = todayIsShift && task.is_urgent && !task.completed;
            const taskRow = (
              <View style={[styles.taskItem, showUrgent && styles.taskItemUrgent, { marginBottom: 0, borderRadius: 12 }]}>
                <TouchableOpacity
                  style={styles.checkboxContainer}
                  onPress={() => toggleTask(task.id)}
                >
                  <Ionicons
                    name={task.completed ? 'checkbox' : 'square-outline'}
                    size={24}
                    color={task.completed ? '#48bb78' : showUrgent ? '#c05621' : '#4a5568'}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.taskTextContainer}
                  onPress={() => onTaskPress ? onTaskPress(task) : toggleTask(task.id)}
                >
                  <View style={styles.taskLabelRow}>
                    <Text style={[
                      styles.taskText,
                      task.completed && styles.taskTextCompleted,
                      showUrgent && styles.taskTextUrgent,
                    ]}>
                      {task.text}
                    </Text>
                    {showUrgent && (
                      <View style={styles.urgentBadge}>
                        <Text style={styles.urgentBadgeText}>Urgent</Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              </View>
            );

            if (task.completed) {
              return (
                <View key={task.id} style={{ marginBottom: 8, borderRadius: 12 }}>
                  {taskRow}
                </View>
              );
            }

            return (
              <SwipeableTask
                key={task.id}
                isUrgent={task.is_urgent}
                onSwipe={() => toggleUrgent && toggleUrgent(task.id)}
              >
                {taskRow}
              </SwipeableTask>
            );
          })}
        </View>
      </ScrollView>

      {/* Urgent task quick-add bar — only when on shift */}
      {todayIsShift && (
      <View style={styles.urgentInputBar}>
        <View style={styles.urgentInputLeft}>
          <Ionicons name="flame" size={18} color="#e53e3e" />
        </View>
        <TextInput
          ref={inputRef}
          style={styles.urgentInputField}
          placeholder="Add an urgent task…"
          placeholderTextColor="#a0aec0"
          value={urgentInput}
          onChangeText={setUrgentInput}
          onSubmitEditing={handleAddUrgent}
          returnKeyType="done"
        />
        <TouchableOpacity
          style={[styles.urgentAddBtn, !urgentInput.trim() && styles.urgentAddBtnDisabled]}
          onPress={handleAddUrgent}
          disabled={!urgentInput.trim()}
        >
          <Text style={styles.urgentAddBtnText}>Add</Text>
        </TouchableOpacity>
      </View>
      )}
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 50,
    paddingBottom: 15,
    backgroundColor: 'white',
  },
  progressButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.bg,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  progressText: {
    color: '#4a5568',
    fontWeight: '600',
    marginLeft: 6,
    fontSize: 16,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  dateText: {
    fontSize: 16,
    color: '#4a5568',
    marginBottom: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#2d3748',
    marginBottom: 30,
  },
  tasksList: {
    paddingBottom: 20,
  },
  swipeHint: {
    fontSize: 12,
    color: '#a0aec0',
    textAlign: 'center',
    marginBottom: 12,
    fontStyle: 'italic',
  },
  offShiftTasksHint: {
    fontSize: 14,
    color: '#718096',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 20,
    paddingHorizontal: 8,
  },
  taskItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  checkboxContainer: {
    marginRight: 16,
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  taskTextContainer: {
    flex: 1,
  },
  taskText: {
    fontSize: 18,
    color: '#2d3748',
  },
  taskTextCompleted: {
    textDecorationLine: 'line-through',
    color: '#718096',
  },
  taskTextUnderlined: {
    textDecorationLine: 'underline',
  },
  taskItemUrgent: {
    backgroundColor: '#fff5eb',
    borderRadius: 10,
    marginHorizontal: -4,
    paddingHorizontal: 4,
    borderLeftWidth: 3,
    borderLeftColor: '#f6ad55',
  },
  taskTextUrgent: {
    color: '#c05621',
    fontWeight: '600',
  },
  taskLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  urgentBadge: {
    backgroundColor: '#fed7aa',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  urgentBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#c05621',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  urgentInputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'white',
    borderTopWidth: 1,
    borderTopColor: '#fee2e2',
    gap: 10,
  },
  urgentInputLeft: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#fff5f5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  urgentInputField: {
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
});

export default TasksPage;