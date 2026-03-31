import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const TaskDetailPage = ({ onBack, task, toggleTask, toggleUrgent, orgId, requestTaskTransfer, fetchEmployeesOnShift }) => {
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [employeesOnShift, setEmployeesOnShift] = useState([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [transferringTo, setTransferringTo] = useState(null);
  const [fetchError, setFetchError] = useState(null);

  useEffect(() => {
    if (showTransferModal && fetchEmployeesOnShift && orgId) {
      setLoadingEmployees(true);
      setFetchError(null);
      fetchEmployeesOnShift(orgId).then(names => {
        setEmployeesOnShift(names);
        setLoadingEmployees(false);
      }).catch((err) => {
        setLoadingEmployees(false);
        setFetchError(err?.message || 'Could not load employees');
      });
    }
  }, [showTransferModal, orgId, fetchEmployeesOnShift]);

  const handleTransferPress = () => {
    if (!orgId || !fetchEmployeesOnShift) return;
    setShowTransferModal(true);
  };

  const handleSelectEmployee = async (employeeName) => {
    if (!requestTaskTransfer || !task?.id) return;
    setTransferringTo(employeeName);
    const result = await requestTaskTransfer(task.id, employeeName);
    setTransferringTo(null);
    // Always dismiss the bottom sheet so the user isn't stuck under an alert
    setShowTransferModal(false);
    if (result?.ok) {
      onBack?.();
    } else {
      const msg = result?.message || 'Unknown error';
      const hint = /stack depth/i.test(msg)
        ? '\n\nFix: Supabase → SQL Editor → run fix-task-transfer-stack-depth.sql from your project.'
        : /task_transfer_requests|schema cache/i.test(msg)
          ? '\n\nFix: Supabase → SQL Editor → run supabase-task-transfer-requests.sql (creates task_transfer_requests).'
          : '';
      Alert.alert('Transfer failed', `${msg}${hint}`);
    }
  };

  const handleComplete = async () => {
    if (task.completed) return;
    const r = await toggleTask(task.id);
    if (r?.ok) onBack?.();
    else if (r?.message) Alert.alert('Could not update task', r.message);
  };

  const handleUrgentPress = async () => {
    const r = await toggleUrgent(task.id);
    if (r?.ok) onBack?.();
    else if (r?.message) Alert.alert('Could not update task', r.message);
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content}>
        {/* Task Title */}
        <Text style={styles.title}>{task.text}</Text>

        {/* Move to Urgent / Remove Urgent */}
        {toggleUrgent && !task.completed && (
          <TouchableOpacity
            style={[styles.transferButton, styles.urgentButton, task.is_urgent && styles.urgentButtonActive]}
            onPress={handleUrgentPress}
          >
            <Ionicons name="flame" size={18} color={task.is_urgent ? '#718096' : '#e53e3e'} style={{ marginRight: 8 }} />
            <Text style={[styles.transferButtonText, task.is_urgent && styles.urgentButtonText]}>
              {task.is_urgent ? 'Remove from Urgent' : 'Move to Urgent'}
            </Text>
          </TouchableOpacity>
        )}

        {/* Transfer Task Button */}
        <TouchableOpacity style={styles.transferButton} onPress={handleTransferPress} disabled={task.completed}>
          <Ionicons name="person-add" size={18} color="#333" style={{ marginRight: 8 }} />
          <Text style={styles.transferButtonText}>Transfer Task</Text>
        </TouchableOpacity>

        {/* Transfer Modal — select employee on shift */}
        <Modal visible={showTransferModal} transparent animationType="slide">
          <TouchableOpacity
            style={styles.transferModalOverlay}
            activeOpacity={1}
            onPress={() => setShowTransferModal(false)}
          >
            <TouchableOpacity activeOpacity={1} style={styles.transferModalContent} onPress={e => e.stopPropagation()}>
              <View style={styles.transferModalHeader}>
                <Text style={styles.transferModalTitle}>Transfer to</Text>
                <TouchableOpacity onPress={() => setShowTransferModal(false)}>
                  <Ionicons name="close" size={24} color="#718096" />
                </TouchableOpacity>
              </View>
              <Text style={styles.transferModalSubtitle}>Select an employee on shift today. They must accept for the transfer to complete.</Text>
              {loadingEmployees ? (
                <ActivityIndicator color="#4CAF50" style={{ paddingVertical: 24 }} />
              ) : fetchError ? (
                <Text style={styles.transferModalError}>{fetchError}</Text>
              ) : employeesOnShift.length === 0 ? (
                <Text style={styles.transferModalEmpty}>No other employees on shift today.</Text>
              ) : (
                <ScrollView style={styles.transferEmployeeList} showsVerticalScrollIndicator={false}>
                  {employeesOnShift.map(name => (
                    <TouchableOpacity
                      key={name}
                      style={styles.transferEmployeeRow}
                      onPress={() => handleSelectEmployee(name)}
                      disabled={transferringTo !== null}
                    >
                      <View style={styles.transferEmployeeAvatar}>
                        <Text style={styles.transferEmployeeAvatarText}>{name.charAt(0).toUpperCase()}</Text>
                      </View>
                      <Text style={styles.transferEmployeeName}>{name}</Text>
                      {transferringTo === name ? (
                        <ActivityIndicator size="small" color="#4CAF50" />
                      ) : (
                        <Ionicons name="chevron-forward" size={18} color="#a0aec0" />
                      )}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>

        {/* Completed Button */}
        <TouchableOpacity 
          style={[
            styles.completedButton,
            task.completed && styles.completedButtonActive
          ]} 
          onPress={handleComplete}
        >
          {task.completed ? (
            <>
              <Ionicons name="checkmark" size={24} color="#4CAF50" />
              <Text style={styles.completedButtonTextActive}>Completed</Text>
            </>
          ) : (
            <Text style={styles.completedButtonText}>Completed</Text>
          )}
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
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'center',
    marginBottom: 30,
  },
  transferButton: {
    borderWidth: 2,
    borderColor: '#333',
    paddingVertical: 15,
    paddingHorizontal: 30,
    alignSelf: 'center',
    marginBottom: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  transferModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  transferModalContent: {
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 34,
    maxHeight: '70%',
  },
  transferModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  transferModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2d3748',
  },
  transferModalSubtitle: {
    fontSize: 13,
    color: '#718096',
    marginTop: 12,
    lineHeight: 20,
  },
  transferModalEmpty: {
    fontSize: 15,
    color: '#a0aec0',
    textAlign: 'center',
    paddingVertical: 24,
  },
  transferModalError: {
    fontSize: 15,
    color: '#e53e3e',
    textAlign: 'center',
    paddingVertical: 24,
  },
  transferEmployeeList: {
    maxHeight: 280,
    marginTop: 12,
  },
  transferEmployeeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    gap: 12,
  },
  transferEmployeeAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#4CAF50',
    justifyContent: 'center',
    alignItems: 'center',
  },
  transferEmployeeAvatarText: {
    color: 'white',
    fontWeight: '700',
    fontSize: 16,
  },
  transferEmployeeName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#2d3748',
  },
  transferButtonText: {
    fontSize: 16,
    color: '#333',
    fontWeight: '500',
  },
  urgentButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  urgentButtonActive: {
    borderColor: '#e53e3e',
    backgroundColor: '#fff5f5',
  },
  urgentButtonText: {
    color: '#718096',
  },
  completedButton: {
    borderWidth: 2,
    borderColor: '#333',
    paddingVertical: 15,
    paddingHorizontal: 30,
    alignSelf: 'center',
    marginBottom: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 150,
  },
  completedButtonActive: {
    borderColor: '#4CAF50',
    backgroundColor: '#f0f8f0',
  },
  completedButtonText: {
    fontSize: 16,
    color: '#333',
    fontWeight: '500',
  },
  completedButtonTextActive: {
    fontSize: 16,
    color: '#4CAF50',
    fontWeight: '500',
    marginLeft: 8,
  },
});

export default TaskDetailPage;