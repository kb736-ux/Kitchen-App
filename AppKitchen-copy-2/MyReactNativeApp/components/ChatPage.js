import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator, SafeAreaView, Modal, Alert, Image, Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase, ORG_ID } from '../utils/supabase';
import { useEmployee } from '../EmployeeContext';
import { Colors } from '../constants/theme';

const BASE_CHANNELS = [
  {
    id: 'announcements',
    name: 'Announcements',
    icon: 'megaphone',
    iconColor: '#d97706',
    iconBg: '#fffbeb',
    preview: 'Public channel',
    readOnly: false,
  },
];

const normalizeName = (name) => (name || '').trim().toLowerCase();
const normalizeLoose = (name) => normalizeName(name).replace(/[^a-z0-9]/g, '');
const normalizeId = (value) => String(value || '').trim().toLowerCase();
const localPart = (value) => String(value || '').split('@')[0].trim();
const buildPersonName = (row) => {
  const first = (row?.first_name || '').trim();
  const last = (row?.last_name || '').trim();
  return [first, last].filter(Boolean).join(' ').trim();
};
const toCanonicalSenderName = (row, fallback = '') =>
  (
    buildPersonName(row) ||
    localPart(row?.email) ||
    fallback
  ).trim();
/** One row per profiles.id — no merged "alias" employees or name-only deduping. */
const dedupeEmployeesByProfileId = (rows) => {
  const byId = new Map();
  (rows || []).forEach((row) => {
    if (!row?.id) return;
    const k = normalizeId(row.id);
    if (!byId.has(k)) byId.set(k, row);
  });
  return Array.from(byId.values());
};

const buildSortedDmChannelId = (idA, idB) => {
  if (!idA || !idB) return null;
  const a = String(idA).trim().toLowerCase();
  const b = String(idB).trim().toLowerCase();
  return a < b ? `dm:${a}:${b}` : `dm:${b}:${a}`;
};

