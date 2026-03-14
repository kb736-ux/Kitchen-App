import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator, SafeAreaView, Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase, ORG_ID } from '../utils/supabase';
import { useEmployee } from '../EmployeeContext';

const BASE_CHANNELS = [
  {
    id: 'announcements',
    name: 'Announcements',
    icon: 'megaphone',
    iconColor: '#d97706',
    iconBg: '#fffbeb',
    preview: 'From management',
    readOnly: true,
  },
  {
    id: 'group-kitchen',
    name: 'Kitchen Team',
    icon: 'people',
    iconColor: '#4CAF50',
    iconBg: '#f0fff4',
    preview: 'Group chat',
    readOnly: false,
  },
];

const normalizeName = (name) => (name || '').trim().toLowerCase();

const buildDmChannelId = (a, b) => {
  const aKey = normalizeName(a);
  const bKey = normalizeName(b);
  if (!aKey || !bKey) return null;
  const [first, second] = [aKey, bKey].sort();
  return `dm:${first}__${second}`;
};

const getInitials = (name) =>
  (name || '')
    .split(' ')
    .filter(Boolean)
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

const formatTime = (isoStr) => {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const now = new Date();
  const diffMs = now - d;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const ChatPage = ({ orgId }) => {
  const { employeeName } = useEmployee();
  const [activeChannel, setActiveChannel] = useState(null);
  const [channelMessages, setChannelMessages] = useState({});
  const [announcements, setAnnouncements] = useState([]);
  const [channelPreviews, setChannelPreviews] = useState({});
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [dmChannels, setDmChannels] = useState([]);
  const [showNewDmModal, setShowNewDmModal] = useState(false);
  const [dmSearchQuery, setDmSearchQuery] = useState('');
  const flatListRef = useRef(null);
  const pollRef = useRef(null);

  useEffect(() => {
    loadEmployees();
    fetchAnnouncements();
    // Web app sends direct messages using channel_id = `dm-${employee_name}` (no normalization)
    // so the mobile "Manager" channel should match that exact pattern.
    if (employeeName) {
      fetchChannelPreview(`dm-${employeeName}`);
    }
    fetchChannelPreview('group-kitchen');
    fetchDmThreads();

    pollRef.current = setInterval(() => {
      fetchAnnouncements();
      fetchDmThreads(false);
      if (activeChannel && activeChannel !== 'announcements') {
        fetchMessages(activeChannel, false);
      }
    }, 8000);
    return () => clearInterval(pollRef.current);
  }, []);

  // Re-fetch when switching channels
  useEffect(() => {
    if (!activeChannel) return;
    if (activeChannel === 'announcements') {
      fetchAnnouncements();
    } else {
      fetchMessages(activeChannel, true);
    }
  }, [activeChannel]);

  const loadEmployees = async () => {
    const { data } = await supabase
      .from('profiles')
      .select('employee_name, display_name')
      .eq('org_id', ORG_ID)
      .order('employee_name', { ascending: true });
    if (data) setEmployees(data);
  };

  const getDisplayNameForKey = (key) => {
    const match = employees.find(e => normalizeName(e.employee_name) === key);
    if (!match) return key;
    return (match.display_name || match.employee_name || key).trim() || key;
  };

  const fetchAnnouncements = async () => {
    const { data } = await supabase
      .from('announcements')
      .select('*')
      .eq('org_id', ORG_ID)
      .order('created_at', { ascending: true })
      .limit(80);
    if (data) {
      setAnnouncements(data);
      if (data.length > 0) {
        setChannelPreviews(prev => ({
          ...prev,
          announcements: data[data.length - 1].message,
        }));
      }
    }
  };

  const fetchMessages = async (channelId, showLoader = false) => {
    if (showLoader) setLoading(true);
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('org_id', ORG_ID)
      .eq('channel_id', channelId)
      .order('created_at', { ascending: true })
      .limit(100);
    if (data) {
      setChannelMessages(prev => ({ ...prev, [channelId]: data }));
      if (data.length > 0) {
        setChannelPreviews(prev => ({
          ...prev,
          [channelId]: data[data.length - 1].text,
        }));
      }
    }
    if (showLoader) setLoading(false);
  };

  const fetchChannelPreview = async (channelId) => {
    const { data } = await supabase
      .from('messages')
      .select('text')
      .eq('org_id', ORG_ID)
      .eq('channel_id', channelId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      setChannelPreviews(prev => ({ ...prev, [channelId]: data.text }));
    }
  };

  const fetchDmThreads = async (showLoader = false) => {
    if (!employeeName) return;
    const myKey = normalizeName(employeeName);
    if (showLoader) setLoading(true);
    const { data } = await supabase
      .from('messages')
      .select('channel_id, text, created_at')
      .eq('org_id', ORG_ID)
      .like('channel_id', 'dm:%')
      .order('created_at', { ascending: false });
    if (showLoader) setLoading(false);
    if (!data) return;

    const seen = new Set();
    const channels = [];

    for (const row of data) {
      const cid = row.channel_id;
      if (!cid || seen.has(cid)) continue;
      const raw = cid.startsWith('dm:') ? cid.slice(3) : cid;
      const parts = raw.split('__');
      if (parts.length !== 2) continue;
      const [aKey, bKey] = parts;
      if (aKey !== myKey && bKey !== myKey) continue;
      const otherKey = aKey === myKey ? bKey : aKey;
      const displayName = getDisplayNameForKey(otherKey);

      channels.push({
        id: cid,
        name: displayName,
        icon: 'person',
        iconColor: '#3182ce',
        iconBg: '#ebf8ff',
        preview: row.text,
        readOnly: false,
      });
      seen.add(cid);
    }

    setDmChannels(channels);
    setChannelPreviews(prev => {
      const next = { ...prev };
      channels.forEach(c => {
        next[c.id] = c.preview;
      });
      return next;
    });
  };

  const sendMessage = async () => {
    const text = inputText.trim();
    if (!text || sending) return;
    setInputText('');
    setSending(true);

    const optimistic = {
      id: `opt-${Date.now()}`,
      org_id: ORG_ID,
      channel_id: activeChannel,
      sender: employeeName,
      text,
      created_at: new Date().toISOString(),
    };
    setChannelMessages(prev => ({
      ...prev,
      [activeChannel]: [...(prev[activeChannel] || []), optimistic],
    }));
    scrollToBottom();

    const { error } = await supabase.from('messages').insert({
      org_id: ORG_ID,
      channel_id: activeChannel,
      sender: employeeName,
      text,
    });

    setSending(false);
    if (!error) {
      fetchMessages(activeChannel, false);
      setChannelPreviews(prev => ({ ...prev, [activeChannel]: text }));
    }
  };

  const scrollToBottom = () => {
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
  };

  // Must match the channel_id format used by the web app (dm-${employee_name})
  const myManagerDmId = employeeName ? `dm-${employeeName}` : 'dm-';

  const CHANNELS = [
    BASE_CHANNELS[0], // announcements
    {
      id: myManagerDmId,
      name: 'Manager',
      icon: 'person-circle',
      iconColor: '#4a6fa5',
      iconBg: '#ebf4ff',
      preview: 'Direct message',
      readOnly: false,
    },
    BASE_CHANNELS[1], // group-kitchen
  ];

  const allChannels = [...CHANNELS, ...dmChannels];
  const currentChannel =
    allChannels.find(c => c.id === activeChannel) || null;
  const currentMessages = activeChannel === 'announcements'
    ? announcements.map(a => ({
        id: a.id,
        sender: a.created_by || 'Manager',
        text: a.message,
        created_at: a.created_at,
      }))
    : channelMessages[activeChannel] || [];

  // ── Channel list ────────────────────────────────────────────────────────────
  if (!activeChannel) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Messages</Text>
          <TouchableOpacity
            style={styles.headerIconBtn}
            onPress={() => setShowNewDmModal(true)}
            activeOpacity={0.8}
          >
            <Ionicons name="add" size={24} color="#4CAF50" />
          </TouchableOpacity>
        </View>

        <FlatList
          data={allChannels}
          keyExtractor={c => c.id}
          contentContainerStyle={styles.channelList}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.channelRow}
              onPress={() => setActiveChannel(item.id)}
              activeOpacity={0.7}
            >
              <View style={[styles.channelIconBg, { backgroundColor: item.iconBg }]}>
                <Ionicons name={item.icon} size={22} color={item.iconColor} />
              </View>
              <View style={styles.channelInfo}>
                <View style={styles.channelNameRow}>
                  <Text style={styles.channelName}>{item.name}</Text>
                  {item.readOnly && (
                    <View style={styles.readOnlyBadge}>
                      <Text style={styles.readOnlyText}>View only</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.channelPreview} numberOfLines={1}>
                  {channelPreviews[item.id] || item.preview}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#cbd5e0" />
            </TouchableOpacity>
          )}
        />

        {/* New DM modal */}
        <Modal
          visible={showNewDmModal}
          transparent
          animationType="slide"
          onRequestClose={() => setShowNewDmModal(false)}
        >
          <TouchableOpacity
            style={styles.dmOverlay}
            activeOpacity={1}
            onPress={() => setShowNewDmModal(false)}
          >
            <TouchableOpacity
              activeOpacity={1}
              style={styles.dmSheet}
            >
              <View style={styles.dmHandle} />
              <Text style={styles.dmTitle}>New message</Text>
              <Text style={styles.dmSubtitle}>Select someone in the restaurant</Text>

              <View style={styles.dmSearchBarContainer}>
                <Ionicons name="search" size={18} color="#a0aec0" style={styles.dmSearchIcon} />
                <TextInput
                  style={styles.dmSearchInput}
                  placeholder="Search employees..."
                  placeholderTextColor="#a0aec0"
                  value={dmSearchQuery}
                  onChangeText={setDmSearchQuery}
                  autoCapitalize="none"
                />
              </View>

              <FlatList
                data={employees.filter(e => {
                  if (normalizeName(e.employee_name) === normalizeName(employeeName)) return false;
                  if (!dmSearchQuery.trim()) return true;
                  const query = dmSearchQuery.trim().toLowerCase();
                  const dName = (e.display_name || '').toLowerCase();
                  const eName = (e.employee_name || '').toLowerCase();
                  return dName.includes(query) || eName.includes(query);
                })}
                keyExtractor={(item) => item.employee_name}
                ItemSeparatorComponent={() => <View style={styles.dmSeparator} />}
                renderItem={({ item }) => {
                  const displayName = (item.display_name || item.employee_name || '').trim() || item.employee_name;
                  const initials = getInitials(displayName);
                  const handlePress = () => {
                    const channelId = buildDmChannelId(employeeName, item.employee_name);
                    if (!channelId) return;
                    const existing = dmChannels.find(c => c.id === channelId);
                    if (!existing) {
                      setDmChannels(prev => [
                        ...prev,
                        {
                          id: channelId,
                          name: displayName,
                          icon: 'person',
                          iconColor: '#3182ce',
                          iconBg: '#ebf8ff',
                          preview: 'Direct message',
                          readOnly: false,
                        },
                      ]);
                    }
                    setShowNewDmModal(false);
                    setActiveChannel(channelId);
                  };

                  return (
                    <TouchableOpacity
                      style={styles.dmRow}
                      onPress={handlePress}
                      activeOpacity={0.8}
                    >
                      <View style={styles.dmAvatar}>
                        <Text style={styles.dmAvatarText}>{initials}</Text>
                      </View>
                      <View style={styles.dmInfo}>
                        <Text style={styles.dmName}>{displayName}</Text>
                        <Text style={styles.dmHint}>Direct message</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color="#cbd5e0" />
                    </TouchableOpacity>
                  );
                }}
                ListEmptyComponent={
                  <View style={styles.dmEmpty}>
                    <Text style={styles.dmEmptyText}>No other employees found.</Text>
                  </View>
                }
              />

              <TouchableOpacity
                style={styles.dmCancel}
                onPress={() => setShowNewDmModal(false)}
              >
                <Text style={styles.dmCancelText}>Cancel</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      </View>
    );
  }

  // ── Chat view ───────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => setActiveChannel(null)} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="#2d3748" />
        </TouchableOpacity>
        <View style={[styles.chatHeaderIcon, { backgroundColor: currentChannel?.iconBg }]}>
          <Ionicons name={currentChannel?.icon} size={18} color={currentChannel?.iconColor} />
        </View>
        <Text style={styles.headerTitle}>{currentChannel?.name}</Text>
        {currentChannel?.readOnly && (
          <View style={styles.readOnlyBadge}>
            <Text style={styles.readOnlyText}>View only</Text>
          </View>
        )}
      </View>

      {/* Messages */}
      {loading ? (
        <ActivityIndicator color="#4CAF50" style={{ flex: 1 }} />
      ) : (
        <FlatList
          ref={flatListRef}
          data={currentMessages}
          keyExtractor={m => String(m.id)}
          contentContainerStyle={styles.messagesList}
          onContentSizeChange={scrollToBottom}
          ListEmptyComponent={
            <View style={styles.emptyChat}>
              <Ionicons name="chatbubbles-outline" size={40} color="#cbd5e0" />
              <Text style={styles.emptyChatText}>No messages yet</Text>
              {!currentChannel?.readOnly && (
                <Text style={styles.emptyChatSub}>Send the first message!</Text>
              )}
            </View>
          }
          renderItem={({ item }) => {
            const isMe = item.sender?.toLowerCase() === employeeName.toLowerCase();
            return (
              <View style={[styles.messageRow, isMe && styles.messageRowMe]}>
                {!isMe && (
                  <View style={styles.avatarCircle}>
                    <Text style={styles.avatarText}>
                      {(item.sender || '?').charAt(0).toUpperCase()}
                    </Text>
                  </View>
                )}
                <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]}>
                  {!isMe && (
                    <Text style={styles.bubbleSender}>{item.sender}</Text>
                  )}
                  <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>
                    {item.text}
                  </Text>
                  <Text style={[styles.bubbleTime, isMe && styles.bubbleTimeMe]}>
                    {formatTime(item.created_at)}
                  </Text>
                </View>
              </View>
            );
          }}
        />
      )}

      {/* Input bar */}
      {!currentChannel?.readOnly && (
        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            placeholder="Type a message…"
            placeholderTextColor="#a0aec0"
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={500}
            onSubmitEditing={sendMessage}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!inputText.trim() || sending) && styles.sendBtnDisabled]}
            onPress={sendMessage}
            disabled={!inputText.trim() || sending}
          >
            {sending
              ? <ActivityIndicator size="small" color="white" />
              : <Ionicons name="send" size={18} color="white" />
            }
          </TouchableOpacity>
        </View>
      )}

      {currentChannel?.readOnly && (
        <View style={styles.readOnlyBar}>
          <Ionicons name="lock-closed-outline" size={14} color="#a0aec0" style={{ marginRight: 6 }} />
          <Text style={styles.readOnlyBarText}>
            Announcements are posted by management
          </Text>
        </View>
      )}
    </KeyboardAvoidingView>
  );
};

