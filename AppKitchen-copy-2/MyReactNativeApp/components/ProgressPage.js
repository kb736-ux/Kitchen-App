import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useEmployee } from '../EmployeeContext';

const ProgressPage = ({ onBack, tasks, allTasks = [], toggleTask, onTaskPress }) => {
  const { employeeName } = useEmployee();
  const [todoExpanded, setTodoExpanded] = useState(true);
  const inProgressTasks = allTasks.filter(t =>
    !t.completed &&
    t.employee_name &&
    (t.employee_name || '').toLowerCase() !== employeeName.toLowerCase()
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Ionicons name="arrow-back" size={24} color="#2d3748" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content}>
        {/* In Progress Section — tasks assigned and not yet completed */}
        {inProgressTasks.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { marginBottom: 8 }]}>In progress</Text>
            <View style={[styles.inProgressList, { marginBottom: 24 }]}>
              {inProgressTasks.map((item) => (
                <View key={item.id} style={styles.inProgressItem}>
                  <View style={styles.inProgressBorder} />
                  <Text style={styles.inProgressText}>
                    <Text style={styles.personName}>{item.employee_name}</Text> {item.text}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* To Do Section */}
        <TouchableOpacity 
          style={styles.todoHeader}
          onPress={() => setTodoExpanded(!todoExpanded)}
        >
          <Text style={styles.todoTitle}>To do</Text>
          <Ionicons 
            name={todoExpanded ? "chevron-down" : "chevron-forward"} 
            size={20} 
            color="#4a5568" 
          />
        </TouchableOpacity>
        
        {todoExpanded && (
          <View style={styles.todoList}>
            {tasks.map((task) => (
              <View key={task.id} style={styles.todoItem}>
                <TouchableOpacity
                  style={styles.checkboxContainer}
                  onPress={() => toggleTask(task.id)}
                >
                  <Ionicons
                  name={task.completed ? "checkbox" : "square-outline"}
                  size={20}
                  color="#4a5568"
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.todoTextContainer}
                  onPress={() => onTaskPress ? onTaskPress(task) : toggleTask(task.id)}
                >
                  <Text style={[
                    styles.todoText,
                    task.completed && styles.todoTextCompleted,
                  ]}>
                    {task.text}
                  </Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
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
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2d3748',
    marginRight: 8,
  },
  inProgressList: {
    marginBottom: 30,
  },
  inProgressItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
    paddingLeft: 8,
  },
  inProgressBorder: {
    width: 3,
    height: 20,
    backgroundColor: '#e53e3e',
    marginRight: 12,
    marginTop: 2,
  },
  inProgressText: {
    fontSize: 16,
    color: '#2d3748',
    flex: 1,
    lineHeight: 22,
  },
  personName: {
    fontWeight: '600',
  },
  todoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 15,
  },
  todoTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2d3748',
  },
  todoList: {
    paddingBottom: 20,
  },
  todoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  checkboxContainer: {
    marginRight: 12,
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  todoTextContainer: {
    flex: 1,
  },
  todoText: {
    fontSize: 16,
    color: '#2d3748',
  },
  todoTextCompleted: {
    textDecorationLine: 'line-through',
    color: '#718096',
  },
});

export default ProgressPage;