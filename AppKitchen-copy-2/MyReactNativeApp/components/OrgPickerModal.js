import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/theme';

/**
 * Pick another restaurant/org the user belongs to.
 */
export default function OrgPickerModal({
  visible,
  onClose,
  orgs = [],
  activeOrgId,
  loading,
  onSelectOrg,
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity style={styles.sheet} activeOpacity={1} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <Text style={styles.title}>Switch restaurant</Text>
          <Text style={styles.sub}>{"Choose where you're working today."}</Text>
          {loading ? (
            <ActivityIndicator style={{ marginVertical: 24 }} color={Colors.primary} />
          ) : (
            <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
              {orgs.map((o) => {
                const active = o.id === activeOrgId;
                return (
                  <TouchableOpacity
                    key={o.id}
                    style={[styles.row, active && styles.rowActive]}
                    onPress={() => onSelectOrg?.(o.id)}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={active ? 'checkmark-circle' : 'business-outline'}
                      size={22}
                      color={active ? Colors.primary : '#718096'}
                      style={{ marginRight: 12 }}
                    />
                    <Text style={[styles.rowText, active && styles.rowTextActive]}>{o.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
          <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 20,
    paddingBottom: 28,
    maxHeight: '70%',
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#e2e8f0',
    marginTop: 10,
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a202c',
    marginBottom: 4,
  },
  sub: {
    fontSize: 14,
    color: '#718096',
    marginBottom: 12,
  },
  list: {
    maxHeight: 320,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#edf2f7',
  },
  rowActive: {
    backgroundColor: Colors.primarySoft,
    borderRadius: 10,
    borderBottomWidth: 0,
    marginBottom: 4,
    paddingHorizontal: 10,
  },
  rowText: {
    fontSize: 16,
    color: '#2d3748',
    flex: 1,
  },
  rowTextActive: {
    fontWeight: '600',
    color: Colors.success,
  },
  cancelBtn: {
    marginTop: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelText: {
    fontSize: 16,
    color: '#718096',
    fontWeight: '600',
  },
});