const parseDmParticipant = (channelId, myIds) => {
  if (!channelId || !channelId.startsWith('dm:')) return null;
  const rest = channelId.slice(3);
  const idx = rest.indexOf(':');
  if (idx < 0) return null;
  const a = rest.slice(0, idx);
  const b = rest.slice(idx + 1);
  if (!a || !b) return null;
  const aIsMe = myIds.has(normalizeId(a));
  const bIsMe = myIds.has(normalizeId(b));
  if (!aIsMe && !bIsMe) return null;
  return aIsMe ? normalizeId(b) : normalizeId(a);
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
  const { employeeName, displayName, employeeId, firstName, lastName, email } = useEmployee();
  const activeOrgId = orgId || ORG_ID;
  const myPreferredName = [firstName, lastName].filter(Boolean).join(' ').trim() || displayName || employeeName;
  const myLocalPart = localPart(email);
  const [activeChannel, setActiveChannel] = useState(null);
  const [channelMessages, setChannelMessages] = useState({});
  const [announcements, setAnnouncements] = useState([]);
  const [channelPreviews, setChannelPreviews] = useState({});
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [dmChannels, setDmChannels] = useState([]);
  const [dmParticipantByChannel, setDmParticipantByChannel] = useState({});
  const [showNewDmModal, setShowNewDmModal] = useState(false);
  const [dmSearchQuery, setDmSearchQuery] = useState('');
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [channelLastTs, setChannelLastTs] = useState({});
  const [channelSeenTs, setChannelSeenTs] = useState({});
  const [channelLastSenderId, setChannelLastSenderId] = useState({});
  const flatListRef = useRef(null);
  const pollRef = useRef(null);
  const myProfileIdsRef = useRef(new Set());
  const employeesRef = useRef([]);
  const activeChannelRef = useRef(null);
  const [authUserId, setAuthUserId] = useState(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (!mounted) return;
        setAuthUserId(data?.user?.id || null);
      } catch (_) {
        if (!mounted) return;
        setAuthUserId(null);
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => { employeesRef.current = employees; }, [employees]);
  useEffect(() => { activeChannelRef.current = activeChannel; }, [activeChannel]);

  useEffect(() => {
    if (!employeeName) return;
    (async () => {
      const list = await loadEmployees();
      fetchAnnouncements();
      if (list) fetchDmThreads(false, list);
      else fetchDmThreads();
    })();

    pollRef.current = setInterval(() => {
      fetchAnnouncements();
      fetchDmThreads(false);
      const ch = activeChannelRef.current;
      if (ch && ch !== 'announcements') {
        fetchMessages(ch, false);
      }
    }, 8000);
    return () => clearInterval(pollRef.current);
  }, [employeeName, displayName, employeeId, firstName, lastName, email]);

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
    if (!activeOrgId) {
      setEmployees([]);
      return [];
    }
    const safeRows = async (query) => {
      try {
        const { data, error } = await query;
        if (error) return { rows: [], error };
        return { rows: Array.isArray(data) ? data : (data ? [data] : []), error: null };
      } catch (error) {
        return { rows: [], error };
      }
    };

    // Schema-safe profile fetch: falls back when first_name/last_name are not present yet.
    let profileRes = await safeRows(
      supabase
        .from('profiles')
        .select('id, user_id, employee_name, display_name, first_name, last_name, email, avatar_url')
        .eq('org_id', activeOrgId)
    );
    if (profileRes.error) {
      console.warn('[Chat] loadEmployees profiles query error:', profileRes.error.message || profileRes.error);
    } else {
      const n = (profileRes.rows || []).length;
      if (__DEV__) console.log('[Chat] loadEmployees profiles count:', n, 'org:', activeOrgId);
    }
    if ((profileRes.rows || []).length === 0 && profileRes.error) {
      const msg = String(profileRes.error?.message || '').toLowerCase();
      if (msg.includes('first_name') || msg.includes('last_name')) {
        profileRes = await safeRows(
          supabase
            .from('profiles')
            .select('id, user_id, employee_name, display_name, email, avatar_url')
            .eq('org_id', activeOrgId)
        );
        profileRes.rows = (profileRes.rows || []).map((p) => ({
          ...p,
          first_name: '',
          last_name: '',
        }));
      }
    }

    const [adminRes] = await Promise.all([
      safeRows(
        supabase
          .from('admin_profiles')
          .select('user_id, first_name, last_name, display_name, avatar_url')
      ),
    ]);

    const profiles = profileRes.rows || [];
    const admins = adminRes.rows || [];

    const adminByUserId = {};
    const adminByDisplayName = {};
    (admins || []).forEach((a) => {
      if (a?.user_id) adminByUserId[a.user_id] = a;
      const dn = (a?.display_name || '').trim();
      const fn = (a?.first_name || '').trim();
      const ln = (a?.last_name || '').trim();
      const combined = [fn, ln].filter(Boolean).join(' ');
      if (dn) adminByDisplayName[normalizeName(dn)] = a;
      if (combined) adminByDisplayName[normalizeName(combined)] = a;
    });

    const listFromProfiles = (profiles || [])
      .filter((p) => !!p.id)
      .map((p) => {
        // admin_profiles is keyed by auth user_id, not profiles.id
        const adminProfile = adminByUserId[p.user_id] || null;
        const profileFullName = buildPersonName(p);
        const adminFullName = buildPersonName(adminProfile || {});
        const displayName =
          adminFullName ||
          (adminProfile?.display_name || '').trim() ||
          profileFullName ||
          p.employee_name;
        const adminByDisplay = adminByDisplayName[normalizeName(displayName)] || adminByDisplayName[normalizeName(p.employee_name || '')];
        const avatarUrl = adminProfile?.avatar_url || p.avatar_url || adminByDisplay?.avatar_url || null;
        return {
          id: p.id,
          user_id: p.user_id || adminProfile?.user_id || null,
          employee_name: p.employee_name,
          first_name: p.first_name || '',
          last_name: p.last_name || '',
          email: p.email || '',
          display_name: displayName,
          avatar_url: avatarUrl,
        };
      });

    let list = dedupeEmployeesByProfileId(listFromProfiles)
      .filter((e) => !!e?.id)
      .sort((a, b) =>
      (a.display_name || a.employee_name || '').localeCompare(
        b.display_name || b.employee_name || '',
        undefined,
        { sensitivity: 'base' }
      )
    );

    if (__DEV__) {
      const withAvatar = list.filter(e => !!e.avatar_url);
      console.log('[Chat] loadEmployees final:', list.length, 'employees,', withAvatar.length, 'with avatar_url');
      if (list.length > 0) console.log('[Chat] sample employee:', JSON.stringify({ id: list[0].id, display_name: list[0].display_name, avatar_url: list[0].avatar_url }));
    }
    setEmployees(list);
    return list;
  };

  const resolveProfileDisplayNameById = (id, fallback = '') => {
    const hit = resolveEmployeeById(id);
    return (buildPersonName(hit) || fallback).trim();
  };

  const getDisplayNameForKey = (key) => {
    const match = employees.find(e => normalizeName(e.employee_name) === key || normalizeName(e.display_name) === key);
    if (!match) return key;
    return (match.display_name || match.employee_name || key).trim() || key;
  };

  const resolveEmployeeByAny = (raw) => {
    const key = normalizeName(raw);
    const looseKey = normalizeLoose(raw);
    if (!key) return null;
    return employees.find(e =>
      normalizeName(e.employee_name) === key ||
      normalizeName(e.display_name) === key ||
      normalizeName(buildPersonName(e)) === key ||
      normalizeLoose(e.employee_name) === looseKey ||
      normalizeLoose(e.display_name) === looseKey ||
      normalizeLoose(buildPersonName(e)) === looseKey
    ) || null;
  };

  const resolveEmployeeById = (id) => {
    if (!id) return null;
    const normalized = normalizeId(id);
    return employees.find((e) => {
      if (normalizeId(e.id) === normalized) return true;
      if (normalizeId(e.user_id) === normalized) return true;
      return false;
    }) || null;
  };

  const resolveCurrentSenderForWrite = async () => {
    // Enforce UUID/profile-backed identity for writes.
    let senderId = employeeId || null;
    let senderName = '';
    const byKnownId = resolveEmployeeById(senderId);
    if (byKnownId) {
      senderId = senderId || byKnownId.id || null;
      senderName = toCanonicalSenderName(byKnownId, senderName);
    }

    try {
      const { data: authData } = await supabase.auth.getUser();
      const user = authData?.user || null;
      const userId = user?.id || null;
      const userEmail = String(user?.email || email || '').trim().toLowerCase();
      const makeProfileQuery = () =>
        supabase
          .from('profiles')
          .select('id, user_id, org_id, employee_name, display_name, first_name, last_name, email')
          .limit(10);
      const pickBestProfile = (rows) => {
        const arr = Array.isArray(rows) ? rows.filter(Boolean) : [];
        if (!arr.length) return null;
        const orgKey = normalizeId(activeOrgId);
        const score = (r) => {
          let s = 0;
          if (normalizeId(r?.org_id) === orgKey) s += 50;
          if ((r?.first_name || '').trim()) s += 10;
          if ((r?.last_name || '').trim()) s += 10;
          if ((r?.display_name || '').trim()) s += 6;
          if ((r?.employee_name || '').trim()) s += 4;
          if ((r?.email || '').trim()) s += 2;
          return s;
        };
        return arr.sort((a, b) => score(b) - score(a))[0] || arr[0];
      };
      const queryOne = async (query) => {
        try {
          const { data, error } = await query;
          if (error) return null;
          return pickBestProfile(data);
        } catch (_) {
          return null;
        }
      };
      let profileHit = null;
      if (activeOrgId && userId) {
        profileHit = await queryOne(makeProfileQuery().eq('org_id', activeOrgId).eq('user_id', userId));
      }
      if (!profileHit && userId) {
        profileHit = await queryOne(makeProfileQuery().eq('user_id', userId));
      }
      if (!profileHit && activeOrgId && userEmail) {
        profileHit = await queryOne(makeProfileQuery().eq('org_id', activeOrgId).ilike('email', userEmail));
      }
      if (!profileHit && userEmail) {
        profileHit = await queryOne(makeProfileQuery().ilike('email', userEmail));
      }
      if (!profileHit && senderId && activeOrgId) {
        profileHit = await queryOne(makeProfileQuery().eq('org_id', activeOrgId).eq('id', senderId));
      }
      if (!profileHit && senderId) {
        profileHit = await queryOne(makeProfileQuery().eq('id', senderId));
      }
      if (!profileHit && senderId && activeOrgId) {
        profileHit = await queryOne(makeProfileQuery().eq('org_id', activeOrgId).eq('user_id', senderId));
      }
      if (!profileHit && senderId) {
        profileHit = await queryOne(makeProfileQuery().eq('user_id', senderId));
      }
      if (!profileHit && activeOrgId && userId) {
        const first = (firstName || '').trim();
        const last = (lastName || '').trim();
        const fallbackDisplay = [first, last].filter(Boolean).join(' ').trim() || (displayName || '').trim() || (employeeName || '').trim();
        const fallbackEmployee = (employeeName || fallbackDisplay || '').trim();
        const payload = {
          org_id: activeOrgId,
          user_id: userId,
          email: userEmail || null,
          first_name: first || null,
          last_name: last || null,
          display_name: fallbackDisplay || null,
          employee_name: fallbackEmployee || null,
        };
        try {
          await supabase
            .from('profiles')
            .insert(payload);
        } catch (_) {}
        profileHit = await queryOne(makeProfileQuery().eq('org_id', activeOrgId).eq('user_id', userId));
      }
      if (profileHit) {
        senderId = profileHit.id || senderId;
        senderName = toCanonicalSenderName(profileHit, senderName);
      }
    } catch (_) {
      // Keep current resolved values.
    }

    return {
      senderId: senderId || null,
      senderName: (senderName || '').trim(),
    };
  };

  const fetchAnnouncements = async () => {
    if (!activeOrgId) return;
    const { data } = await supabase
      .from('announcements')
      .select('*')
      .eq('org_id', activeOrgId)
      .order('created_at', { ascending: true })
      .limit(80);
    if (data) {
      setAnnouncements(data);
      if (data.length > 0) {
        const latest = data[data.length - 1];
        setChannelPreviews(prev => ({
          ...prev,
          announcements: latest.message,
        }));
        setChannelLastTs(prev => ({ ...prev, announcements: latest.created_at || prev.announcements || null }));
      }
    }
  };

  const fetchMessages = async (channelId, showLoader = false) => {
    if (!activeOrgId) return;
    if (channelId.startsWith('dm:')) {
      if (showLoader) setLoading(true);
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('org_id', activeOrgId)
        .eq('channel_id', channelId)
        .order('created_at', { ascending: true })
        .limit(200);
      if (data) {
        setChannelMessages(prev => ({ ...prev, [channelId]: data }));
        if (data.length > 0) {
          const latest = data[data.length - 1];
          setChannelPreviews(prev => ({ ...prev, [channelId]: latest.text }));
          setChannelLastTs(prev => ({ ...prev, [channelId]: latest.created_at || prev[channelId] || null }));
          setChannelLastSenderId(prev => ({ ...prev, [channelId]: normalizeId(latest.employee_id) }));
        }
      }
      if (showLoader) setLoading(false);
      return;
    }
    if (showLoader) setLoading(true);
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('org_id', activeOrgId)
      .eq('channel_id', channelId)
      .order('created_at', { ascending: true })
      .limit(100);
    if (data) {
      setChannelMessages(prev => ({ ...prev, [channelId]: data }));
      if (data.length > 0) {
        const latest = data[data.length - 1];
        setChannelPreviews(prev => ({
          ...prev,
          [channelId]: latest.text,
        }));
        setChannelLastTs(prev => ({ ...prev, [channelId]: latest.created_at || prev[channelId] || null }));
        setChannelLastSenderId(prev => ({ ...prev, [channelId]: normalizeId(latest.employee_id) }));
      }
    }
    if (showLoader) setLoading(false);
  };

  const fetchChannelPreview = async (channelId) => {
    if (!activeOrgId) return;
    const { data } = await supabase
      .from('messages')
      .select('text')
      .eq('org_id', activeOrgId)
      .eq('channel_id', channelId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      setChannelPreviews(prev => ({ ...prev, [channelId]: data.text }));
    }
  };

  const fetchDmThreads = async (showLoader = false, employeesOverride = null) => {
    if (!employeeName || !activeOrgId) return;
    const empList = employeesOverride ?? employeesRef.current ?? employees;
    const resolveById = (id) => {
      const normalized = normalizeId(id);
      if (!normalized) return null;
      return empList.find((e) => {
        if (normalizeId(e.id) === normalized) return true;
        if (normalizeId(e.user_id) === normalized) return true;
        return false;
      }) || null;
    };
    const myProfileIds = new Set(
      empList
        .filter((e) =>
          (!!employeeId && normalizeId(e.id) === normalizeId(employeeId)) ||
          (!!authUserId && normalizeId(e.user_id) === normalizeId(authUserId))
        )
        .flatMap((e) => [e.id, e.user_id].filter(Boolean))
        .map(normalizeId)
        .filter(Boolean)
    );
    if (employeeId) myProfileIds.add(normalizeId(employeeId));
    if (authUserId) myProfileIds.add(normalizeId(authUserId));
    if (showLoader) setLoading(true);
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('org_id', activeOrgId)
      .order('created_at', { ascending: false });
    if (showLoader) setLoading(false);
    if (!data) return;

    const channelById = new Map();
    const participantMap = {};
    const latestByChannel = {};
    const latestSenderByChannel = {};

    for (const row of data) {
      const cid = row.channel_id;
      if (!cid) continue;
      if (cid.startsWith('dm:') && cid.indexOf(':', 3) > 3) {
        const participantId = parseDmParticipant(cid, myProfileIds);
        if (!participantId) continue;
        const resolvedProfile = resolveById(participantId);
        if (!resolvedProfile?.id) continue;
        participantMap[cid] = normalizeId(resolvedProfile.id);
        if (!channelById.has(cid)) {
          const resolvedName = (
            buildPersonName(resolvedProfile) ||
            resolvedProfile?.employee_name ||
            'Direct Message'
          ).trim();
          channelById.set(cid, {
            id: cid,
            name: resolvedName,
            avatarUrl: resolvedProfile?.avatar_url || null,
            icon: 'person',
            iconColor: '#3182ce',
            iconBg: '#ebf8ff',
            preview: row.text,
            readOnly: false,
          });
          latestSenderByChannel[cid] = normalizeId(row.employee_id);
        }
        latestByChannel[cid] = latestByChannel[cid] || row.created_at || null;
      }
    }

    const channels = Array.from(channelById.values());
    myProfileIdsRef.current = myProfileIds;
    setDmChannels(channels);
    setDmParticipantByChannel(participantMap);
    setChannelPreviews(prev => {
      const next = { ...prev };
      channels.forEach(c => { next[c.id] = c.preview; });
      return next;
    });
    setChannelLastTs(prev => ({ ...prev, ...latestByChannel }));
    setChannelLastSenderId(prev => ({ ...prev, ...latestSenderByChannel }));
  };

  const sendMessage = async () => {
    if (!activeOrgId) {
      Alert.alert('Missing org', 'Could not resolve restaurant. Please reopen the app.');
      return;
    }
    const text = inputText.trim();
    if (!text || sending) return;
    const senderIdentity = await resolveCurrentSenderForWrite();
    const writeSenderName = senderIdentity.senderName;
    const writeSenderId = senderIdentity.senderId;
    if (!writeSenderId || !writeSenderName) {
      Alert.alert('Profile sync required', 'Unable to resolve your UUID-backed profile. Please reopen the app and try again.');
      return;
    }
    setInputText('');
    setSending(true);

    if (activeChannel === 'announcements') {
      const optimisticAnnouncement = {
        id: `opt-ann-${Date.now()}`,
        org_id: activeOrgId,
        message: text,
        created_by: writeSenderName,
        created_by_id: writeSenderId || null,
        created_at: new Date().toISOString(),
      };
      setAnnouncements(prev => [...prev, optimisticAnnouncement]);
      setChannelPreviews(prev => ({ ...prev, announcements: text }));
      scrollToBottom();

      let { error } = await supabase.from('announcements').insert({
        org_id: activeOrgId,
        message: text,
        created_by: writeSenderName,
        created_by_id: writeSenderId || null,
      });
      if (error && /created_by_id/i.test(error.message || '')) {
        const fallback = await supabase.from('announcements').insert({
          org_id: activeOrgId,
          message: text,
          created_by: writeSenderName,
        });
        error = fallback.error;
      }

      setSending(false);
      if (!error) {
        fetchAnnouncements();
      } else {
        // Keep a visible local record instead of "disappearing instantly"
        // so the sender can see that send failed and retry.
        setAnnouncements(prev =>
          prev.map(a =>
            a.id === optimisticAnnouncement.id
              ? { ...a, message: `${a.message} (failed to send)` }
              : a
          )
        );
        Alert.alert('Send failed', error.message || 'Could not post announcement.');
      }
      return;
    }

    const insertChannelId = activeChannel;

    const optimistic = {
      id: `opt-${Date.now()}`,
      org_id: activeOrgId,
      channel_id: insertChannelId,
      sender: writeSenderName,
      employee_id: writeSenderId || undefined,
      text,
      created_at: new Date().toISOString(),
    };
    setChannelMessages(prev => ({
      ...prev,
      [activeChannel]: [...(prev[activeChannel] || []), optimistic],
    }));
    scrollToBottom();

    const { error } = await supabase.from('messages').insert({
      org_id: activeOrgId,
      channel_id: insertChannelId,
      sender: writeSenderName,
      employee_id: writeSenderId || undefined,
      text,
    });

    setSending(false);
    if (!error) {
      fetchMessages(activeChannel, false);
      setChannelPreviews(prev => ({ ...prev, [activeChannel]: text }));
      setChannelSeenTs(prev => ({ ...prev, [activeChannel]: new Date().toISOString() }));
    } else {
      Alert.alert('Send failed', error.message || 'Could not send message.');
    }
  };

  const scrollToBottom = () => {
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const CHANNELS = [
    BASE_CHANNELS[0], // announcements
  ];

  const allChannels = [...CHANNELS, ...dmChannels];
  const hasUnreadChannel = (channelId) => {
    const last = Date.parse(channelLastTs[channelId] || '');
    if (Number.isNaN(last)) return false;

    const lastSender = channelLastSenderId[channelId] || '';
    const myIds = myProfileIdsRef.current || new Set();
    if (lastSender && myIds.has(lastSender)) return false;

    const seen = Date.parse(channelSeenTs[channelId] || '');
    if (Number.isNaN(seen)) return true;
    return last > seen;
  };

  const filteredChannels = allChannels.filter((c) => {
    if (!chatSearchQuery.trim()) return true;
    const q = chatSearchQuery.trim().toLowerCase();
    const name = (c.name || '').toLowerCase();
    const preview = (channelPreviews[c.id] || c.preview || '').toLowerCase();
    return name.includes(q) || preview.includes(q);
  }).sort((a, b) => {
    const aUnread = hasUnreadChannel(a.id) ? 1 : 0;
    const bUnread = hasUnreadChannel(b.id) ? 1 : 0;
    if (aUnread !== bUnread) return bUnread - aUnread;
    const aTs = Date.parse(channelLastTs[a.id] || '');
    const bTs = Date.parse(channelLastTs[b.id] || '');
    const av = Number.isNaN(aTs) ? 0 : aTs;
    const bv = Number.isNaN(bTs) ? 0 : bTs;
    return bv - av;
  });
  const currentChannel =
    allChannels.find(c => c.id === activeChannel) || null;
  const enrichedCurrentChannel = (() => {
    if (!currentChannel) return null;
    if (!currentChannel.id?.startsWith('dm:')) return currentChannel;
    const identity = parseDmParticipant(currentChannel.id, myProfileIdsRef.current || new Set());
    if (!identity) return currentChannel;
    const hit = resolveEmployeeById(identity);
    if (!hit) return currentChannel;
    const resolvedName = (
      buildPersonName(hit) ||
      hit.employee_name ||
      hit.display_name ||
      currentChannel.name ||
      'Direct Message'
    ).trim();
    const resolvedAvatar = hit.avatar_url || currentChannel.avatarUrl || null;
    return { ...currentChannel, name: resolvedName, avatarUrl: resolvedAvatar };
  })();
  const currentMessages = activeChannel === 'announcements'
    ? announcements.map(a => {
        const byId = resolveEmployeeById(a.created_by_id);
        const byName = !byId ? resolveEmployeeByAny(a.created_by) : null;
        const profile = byId || byName || null;
        return {
          id: a.id,
          sender: buildPersonName(profile) || (a.created_by || '').trim() || 'Unknown user',
          employee_id: a.created_by_id || null,
          avatar_url: profile?.avatar_url || null,
          text: a.message || a.text || '',
          created_at: a.created_at || a.updated_at || new Date().toISOString(),
        };
      })
    : channelMessages[activeChannel] || [];

  useEffect(() => {
    if (!activeChannel) return;
    setChannelSeenTs(prev => ({ ...prev, [activeChannel]: new Date().toISOString() }));
  }, [activeChannel]);

  // ── Channel list ────────────────────────────────────────────────────────────
  if (!activeChannel) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Messages</Text>
          <TouchableOpacity
            style={styles.headerIconBtn}
            onPress={async () => {
              setDmSearchQuery('');
              await loadEmployees();
              setShowNewDmModal(true);
            }}
            activeOpacity={0.8}
          >
            <Ionicons name="add" size={24} color={Colors.primary} />
          </TouchableOpacity>
        </View>

        <View style={styles.chatSearchBarContainer}>
          <Ionicons name="search" size={18} color="#a0aec0" style={styles.chatSearchIcon} />
          <TextInput
            style={styles.chatSearchInput}
            placeholder="Search chats..."
            placeholderTextColor="#a0aec0"
            value={chatSearchQuery}
            onChangeText={setChatSearchQuery}
            autoCapitalize="none"
          />
        </View>

        <FlatList
          data={filteredChannels}
          keyExtractor={c => c.id}
          contentContainerStyle={styles.channelList}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.channelRow}
              onPress={() => setActiveChannel(item.id)}
              activeOpacity={0.7}
            >
              {item.avatarUrl ? (
                <Image source={{ uri: item.avatarUrl }} style={styles.channelAvatarImage} />
              ) : (
                <View style={[styles.channelIconBg, { backgroundColor: item.iconBg }]}>
                  <Ionicons name={item.icon} size={22} color={item.iconColor} />
                </View>
              )}
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
              {hasUnreadChannel(item.id) && <View style={styles.channelUnreadDot} />}
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
          <KeyboardAvoidingView
            style={styles.dmKeyboardWrap}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 24 : 0}
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
                data={dedupeEmployeesByProfileId(employees).filter(e => {
                  // For DM selection, show only UUID-linked users when available.
                  if (!e?.id) return false;
                  const currentNames = new Set([
                    normalizeName(employeeName),
                    normalizeName(displayName),
                  ].filter(Boolean));
                  const rowName = buildPersonName(e);
                  if ((employeeId && e.id === employeeId) || currentNames.has(normalizeName(rowName)) || currentNames.has(normalizeName(e.employee_name))) return false;
                  if (!dmSearchQuery.trim()) return true;
                  const query = dmSearchQuery.trim().toLowerCase();
                  const dName = buildPersonName(e).toLowerCase();
                  const eName = (e.employee_name || '').toLowerCase();
                  return dName.includes(query) || eName.includes(query);
                })}
                keyExtractor={(item) => item.id || `name:${normalizeName(buildPersonName(item) || item.employee_name || item.display_name)}`}
                ItemSeparatorComponent={() => <View style={styles.dmSeparator} />}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
                onScrollBeginDrag={Keyboard.dismiss}
                renderItem={({ item }) => {
                  const displayName = buildPersonName(item) || item.employee_name;
                  const initials = getInitials(displayName);
                  const handlePress = () => {
                    if (!item.id) {
                      Alert.alert(
                        'Profile not ready',
                        `${displayName} needs to sign in once before direct messaging is available.`
                      );
                      return;
                    }
                    if (!employeeId) {
                      Alert.alert('Profile sync required', 'Your profile is not loaded. Please reopen the app.');
                      return;
                    }
                    const channelId = buildSortedDmChannelId(employeeId, item.id);
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
                          avatarUrl: item.avatar_url || null,
                          preview: 'Direct message',
                          readOnly: false,
                        },
                      ]);
                      setDmParticipantByChannel(prev => ({ ...prev, [channelId]: normalizeId(item.id) }));
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
                      {item.avatar_url ? (
                        <Image source={{ uri: item.avatar_url }} style={styles.dmAvatarImage} />
                      ) : (
                        <View style={styles.dmAvatar}>
                          <Text style={styles.dmAvatarText}>{initials}</Text>
                        </View>
                      )}
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
          </KeyboardAvoidingView>
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
        {enrichedCurrentChannel?.avatarUrl ? (
          <Image source={{ uri: enrichedCurrentChannel.avatarUrl }} style={styles.chatHeaderAvatar} />
        ) : (
          <View style={[styles.chatHeaderIcon, { backgroundColor: enrichedCurrentChannel?.iconBg }]}>
            <Ionicons name={enrichedCurrentChannel?.icon} size={18} color={enrichedCurrentChannel?.iconColor} />
          </View>
        )}
        <Text style={styles.headerTitle}>{enrichedCurrentChannel?.name}</Text>
        {enrichedCurrentChannel?.readOnly && (
          <View style={styles.readOnlyBadge}>
            <Text style={styles.readOnlyText}>View only</Text>
          </View>
        )}
      </View>

      {/* Messages */}
      {loading ? (
        <ActivityIndicator color={Colors.primary} style={{ flex: 1 }} />
      ) : (
        <FlatList
          ref={flatListRef}
          data={currentMessages}
          keyExtractor={m => String(m.id)}
          contentContainerStyle={styles.messagesList}
          onContentSizeChange={scrollToBottom}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          onScrollBeginDrag={Keyboard.dismiss}
          ListEmptyComponent={
            <View style={styles.emptyChat}>
              <Ionicons name="chatbubbles-outline" size={40} color="#cbd5e0" />
              <Text style={styles.emptyChatText}>No messages yet</Text>
              {!enrichedCurrentChannel?.readOnly && (
                <Text style={styles.emptyChatSub}>Send the first message!</Text>
              )}
            </View>
          }
          renderItem={({ item }) => {
            const senderById = resolveEmployeeById(item.employee_id);
            const senderByName = !senderById ? resolveEmployeeByAny(item.sender) : null;
            const senderProfile = senderById || senderByName || null;
            const isMe =
              (!!item.employee_id && !!employeeId && item.employee_id === employeeId) ||
              (!!senderProfile?.id && !!employeeId && senderProfile.id === employeeId);
            const senderLabel = isMe
              ? 'You'
              : (
                buildPersonName(senderProfile) ||
                (item.sender || '').trim() ||
                'Unknown user'
              );
            const senderAvatarUrl = item?.avatar_url || senderProfile?.avatar_url || null;
            return (
              <View style={[styles.messageRow, isMe && styles.messageRowMe]}>
                {!isMe && (
                  senderAvatarUrl ? (
                    <Image source={{ uri: senderAvatarUrl }} style={styles.avatarImage} />
                  ) : (
                    <View style={styles.avatarCircle}>
                      <Text style={styles.avatarText}>
                        {(senderLabel || '?').charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  )
                )}
                <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]}>
                  {!isMe && (
                    <Text style={styles.bubbleSender}>{senderLabel}</Text>
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
      {!enrichedCurrentChannel?.readOnly && (
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

      {enrichedCurrentChannel?.readOnly && (
        <View style={styles.readOnlyBar}>
          <Ionicons name="lock-closed-outline" size={14} color="#a0aec0" style={{ marginRight: 6 }} />
          <Text style={styles.readOnlyBarText}>
            View only channel
          </Text>
        </View>
      )}
    </KeyboardAvoidingView>
  );
};

export default ChatPage;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },

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
    backgroundColor: Colors.primarySoft,
  },
  backBtn: { marginRight: 2 },
  chatHeaderIcon: {
    width: 32, height: 32, borderRadius: 10,
    justifyContent: 'center', alignItems: 'center',
  },
  chatHeaderAvatar: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: '#edf2f7',
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
  channelAvatarImage: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: '#edf2f7',
  },
  channelInfo: { flex: 1 },
  channelNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
  channelName: { fontSize: 16, fontWeight: '600', color: '#2d3748' },
  channelPreview: { fontSize: 13, color: '#a0aec0' },
  channelUnreadDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: '#3182ce',
    marginRight: 6,
  },

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
    backgroundColor: Colors.primary,
    justifyContent: 'center', alignItems: 'center',
    flexShrink: 0,
  },
  avatarImage: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#edf2f7',
    flexShrink: 0,
  },
  avatarText: { color: 'white', fontSize: 13, fontWeight: '700' },

  bubble: {
    maxWidth: '75%', borderRadius: 16, padding: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 2, elevation: 1,
  },
  bubbleMe: {
    backgroundColor: Colors.primary, borderBottomRightRadius: 4,
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
    backgroundColor: Colors.primary,
    justifyContent: 'center', alignItems: 'center',
  },
  sendBtnDisabled: { backgroundColor: Colors.successSoft },

  readOnlyBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 12, backgroundColor: '#f7fafc',
    borderTopWidth: 1, borderTopColor: '#e2e8f0',
  },
  readOnlyBarText: { fontSize: 13, color: '#a0aec0' },

  // New DM modal
  dmKeyboardWrap: {
    flex: 1,
    justifyContent: 'flex-end',
  },
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
  dmAvatarImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginRight: 12,
    backgroundColor: '#edf2f7',
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
  // Chat list search bar
  chatSearchBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f7fafc',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 10,
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 8,
  },
  chatSearchIcon: {
    marginRight: 8,
  },
  chatSearchInput: {
    flex: 1,
    height: 38,
    fontSize: 15,
    color: '#2d3748',
  },
});