export default ChatPage;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fa' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 16,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    gap: 10,
  },
  headerIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f0fff4',
  },
  backBtn: { marginRight: 2 },
  chatHeaderIcon: {
    width: 32, height: 32, borderRadius: 10,
    justifyContent: 'center', alignItems: 'center',
  },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '700', color: '#2d3748' },

  // Channel list
  channelList: { paddingVertical: 8 },
  channelRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 14,
    backgroundColor: 'white', gap: 14,
  },
  separator: { height: 1, backgroundColor: '#f0f0f0', marginLeft: 74 },
  channelIconBg: {
    width: 46, height: 46, borderRadius: 14,
    justifyContent: 'center', alignItems: 'center',
  },
  channelInfo: { flex: 1 },
  channelNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
  channelName: { fontSize: 16, fontWeight: '600', color: '#2d3748' },
  channelPreview: { fontSize: 13, color: '#a0aec0' },

  readOnlyBadge: {
    backgroundColor: '#f7fafc', borderWidth: 1, borderColor: '#e2e8f0',
    borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2,
  },
  readOnlyText: { fontSize: 11, color: '#a0aec0', fontWeight: '500' },

  // Messages
  messagesList: { padding: 16, paddingBottom: 8, flexGrow: 1 },
  emptyChat: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingTop: 80, gap: 8,
  },
  emptyChatText: { fontSize: 16, color: '#a0aec0', fontWeight: '600' },
  emptyChatSub: { fontSize: 13, color: '#cbd5e0' },

  messageRow: {
    flexDirection: 'row', alignItems: 'flex-end',
    marginBottom: 12, gap: 8,
  },
  messageRowMe: { flexDirection: 'row-reverse' },

  avatarCircle: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#4CAF50',
    justifyContent: 'center', alignItems: 'center',
    flexShrink: 0,
  },
  avatarText: { color: 'white', fontSize: 13, fontWeight: '700' },

  bubble: {
    maxWidth: '75%', borderRadius: 16, padding: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 2, elevation: 1,
  },
  bubbleMe: {
    backgroundColor: '#4CAF50', borderBottomRightRadius: 4,
  },
  bubbleThem: {
    backgroundColor: 'white', borderBottomLeftRadius: 4,
  },
  bubbleSender: { fontSize: 11, fontWeight: '700', color: '#4a5568', marginBottom: 3 },
  bubbleText: { fontSize: 14, color: '#2d3748', lineHeight: 20 },
  bubbleTextMe: { color: 'white' },
  bubbleTime: { fontSize: 10, color: '#a0aec0', marginTop: 4, textAlign: 'right' },
  bubbleTimeMe: { color: 'rgba(255,255,255,0.75)' },

  // Input bar
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: 'white', borderTopWidth: 1, borderTopColor: '#e2e8f0',
  },
  input: {
    flex: 1, backgroundColor: '#f7fafc',
    borderWidth: 1.5, borderColor: '#e2e8f0', borderRadius: 22,
    paddingHorizontal: 16, paddingVertical: 10,
    fontSize: 15, color: '#2d3748', maxHeight: 100,
  },
  sendBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: '#4CAF50',
    justifyContent: 'center', alignItems: 'center',
  },
  sendBtnDisabled: { backgroundColor: '#c6f6d5' },

  readOnlyBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 12, backgroundColor: '#f7fafc',
    borderTopWidth: 1, borderTopColor: '#e2e8f0',
  },
  readOnlyBarText: { fontSize: 13, color: '#a0aec0' },

  // New DM modal
  dmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  dmSheet: {
    backgroundColor: 'white',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 24,
    maxHeight: '70%',
  },
  dmHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#e2e8f0',
    alignSelf: 'center',
    marginBottom: 12,
  },
  dmTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2d3748',
    textAlign: 'center',
  },
  dmSubtitle: {
    fontSize: 13,
    color: '#718096',
    textAlign: 'center',
    marginBottom: 12,
  },
  dmSearchBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f7fafc',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 10,
    marginBottom: 16,
  },
  dmSearchIcon: {
    marginRight: 8,
  },
  dmSearchInput: {
    flex: 1,
    height: 38,
    fontSize: 15,
    color: '#2d3748',
  },
  dmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  dmSeparator: {
    height: 1,
    backgroundColor: '#f1f5f9',
  },
  dmAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#ebf8ff',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  dmAvatarText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#3182ce',
  },
  dmInfo: {
    flex: 1,
  },
  dmName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#2d3748',
  },
  dmHint: {
    fontSize: 12,
    color: '#a0aec0',
  },
  dmEmpty: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  dmEmptyText: {
    fontSize: 13,
    color: '#a0aec0',
  },
  dmCancel: {
    marginTop: 12,
    alignItems: 'center',
  },
  dmCancelText: {
    fontSize: 15,
    color: '#718096',
    fontWeight: '500',
  },
});
