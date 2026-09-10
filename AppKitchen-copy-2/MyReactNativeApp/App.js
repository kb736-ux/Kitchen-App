import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, TouchableOpacity, SafeAreaView, ActivityIndicator, Platform, AppState, Vibration, Alert } from 'react-native';
import { useState, useEffect, useRef, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import HomePage from './components/HomePage';
import TasksPage from './components/TasksPage';
import SchedulePage from './components/SchedulePage';
import RecipesPage from './components/RecipesPage';
import ProgressPage from './components/ProgressPage';
import TaskDetailPage from './components/TaskDetailPage';
import CalendarPage from './components/CalendarPage';
import ChatPage from './components/ChatPage';
import ProfilePage from './components/ProfilePage';
import OrgPickerModal from './components/OrgPickerModal';
import { supabase, getOrgId, listOrgsForCurrentUser, switchToOrg } from './utils/supabase';
import { ShiftMatching, shiftRowMatchesEmployee } from './utils/shiftMatching';
import { applyTaskCompletionToInventory } from './utils/inventorySync';
import { EmployeeProvider, useEmployee } from './EmployeeContext';
import LoginScreen from './LoginScreen';
import { JS_BUNDLE_BUILD } from './constants/buildInfo';
import { Colors } from './constants/theme';

/** Expo Go on Android (SDK 53+) cannot load expo-notifications — use a dev build for push there. */
function canUseExpoPushModule() {
  return !(Constants.appOwnership === 'expo' && Platform.OS === 'android');
}

let notificationsModule;
function getNotifications() {
  if (!canUseExpoPushModule()) return null;
  if (notificationsModule === undefined) {
    try {
      notificationsModule = require('expo-notifications');
    } catch {
      notificationsModule = null;
    }
  }
  return notificationsModule;
}

const Notifications = getNotifications();
if (Notifications) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

async function registerForPushNotifications(orgId, employeeName, userEmail) {
  const N = getNotifications();
  if (!N || !Device.isDevice) {
    return;
  }

  const { status: existingStatus } = await N.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await N.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') {
    console.warn('[Notifications] Permission not granted.');
    return;
  }

  // Android: create channel before token / pushes so FCM uses MAX importance + vibration.
  if (Platform.OS === 'android') {
    await N.setNotificationChannelAsync('default', {
      name: 'Sheek',
      importance: N.AndroidImportance.MAX,
      vibrationPattern: [0, 400, 200, 400],
      enableVibrate: true,
      showBadge: true,
      sound: 'default',
    });
  }

  try {
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;
    const tokenData = projectId
      ? await N.getExpoPushTokenAsync({ projectId })
      : await N.getExpoPushTokenAsync();
    const token = tokenData.data;

    // Resolve canonical employee_name from profile so web and mobile use the same key.
    let tokenEmployeeName = (employeeName || '').trim();
    if (orgId && userEmail) {
      const { data: profileByEmail } = await supabase
        .from('profiles')
        .select('employee_name')
        .eq('org_id', orgId)
        .ilike('email', userEmail)
        .maybeSingle();
      if ((profileByEmail?.employee_name || '').trim()) {
        tokenEmployeeName = profileByEmail.employee_name.trim();
      }
    }
    if (!tokenEmployeeName) return;

    // Store token in Supabase so the web app can look it up
    const { error } = await supabase.from('push_tokens').upsert(
      {
        org_id: orgId,
        employee_name: tokenEmployeeName,
        token,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'org_id,employee_name' }
    );
    if (error) console.warn('[Notifications] Could not save token:', error.message);
    else console.log('[Notifications] Push token saved:', token);
  } catch (e) {
    console.warn('[Notifications] Could not get push token:', e.message);
  }
}

function MainApp({ bumpEmployeeIdentity, identityVersion = 0 }) {
  const [activeTab, setActiveTab] = useState('Home');
  const [showProgress, setShowProgress] = useState(false);
  const [showTaskDetail, setShowTaskDetail] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  const [showCalendar, setShowCalendar] = useState(false);

  const { employeeName, displayName, defaultEmployeeName, employeeId, authUserId, email, firstName, lastName, authLoading } = useEmployee();

  // Org state (no auth needed)
  const [orgId, setOrgId] = useState(null);
  const [booting, setBooting] = useState(true);

  const [orgPickerVisible, setOrgPickerVisible] = useState(false);
  const [availableOrgs, setAvailableOrgs] = useState([]);
  const [orgsListLoading, setOrgsListLoading] = useState(false);
  const [currentOrgName, setCurrentOrgName] = useState('');

  const [showProfile, setShowProfile] = useState(false);
  const [profileData, setProfileData] = useState({
    displayName: '',
    firstName: '',
    lastName: '',
    employeeNameFromProfile: '',
    avatarColor: Colors.primary,
    avatarUrl: null,
  });
  const profileCacheKeyRef = useRef('');

  // Tasks from Supabase
  const [tasks, setTasks] = useState([]);
  const [homeUrgentTasks, setHomeUrgentTasks] = useState([]);

  // Shift data for home page
  const [todayShift, setTodayShift] = useState(null);   // full shift row or null
  const [nextShift, setNextShift] = useState(null);     // next upcoming shift row

  const activeShiftWindow = useMemo(() => {
    if (!todayShift?.shift_date || !todayShift?.start_time || !todayShift?.end_time) return null;
    const start = new Date(`${todayShift.shift_date}T${String(todayShift.start_time).slice(0, 8)}`);
    const end = new Date(`${todayShift.shift_date}T${String(todayShift.end_time).slice(0, 8)}`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    if (end <= start) end.setDate(end.getDate() + 1); // overnight shift
    return { start, end };
  }, [todayShift]);

  const displayedTasks = useMemo(() => {
    if (!todayShift) return [];
    if (!activeShiftWindow) return tasks;

    const todayShiftIds = new Set(
      [
        todayShift?.id != null ? String(todayShift.id) : null,
        ...((todayShift?.related_shift_ids || []).map((id) => String(id))),
      ].filter(Boolean)
    );

    /** True if this employee already has at least one task tied to today's shift row(s). */
    const hasShiftLinkedTask = tasks.some(
      (t) => t?.shift_id != null && todayShiftIds.has(String(t.shift_id))
    );

    const filtered = tasks.filter((t) => {
      const taskShiftId = t?.shift_id != null ? String(t.shift_id) : null;
      const createdAt = t?.created_at ? new Date(t.created_at) : null;
      const completedAt = t?.completed_at ? new Date(t.completed_at) : null;
      const createdOk = createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt : null;
      const completedOk = completedAt && !Number.isNaN(completedAt.getTime()) ? completedAt : null;
      const createdYmd = createdOk
        ? `${createdOk.getFullYear()}-${String(createdOk.getMonth() + 1).padStart(2, '0')}-${String(createdOk.getDate()).padStart(2, '0')}`
        : null;

      if (taskShiftId && todayShiftIds.has(taskShiftId)) return true;

      // When the manager has linked tasks to this shift in Supabase, only show those
      // (plus same-day urgent adds). Hides orphan same-calendar-day rows that duplicate
      // the web "Assign Tasks" list (legacy shift_id null).
      if (hasShiftLinkedTask) {
        if (t.is_urgent && !taskShiftId) {
          if (!createdOk) return false;
          return createdYmd === todayShift.shift_date;
        }
        return false;
      }

      if (!t.completed) {
        if (!createdOk) return false;
        return createdYmd === todayShift.shift_date
          || (createdOk >= activeShiftWindow.start && createdOk <= activeShiftWindow.end);
      }

      if (completedOk) {
        return completedOk >= activeShiftWindow.start && completedOk <= activeShiftWindow.end;
      }
      if (createdOk) {
        return createdYmd === todayShift.shift_date
          || (createdOk >= activeShiftWindow.start && createdOk <= activeShiftWindow.end);
      }
      return false;
    });

    const normText = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const betterTask = (a, b) => {
      const aLinked = a?.shift_id != null && todayShiftIds.has(String(a.shift_id));
      const bLinked = b?.shift_id != null && todayShiftIds.has(String(b.shift_id));
      if (aLinked !== bLinked) return aLinked ? a : b;
      if (!!a.completed !== !!b.completed) return a.completed ? b : a;
      return String(a.id) < String(b.id) ? a : b;
    };
    const byNorm = new Map();
    for (const t of filtered) {
      const key = normText(t.text);
      if (!byNorm.has(key)) byNorm.set(key, t);
      else byNorm.set(key, betterTask(byNorm.get(key), t));
    }
    return Array.from(byNorm.values()).sort((a, b) => {
      const ta = new Date(a.created_at || 0).getTime();
      const tb = new Date(b.created_at || 0).getTime();
      if (ta !== tb) return ta - tb;
      return String(a.id).localeCompare(String(b.id));
    });
  }, [todayShift, tasks, activeShiftWindow]);

  const homeUrgentForHome = useMemo(() => (todayShift ? homeUrgentTasks : []), [todayShift, homeUrgentTasks]);

  const taskStats = useMemo(
    () => ({
      total: displayedTasks.length,
      completed: displayedTasks.filter(t => t.completed).length,
    }),
    [displayedTasks]
  );

  // Unread task-assignment notifications (badge on Tasks tab)
  const [taskNotifCount, setTaskNotifCount] = useState(0);
  const [chatUnreadDot, setChatUnreadDot] = useState(false);
  const [scheduleUnreadDot, setScheduleUnreadDot] = useState(false);

  // Notification listener ref (cleanup on unmount)
  const notificationListener = useRef();
  const responseListener = useRef();
  const orgIdRef = useRef(orgId);
  orgIdRef.current = orgId;
  const chatSeenAtRef = useRef(null);

  const myNameKeys = () =>
    new Set(
      [employeeName, displayName, profileData?.displayName, (email || '').split('@')[0], email]
        .map(v => (v || '').trim().toLowerCase())
        .filter(Boolean)
    );

  const myLooseNameKeys = () =>
    new Set(
      [employeeName, displayName, profileData?.displayName, (email || '').split('@')[0], email]
        .map(v => (v || '').toLowerCase().replace(/[^a-z0-9]/g, ''))
        .filter(Boolean)
    );

  function buildVerifiedIdentity(profileRows = []) {
    const authEmail = String(email || '').trim().toLowerCase();
    const emailLocal = authEmail.split('@')[0] || '';
    const baseNames = [employeeName, defaultEmployeeName, emailLocal]
      .map((n) => (n || '').trim())
      .filter(Boolean);

    const verifiedProfiles = (profileRows || []).filter((p) => {
      const pEmail = String(p?.email || '').trim().toLowerCase();
      const pEmp = String(p?.employee_name || '').trim().toLowerCase();
      if (authUserId && p?.user_id && String(p.user_id) === String(authUserId)) return true;
      if (employeeId && p?.id && String(p.id) === String(employeeId)) return true;
      if (authEmail && pEmail && pEmail === authEmail) return true;
      if (employeeName && pEmp && pEmp === String(employeeName).trim().toLowerCase()) return true;
      if (emailLocal && pEmp && pEmp === emailLocal) return true;
      return false;
    });

    const derivedNames = [];
    verifiedProfiles.forEach((p) => {
      const first = (p?.first_name || '').trim();
      const last = (p?.last_name || '').trim();
      const combined = [first, last].filter(Boolean).join(' ').trim();
      derivedNames.push(
        p?.employee_name || '',
        p?.display_name || '',
        first,
        last,
        combined
      );
    });

    const originalNames = Array.from(
      new Set([...baseNames, ...derivedNames].map((n) => (n || '').trim()).filter(Boolean))
    );

    return {
      profileIds: new Set(
        verifiedProfiles.map((p) => p?.id).filter(Boolean)
      ),
      originalNames,
      lowerNames: new Set(originalNames.map((n) => n.toLowerCase())),
    };
  }

  async function fetchTaskNotifCount(oid) {
    if (!oid) return;
    let query = supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', oid)
      .eq('type', 'task_assigned')
      .eq('read', false);
      
    if (employeeId) {
      query = query.eq('employee_id', employeeId);
    } else {
      query = query.eq('employee_name', employeeName);
    }

    const { count, error } = await query;
    if (!error) setTaskNotifCount(count || 0);
  }

  async function fetchProfileData(oid) {
    if (!oid) return;
    const { data: authRes } = await supabase.auth.getUser();
    const authUser = authRes?.user || null;
    let data = null;
    const safe = async (query) => {
      try {
        const { data: rows, error } = await query;
        if (error) return null;
        if (!Array.isArray(rows)) return rows || null;
        return rows[0] || null;
      } catch (_) {
        return null;
      }
    };

    const profileCols = 'display_name, first_name, last_name, employee_name, avatar_color, avatar_url, email, user_id';
    const uid = authUser?.id || null;
    const em = String(authUser?.email || '').trim();

    const [byOrgUser, byOrgEmail, byUserGlobal, byIdAsProfile, byEmailGlobal, adminProfile] = await Promise.all([
      uid
        ? safe(
            supabase
              .from('profiles')
              .select(profileCols)
              .eq('org_id', oid)
              .eq('user_id', uid)
              .limit(1)
          )
        : Promise.resolve(null),
      em
        ? safe(
            supabase
              .from('profiles')
              .select(profileCols)
              .eq('org_id', oid)
              .ilike('email', em)
              .limit(1)
          )
        : Promise.resolve(null),
      uid
        ? safe(supabase.from('profiles').select(profileCols).eq('user_id', uid).limit(1))
        : Promise.resolve(null),
      uid
        ? safe(supabase.from('profiles').select(profileCols).eq('id', uid).limit(1))
        : Promise.resolve(null),
      em
        ? safe(supabase.from('profiles').select(profileCols).ilike('email', em).limit(1))
        : Promise.resolve(null),
      uid
        ? safe(
            supabase
              .from('admin_profiles')
              .select('display_name, first_name, last_name, avatar_url')
              .eq('user_id', uid)
              .limit(1)
          )
        : Promise.resolve(null),
    ]);

    data =
      byOrgUser ||
      byOrgEmail ||
      byUserGlobal ||
      byIdAsProfile ||
      byEmailGlobal ||
      null;

    if (!data && adminProfile) {
      data = {
        display_name: adminProfile.display_name || '',
        first_name: adminProfile.first_name || '',
        last_name: adminProfile.last_name || '',
        avatar_color: Colors.primary,
        avatar_url: adminProfile.avatar_url || null,
      };
    }

    if (data) {
      const avatarUrl = (data.avatar_url || '').trim() || null;
      const first = (data.first_name || '').trim();
      const last = (data.last_name || '').trim();
      const combined = [first, last].filter(Boolean).join(' ').trim();
      const displayNameVal = combined || (data.display_name || '').trim() || profileData.displayName || displayName || employeeName || '';
      const nextProfile = {
        displayName: displayNameVal,
        firstName: first,
        lastName: last,
        employeeNameFromProfile: (data.employee_name || '').trim(),
        avatarColor: data.avatar_color || Colors.primary,
        avatarUrl: avatarUrl,
      };
      setProfileData(nextProfile);
      try {
        const emailKey = (authUser?.email || email || '').trim().toLowerCase();
        if (emailKey) {
          const key = `kk_profile_cache_v1:${emailKey}`;
          profileCacheKeyRef.current = key;
          await AsyncStorage.setItem(key, JSON.stringify(nextProfile));
        }
      } catch (_) {}
    }
  }

  useEffect(() => {
    (async () => {
      const emailKey = (email || '').trim().toLowerCase();
      if (!emailKey) return;
      const key = `kk_profile_cache_v1:${emailKey}`;
      profileCacheKeyRef.current = key;
      try {
        const raw = await AsyncStorage.getItem(key);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return;
        const first = (parsed.firstName || '').trim();
        const last = (parsed.lastName || '').trim();
        const combined = [first, last].filter(Boolean).join(' ').trim();
        setProfileData(prev => ({
          displayName: (parsed.displayName || '').trim() || combined || prev.displayName || displayName || employeeName || '',
          firstName: first || prev.firstName || '',
          lastName: last || prev.lastName || '',
          employeeNameFromProfile: (parsed.employeeNameFromProfile || '').trim() || prev.employeeNameFromProfile || '',
          avatarColor: (parsed.avatarColor || '').trim() || prev.avatarColor || Colors.primary,
          avatarUrl: (parsed.avatarUrl || '').trim() || prev.avatarUrl || null,
        }));
      } catch (_) {}
    })();
  }, [email, displayName, employeeName]);

  async function markTaskNotifsRead(oid) {
    if (!oid) return;
    let query = supabase
      .from('notifications')
      .select('id')
      .eq('org_id', oid)
      .eq('type', 'task_assigned')
      .eq('read', false);
      
    if (employeeId) {
      query = query.eq('employee_id', employeeId);
    } else {
      query = query.eq('employee_name', employeeName);
    }

    const { data } = await query;
    if (data?.length) {
      await supabase.from('notifications').update({ read: true }).in('id', data.map(n => n.id));
      setTaskNotifCount(0);
    }
  }

  async function fetchChatUnreadDot(oid) {
    if (!oid) return;
    const seenAt = chatSeenAtRef.current;
    if (!seenAt) {
      setChatUnreadDot(false);
      return;
    }
    const seenMs = Date.parse(seenAt);
    if (Number.isNaN(seenMs)) {
      setChatUnreadDot(false);
      return;
    }

    const [annRes, msgRes] = await Promise.all([
      supabase
        .from('announcements')
        .select('created_at, created_by, created_by_id')
        .eq('org_id', oid)
        .order('created_at', { ascending: false })
        .limit(120),
      supabase
        .from('messages')
        .select('created_at, sender, employee_id')
        .eq('org_id', oid)
        .order('created_at', { ascending: false })
        .limit(200),
    ]);

    const names = myNameKeys();
    const looseNames = myLooseNameKeys();
    const isMine = (row) => {
      if (employeeId && row?.employee_id && row.employee_id === employeeId) return true;
      const sender = String(row?.sender || row?.created_by || '').trim().toLowerCase();
      const senderLoose = sender.replace(/[^a-z0-9]/g, '');
      return names.has(sender) || looseNames.has(senderLoose);
    };
    const hasUnreadAnn = (annRes.data || []).some((a) => {
      const ts = Date.parse(a.created_at || '');
      if (Number.isNaN(ts) || ts <= seenMs) return false;
      if (employeeId && a?.created_by_id && a.created_by_id === employeeId) return false;
      return !isMine(a);
    });
    const hasUnreadMsg = (msgRes.data || []).some((m) => {
      const ts = Date.parse(m.created_at || '');
      if (Number.isNaN(ts) || ts <= seenMs) return false;
      return !isMine(m);
    });
    setChatUnreadDot(hasUnreadAnn || hasUnreadMsg);
  }

  async function markScheduleNotifsRead(oid) {
    if (!oid) return;
    const scheduleTypes = ['shift_assigned', 'request_approved', 'request_denied', 'shift_request'];
    let query = supabase
      .from('notifications')
      .select('id')
      .eq('org_id', oid)
      .in('type', scheduleTypes)
      .eq('read', false);
    if (employeeId) {
      query = query.or(`employee_id.eq.${employeeId},employee_id.is.null`);
    } else if (employeeName) {
      query = query.or(`employee_name.eq.${employeeName},employee_name.is.null`);
    }
    const { data } = await query;
    if (data?.length) {
      await supabase.from('notifications').update({ read: true }).in('id', data.map(n => n.id));
    }
  }

  async function fetchScheduleUnreadDot(oid) {
    if (!oid) return;
    const scheduleTypes = ['shift_assigned', 'request_approved', 'request_denied', 'shift_request'];
    let query = supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', oid)
      .in('type', scheduleTypes)
      .eq('read', false);
    if (employeeId) {
      query = query.or(`employee_id.eq.${employeeId},employee_id.is.null`);
    } else if (employeeName) {
      query = query.or(`employee_name.eq.${employeeName},employee_name.is.null`);
    }
    const { count, error } = await query;
    if (!error) setScheduleUnreadDot((count || 0) > 0);
  }

  async function markChatSeen(oid) {
    if (!oid) return;
    chatSeenAtRef.current = new Date().toISOString();
    setChatUnreadDot(false);
  }

  async function markScheduleSeen(oid) {
    if (!oid) return;
    await markScheduleNotifsRead(oid);
    setScheduleUnreadDot(false);
  }

  // ── Boot: load org, fetch tasks, register push token ──────────────────────
  useEffect(() => {
    async function boot() {
      const oid = await getOrgId();
      setOrgId(oid);
      setBooting(false);
      if (__DEV__) {
        console.log('[Boot] orgId resolved:', oid);
        (async () => {
          try {
            const { data: authData } = await supabase.auth.getUser();
            const uid = authData?.user?.id;
            const em = authData?.user?.email;
            console.log('[Boot] auth uid:', uid, '| email:', em);
            const { data: shiftRows, error: shiftErr } = await supabase.from('shifts').select('id, employee_name, employee_id, shift_date').eq('org_id', oid).limit(5);
            console.log('[Boot] shifts RLS test:', shiftRows?.length ?? 0, 'rows', shiftErr ? `ERROR: ${shiftErr.message}` : 'OK');
            if (shiftRows?.length > 0) console.log('[Boot] shifts sample:', JSON.stringify(shiftRows[0]));
            const { data: profRows, error: profErr } = await supabase.from('profiles').select('id, user_id, employee_name, display_name, avatar_url').eq('org_id', oid).limit(5);
            console.log('[Boot] profiles RLS test:', profRows?.length ?? 0, 'rows', profErr ? `ERROR: ${profErr.message}` : 'OK');
            if (profRows?.length > 0) console.log('[Boot] profiles sample:', JSON.stringify(profRows[0]));
            const { data: omRows, error: omErr } = await supabase.from('org_members').select('id, user_id, org_id').eq('org_id', oid).limit(5);
            console.log('[Boot] org_members RLS test:', omRows?.length ?? 0, 'rows', omErr ? `ERROR: ${omErr.message}` : 'OK');
            const { data: srRows, error: srErr } = await supabase.from('shift_requests').select('id, status, employee_name, request_type').eq('org_id', oid).limit(5);
            console.log('[Boot] shift_requests RLS test:', srRows?.length ?? 0, 'rows', srErr ? `ERROR: ${srErr.message}` : 'OK');
            if (srErr) console.warn('[Boot] shift_requests ERROR detail:', srErr.message, srErr.hint || '', srErr.code || '');
            if (srRows?.length > 0) console.log('[Boot] shift_requests sample:', JSON.stringify(srRows[0]));
            const { data: taskRows, error: taskErr } = await supabase.from('tasks').select('*').eq('org_id', oid).limit(8);
            console.log('[Boot] tasks RLS test:', taskRows?.length ?? 0, 'rows', taskErr ? `ERROR: ${taskErr.message}` : 'OK');
            if (taskErr) console.warn('[Boot] tasks ERROR detail:', taskErr.message, taskErr.hint || '', taskErr.code || '');
            if (taskRows?.length > 0) {
              const sample = taskRows[0];
              console.log('[Boot] tasks sample columns:', Object.keys(sample).join(', '));
              console.log('[Boot] tasks sample row:', JSON.stringify({ id: sample.id, employee_name: sample.employee_name, employee_id: sample.employee_id, text: sample.text, status: sample.status }));
            }
          } catch (e) {
            console.warn('[Boot] RLS diagnostic failed:', e?.message);
          }
        })();
      }
      if (oid) {
        if (!chatSeenAtRef.current) chatSeenAtRef.current = new Date().toISOString();
        void Promise.all([
          fetchTasks(oid),
          fetchTaskNotifCount(oid),
          fetchProfileData(oid),
          fetchChatUnreadDot(oid),
          fetchScheduleUnreadDot(oid),
        ]);
        void registerForPushNotifications(oid, employeeName, email);
      }
    }
    boot();

    const N = getNotifications();
    if (N) {
      // Listen for incoming notifications while app is open
      notificationListener.current = N.addNotificationReceivedListener(notification => {
        console.log('[Notification received]', notification);
        if (notification?.request?.content?.data?.type) {
          Vibration.vibrate(500);
        }
      });
      // Listen for notification taps — navigate to Tasks or Schedule
      responseListener.current = N.addNotificationResponseReceivedListener((response) => {
        const data = response.notification?.request?.content?.data;
        if (data?.type === 'task_assigned') {
          setActiveTab('Tasks');
          markTaskNotifsRead(orgIdRef.current);
        } else if (data?.type === 'chat_message') {
          setActiveTab('Chat');
        } else {
          setActiveTab('Schedule');
        }
      });
    }

    return () => {
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, [employeeName, email]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && orgId) {
        fetchTasks(orgId);
        fetchTaskNotifCount(orgId);
        fetchProfileData(orgId);
        checkTodayShift(orgId);
        fetchChatUnreadDot(orgId);
        fetchScheduleUnreadDot(orgId);
      }
    });
    return () => sub?.remove();
  }, [orgId]);

  useEffect(() => {
    if (!orgId) return;
    const id = setInterval(() => {
      fetchTaskNotifCount(orgId);
      fetchChatUnreadDot(orgId);
      fetchScheduleUnreadDot(orgId);
    }, 10000);
    return () => clearInterval(id);
  }, [orgId, employeeId, employeeName, displayName, email]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setOrgsListLoading(true);
      try {
        const list = await listOrgsForCurrentUser();
        if (cancelled) return;
        setAvailableOrgs(list);
        const row = list.find((o) => o.id === orgId);
        setCurrentOrgName(row?.name || '');
      } finally {
        if (!cancelled) setOrgsListLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [orgId, identityVersion]);

  // ── Fetch tasks from Supabase ─────────────────────────────────────────────
  async function fetchTasks(oid) {
    if (!oid) {
      console.warn('[Tasks] No orgId — cannot fetch');
      return;
    }

    const [{ data: profiles }, { data, error }] = await Promise.all([
      supabase.from('profiles').select('id, employee_name, display_name, first_name, last_name, email, user_id').eq('org_id', oid),
      supabase.from('tasks').select('*').eq('org_id', oid).order('created_at', { ascending: true }),
    ]);

    const identity = buildVerifiedIdentity(profiles || []);
    const nameCandidates = Array.from(identity.lowerNames);
    const taskNameCandidates = identity.originalNames;

    const profileById = {};
    const myProfileIds = new Set(identity.profileIds);
    (profiles || []).forEach((p) => {
      if (!p?.id) return;
      profileById[p.id] = p;
    });
    if (employeeId) myProfileIds.add(employeeId);

    if (error) {
      console.warn('[Tasks] Fetch failed:', error.message);
      setTasks([]);
      return;
    }

    const all = data || [];
    const isTaskCompleted = (t) => {
      const normalizedStatus = (t?.status || '').toString().trim().toLowerCase();
      if (normalizedStatus === 'completed' || normalizedStatus === 'complete' || normalizedStatus === 'done' || normalizedStatus === 'archived' || normalizedStatus === 'cancelled') {
        return true;
      }
      if (t?.completed === true) return true;
      if (t?.completed_at) return true;
      return false;
    };
    const mine = all
      .filter((t) => {
        const assignedId = t.employee_id || t.assigned_to || null;
        if (assignedId && myProfileIds.has(assignedId)) return true;
        if (assignedId && employeeId && String(assignedId) === String(employeeId)) return true;
        if (assignedId && authUserId && String(assignedId) === String(authUserId)) return true;
        const assignedNameRaw = (t.employee_name || t.assignee || '').trim();
        if (!assignedNameRaw) return false;
        if (nameCandidates.includes(assignedNameRaw.toLowerCase())) return true;
        return shiftRowMatchesEmployee(
          { employee_name: assignedNameRaw, employee_id: assignedId },
          employeeId,
          taskNameCandidates,
          authUserId
        );
      })
      .map(t => {
        const assignedId = t.employee_id || t.assigned_to || null;
        const profile = assignedId ? profileById[assignedId] : null;
        return {
          id: t.id,
          text: t.text,
          completed: isTaskCompleted(t),
          is_urgent: t.is_urgent ?? false,
          status: t.status,
          created_at: t.created_at || null,
          completed_at: t.completed_at || null,
          shift_id: t.shift_id || null,
          employee_name: t.employee_name || profile?.display_name || profile?.employee_name || null,
          employee_id: assignedId,
        };
      });

    setTasks(mine);

    if (__DEV__) {
      console.log(
        '[Tasks] fetched',
        all.length,
        'rows →',
        mine.length,
        'mine | nameCandidates:',
        nameCandidates.slice(0, 6),
        'myProfileIds:',
        myProfileIds.size
      );
    }

    // Home urgent card should mirror web: org-wide urgent tasks (not only my assigned tasks)
    const urgentAll = all
      .filter(t => !isTaskCompleted(t) && !!t.is_urgent)
      .map(t => {
        const assignedId = t.employee_id || t.assigned_to || null;
        const profile = assignedId ? profileById[assignedId] : null;
        return {
          id: t.id,
          text: t.text,
          completed: false,
          is_urgent: true,
          status: t.status,
          employee_name: t.employee_name || profile?.display_name || profile?.employee_name || null,
          employee_id: assignedId,
        };
      });
    setHomeUrgentTasks(urgentAll);
  }

  /** Parse shift start/end as local Date; extend end to next calendar day if overnight. */
  function shiftTimeBounds(s) {
    if (!s?.shift_date || !s?.start_time || !s?.end_time) return null;
    const start = new Date(`${s.shift_date}T${String(s.start_time).slice(0, 8)}`);
    const end = new Date(`${s.shift_date}T${String(s.end_time).slice(0, 8)}`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    if (end <= start) end.setDate(end.getDate() + 1);
    return { start, end };
  }

  // ── Fetch today's shift + next upcoming shift for this employee ───────────
  async function checkTodayShift(oid) {
    if (!oid) return;
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    const { data: profileRows } = await supabase
      .from('profiles')
      .select('id, employee_name, display_name, first_name, last_name, email, user_id')
      .eq('org_id', oid);
    const candidateNames = ShiftMatching.collectNameCandidates(
      {
        employeeId,
        authUserId,
        email,
        employeeName,
        displayName,
        defaultEmployeeName,
        firstName,
        lastName,
        profileData,
      },
      profileRows || []
    );
    const knownIds = ShiftMatching.profileIdsForMember(profileRows || [], {
      employeeId,
      authUserId,
    });

    const { data: shiftsToday, error: errToday } = await supabase
      .from('shifts')
      .select('*')
      .eq('org_id', oid)
      .eq('shift_date', todayStr);

    if (errToday && __DEV__) {
      console.warn('[Shifts] today query:', errToday.message);
    }

    const myToday = (shiftsToday || []).filter((s) =>
      ShiftMatching.rowMatchesEmployee(s, employeeId, candidateNames, authUserId, knownIds)
    );
    const nowMs = Date.now();
    const stillRelevant = myToday.filter((s) => {
      const b = shiftTimeBounds(s);
      if (!b) return false;
      return nowMs < b.end.getTime();
    });
    stillRelevant.sort((a, b) => {
      const ba = shiftTimeBounds(a);
      const bb = shiftTimeBounds(b);
      if (!ba || !bb) return 0;
      return ba.start.getTime() - bb.start.getTime();
    });
    const todayData = stillRelevant[0] || null;

    if (todayData?.id && todayData.shift_date && todayData.start_time && todayData.end_time) {
      const { data: siblingRows } = await supabase
        .from('shifts')
        .select('id')
        .eq('org_id', oid)
        .eq('shift_date', todayData.shift_date)
        .eq('start_time', todayData.start_time)
        .eq('end_time', todayData.end_time)
        .eq('employee_name', todayData.employee_name || '');
      const relatedShiftIds = [...new Set((siblingRows || []).map((s) => String(s.id)).filter(Boolean))];
      setTodayShift({ ...todayData, related_shift_ids: relatedShiftIds });
    } else {
      setTodayShift(todayData);
    }

    if (!todayData) {
      const { data: upcoming, error: errUp } = await supabase
        .from('shifts')
        .select('*')
        .eq('org_id', oid)
        .gt('shift_date', todayStr)
        .order('shift_date', { ascending: true });

      if (errUp && __DEV__) {
        console.warn('[Shifts] upcoming query:', errUp.message);
      }

      const nextData =
        (upcoming || []).find((s) =>
          ShiftMatching.rowMatchesEmployee(s, employeeId, candidateNames, authUserId, knownIds)
        ) || null;

      setNextShift(nextData);
    } else {
      setNextShift(null);
    }
  }

  // Re-resolve shifts after profile/org identity is ready (boot used to run checkTodayShift too early).
  useEffect(() => {
    if (!orgId || booting || authLoading) return;
    checkTodayShift(orgId);
  }, [
    orgId,
    booting,
    authLoading,
    authUserId,
    employeeId,
    employeeName,
    displayName,
    defaultEmployeeName,
    email,
    firstName,
    lastName,
    profileData.displayName,
    profileData.firstName,
    profileData.lastName,
    profileData.employeeNameFromProfile,
  ]);

  // Refetch when identity or profile changes — boot runs fetchTasks in parallel with fetchProfileData,
  // so the first run often had incomplete name candidates; this effect must re-run after profile loads.
  useEffect(() => {
    if (!orgId || booting || authLoading) return;
    fetchTasks(orgId);
  }, [
    orgId,
    booting,
    authLoading,
    authUserId,
    employeeId,
    employeeName,
    displayName,
    email,
    defaultEmployeeName,
    firstName,
    lastName,
    profileData.displayName,
    profileData.employeeNameFromProfile,
    profileData.firstName,
    profileData.lastName,
  ]);

  // ── Toggle task complete / incomplete ──────────────────────────────────────
  const toggleTask = async (taskId) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return { ok: false, message: 'Task not found' };
    const nowCompleted = !task.completed;
    const completedAt = nowCompleted ? new Date().toISOString() : null;
    setTasks(prev =>
      prev.map(t => t.id === taskId ? { ...t, completed: nowCompleted, status: nowCompleted ? 'completed' : 'todo', completed_at: completedAt } : t)
    );
    const { error } = await supabase
      .from('tasks')
      .update({ status: nowCompleted ? 'completed' : 'todo', completed_at: completedAt })
      .eq('id', taskId);
    if (error) {
      console.warn('[Supabase] toggleTask failed:', error.message);
      setTasks(prev =>
        prev.map(t => t.id === taskId ? { ...t, completed: !nowCompleted, status: !nowCompleted ? 'completed' : 'todo', completed_at: task.completed_at ?? null } : t)
      );
      return { ok: false, message: error.message };
    }
    if (nowCompleted && orgId) {
      applyTaskCompletionToInventory(supabase, orgId, task.text, true);
    }
    return { ok: true };
  };

  const toggleUrgent = async (taskId) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return { ok: false, message: 'Task not found' };
    const nowUrgent = !task.is_urgent;
    setTasks(prev =>
      prev.map(t => t.id === taskId ? { ...t, is_urgent: nowUrgent } : t)
    );
    const { error } = await supabase.from('tasks').update({ is_urgent: nowUrgent }).eq('id', taskId);
    if (error) {
      console.warn('[Supabase] toggleUrgent failed:', error.message);
      setTasks(prev =>
        prev.map(t => t.id === taskId ? { ...t, is_urgent: !nowUrgent } : t)
      );
      return { ok: false, message: error.message };
    }
    return { ok: true };
  };

  const addUrgentTask = async (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const assignToMe = !!todayShift;
    const optimisticId = 'tmp-' + Date.now();
    const newTask = {
      id: optimisticId,
      text: trimmed,
      completed: false,
      is_urgent: true,
      status: 'todo',
      created_at: new Date().toISOString(),
      completed_at: null,
      shift_id: null,
      employee_name: assignToMe ? (displayName || employeeName) : null,
      employee_id: assignToMe ? employeeId : null,
    };
    setTasks(prev => [newTask, ...prev]);
    const insertRow = { org_id: orgId, text: trimmed, status: 'todo', is_urgent: true };
    if (assignToMe) {
        insertRow.employee_id = employeeId || null;
        insertRow.employee_name = displayName || employeeName;
    }
    let { data, error } = await supabase.from('tasks').insert(insertRow).select().single();
    if (error && /employee_name/i.test(error.message || '')) {
      const fallback = { ...insertRow };
      delete fallback.employee_name;
      const retry = await supabase.from('tasks').insert(fallback).select().single();
      data = retry.data;
      error = retry.error;
    }
    if (error) {
      console.warn('[Supabase] addUrgentTask failed:', error.message);
      setTasks(prev => prev.filter(t => t.id !== optimisticId));
    } else {
      setTasks(prev =>
        prev.map(t => t.id === optimisticId ? { ...t, id: data.id, created_at: data.created_at || t.created_at, completed_at: data.completed_at || null, shift_id: data.shift_id || null, employee_name: data.employee_name ?? insertRow.employee_name ?? null, employee_id: data.employee_id || data.assigned_to || insertRow.employee_id || null } : t)
      );
      if (orgId) fetchTasks(orgId); // refetch so list stays in sync with Supabase
    }
  };

  const takeUrgentTask = async (taskId) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.employee_name || task.employee_id) return;
    setTasks(prev =>
      prev.map(t => t.id === taskId ? { ...t, employee_name: (displayName || employeeName), employee_id: employeeId } : t)
    );
    let { error } = await supabase
      .from('tasks')
      .update({ employee_name: displayName || employeeName, employee_id: employeeId || null })
      .eq('id', taskId);
    if (error && /employee_name/i.test(error.message || '')) {
      const retry = await supabase
        .from('tasks')
        .update({ employee_id: employeeId || null })
        .eq('id', taskId);
      error = retry.error;
    }
    if (error) {
      console.warn('[Supabase] takeUrgentTask failed:', error.message);
      setTasks(prev =>
        prev.map(t => t.id === taskId ? { ...t, employee_name: null, employee_id: null } : t)
      );
    }
  };

  const session = null; // No auth for MVP — RLS is disabled

  // ── Navigation helpers ─────────────────────────────────────────────────────
  const handleProgressPress = () => setShowProgress(true);
  const handleBackFromProgress = () => setShowProgress(false);

  const handleTaskPress = (task) => {
    setSelectedTask(task);
    setShowTaskDetail(true);
  };
  const handleBackFromTaskDetail = () => { setShowTaskDetail(false); setSelectedTask(null); };

  const handleCalendarPress = () => setShowCalendar(true);
  const handleBackFromCalendar = () => setShowCalendar(false);

  const handleProfilePress = () => setShowProfile(true);
  const handleBackFromProfile = () => setShowProfile(false);

  const prioritizeTask = (taskId) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    setTasks(prev => {
      const rest = prev.filter(t => t.id !== taskId);
      return [task, ...rest];
    });
    setActiveTab('Tasks');
  };

  useEffect(() => {
    if (!orgId) return;
    if (activeTab === 'Chat') {
      markChatSeen(orgId);
    } else if (activeTab === 'Schedule') {
      markScheduleSeen(orgId);
    }
  }, [activeTab, orgId]);

  async function handleSelectOrg(newOrgId) {
    setOrgPickerVisible(false);
    if (!newOrgId || newOrgId === orgId) return;
    try {
      await switchToOrg(newOrgId);
      bumpEmployeeIdentity?.();
      setOrgId(newOrgId);
      orgIdRef.current = newOrgId;
      if (newOrgId) {
        void Promise.all([
          fetchTasks(newOrgId),
          fetchTaskNotifCount(newOrgId),
          fetchProfileData(newOrgId),
          fetchChatUnreadDot(newOrgId),
          fetchScheduleUnreadDot(newOrgId),
        ]);
        checkTodayShift(newOrgId);
        void registerForPushNotifications(newOrgId, employeeName, email);
      }
    } catch (e) {
      Alert.alert('Could not switch', e?.message || 'Unknown error');
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (booting) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Connecting to Sheek...</Text>
      </View>
    );
  }

  const renderCurrentPage = () => {
    if (showTaskDetail && selectedTask) {
      const currentTask = tasks.find(t => t.id === selectedTask.id) || selectedTask;
      return <TaskDetailPage onBack={handleBackFromTaskDetail} task={currentTask} toggleTask={toggleTask} toggleUrgent={toggleUrgent} orgId={orgId} />;
    }
    if (showProgress) {
        return <ProgressPage onBack={handleBackFromProgress} tasks={displayedTasks} allTasks={displayedTasks} toggleTask={toggleTask} onTaskPress={handleTaskPress} />;
    }
    if (showCalendar) {
      return <CalendarPage onBack={handleBackFromCalendar} orgId={orgId} />;
    }
    if (showProfile) {
      return (
        <ProfilePage
          onBack={handleBackFromProfile}
          profile={profileData}
          orgId={orgId}
          currentOrgName={currentOrgName}
          canSwitchOrg={availableOrgs.length > 1}
          onOpenOrgPicker={() => setOrgPickerVisible(true)}
          onProfileUpdate={(payload) => {
            setProfileData(prev => ({ ...prev, ...payload }));
            const emailKey = (email || '').trim().toLowerCase();
            if (emailKey && payload) {
              const key = `kk_profile_cache_v1:${emailKey}`;
              const next = { ...profileData, ...payload };
              AsyncStorage.setItem(key, JSON.stringify(next)).catch(() => {});
            }
          }}
        />
      );
    }

    switch (activeTab) {
      case 'Home':
        return <HomePage orgId={orgId} currentOrgName={currentOrgName} canSwitchOrg={availableOrgs.length > 1} onOpenOrgPicker={() => setOrgPickerVisible(true)} tasks={displayedTasks} urgentTasks={homeUrgentForHome} todayShift={todayShift} nextShift={nextShift} taskStats={taskStats} onProfilePress={handleProfilePress} profileData={profileData} onTasksPress={() => setActiveTab('Tasks')} onSchedulePress={() => setActiveTab('Schedule')} addUrgentTask={addUrgentTask} takeUrgentTask={takeUrgentTask} onUrgentTaskPress={prioritizeTask} />;
      case 'Tasks':
        return <TasksPage onProgressPress={handleProgressPress} tasks={displayedTasks} toggleTask={toggleTask} onTaskPress={handleTaskPress} todayIsShift={!!todayShift} toggleUrgent={toggleUrgent} addUrgentTask={addUrgentTask} onRefresh={async () => { if (orgId) await fetchTasks(orgId); }} />;
      case 'Schedule':
        return <SchedulePage orgId={orgId} profileData={profileData} />;
      case 'Recipes':
        return <RecipesPage orgId={orgId} />;
      case 'Chat':
        return <ChatPage orgId={orgId} />;
      default:
        return <HomePage orgId={orgId} currentOrgName={currentOrgName} canSwitchOrg={availableOrgs.length > 1} onOpenOrgPicker={() => setOrgPickerVisible(true)} tasks={displayedTasks} urgentTasks={homeUrgentForHome} todayShift={todayShift} nextShift={nextShift} taskStats={taskStats} onProfilePress={handleProfilePress} profileData={profileData} onTasksPress={() => setActiveTab('Tasks')} onSchedulePress={() => setActiveTab('Schedule')} addUrgentTask={addUrgentTask} takeUrgentTask={takeUrgentTask} onUrgentTaskPress={prioritizeTask} />;
    }
  };

  const getTabIcon = (tab, isActive) => {
    const iconColor = isActive ? Colors.primary : Colors.navInactive;
    const iconSize = 24;
    switch (tab) {
      case 'Home':     return <Ionicons name="home"       size={iconSize} color={iconColor} />;
      case 'Tasks':    return <Ionicons name="list"       size={iconSize} color={iconColor} />;
      case 'Schedule': return <Ionicons name="calendar"   size={iconSize} color={iconColor} />;
      case 'Recipes':  return <Ionicons name="restaurant"     size={iconSize} color={iconColor} />;
      case 'Chat':     return <Ionicons name="chatbubbles"    size={iconSize} color={iconColor} />;
      default:         return <Ionicons name="home"           size={iconSize} color={iconColor} />;
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <View style={[styles.content, (showProgress || showTaskDetail || showCalendar || showProfile) && styles.contentFullScreen]}>
        {renderCurrentPage()}
      </View>
      {!showProgress && !showTaskDetail && !showCalendar && !showProfile && (
        <View style={styles.bottomNav}>
          {['Home', 'Tasks', 'Schedule', 'Recipes', 'Chat'].map((tab) => (
            <TouchableOpacity
              key={tab}
              style={styles.navItem}
              onPress={() => {
                if (tab === 'Tasks') markTaskNotifsRead(orgId);
                if (tab === 'Chat') markChatSeen(orgId);
                if (tab === 'Schedule') markScheduleSeen(orgId);
                setActiveTab(tab);
              }}
            >
              <View style={{ position: 'relative' }}>
                {getTabIcon(tab, activeTab === tab)}
                {tab === 'Tasks' && taskNotifCount > 0 && (
                  <View style={styles.taskBadge}>
                    <Text style={styles.taskBadgeText}>{taskNotifCount > 99 ? '99+' : taskNotifCount}</Text>
                  </View>
                )}
                {tab === 'Chat' && chatUnreadDot && <View style={styles.dotBadge} />}
                {tab === 'Schedule' && scheduleUnreadDot && <View style={styles.dotBadge} />}
              </View>
              <Text style={[styles.navText, activeTab === tab && styles.navTextActive]}>
                {tab}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      <OrgPickerModal
        visible={orgPickerVisible}
        onClose={() => setOrgPickerVisible(false)}
        orgs={availableOrgs}
        activeOrgId={orgId}
        loading={orgsListLoading}
        onSelectOrg={handleSelectOrg}
      />
    </View>
  );
}

function InnerApp({ bumpEmployeeIdentity, identityVersion }) {
  const { email, authLoading } = useEmployee();

  if (authLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    );
  }
  if (!email) {
    return <LoginScreen />;
  }
  return <MainApp bumpEmployeeIdentity={bumpEmployeeIdentity} identityVersion={identityVersion} />;
}

export default function App() {
  const [identityVersion, setIdentityVersion] = useState(0);
  const bumpEmployeeIdentity = () => setIdentityVersion((v) => v + 1);

  return (
    <View style={styles.appRoot}>
      <EmployeeProvider identityVersion={identityVersion}>
        <InnerApp bumpEmployeeIdentity={bumpEmployeeIdentity} identityVersion={identityVersion} />
      </EmployeeProvider>
      {__DEV__ ? (
        <Text style={styles.devBuildStampRoot} selectable>
          {`Build ${JS_BUNDLE_BUILD} — not updating? Stop Metro, run: npx expo start --tunnel --clear then reload Expo Go`}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  appRoot: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  /** Shown in dev so you can confirm the phone loaded the latest JS (see constants/buildInfo.js). */
  devBuildStampRoot: {
    position: 'absolute',
    bottom: 4,
    left: 6,
    right: 6,
    zIndex: 99999,
    fontSize: 9,
    lineHeight: 12,
    color: '#475569',
    fontWeight: '600',
    textAlign: 'center',
    backgroundColor: 'rgba(241,245,249,0.95)',
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 8,
    overflow: 'hidden',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.bg,
    gap: 16,
  },
  loadingText: {
    fontSize: 16,
    color: Colors.textMuted,
    fontWeight: '500',
  },
  content: {
    flex: 1,
    paddingBottom: 90,
  },
  contentFullScreen: {
    paddingBottom: 0,
  },
  bottomNav: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    paddingVertical: 12,
    paddingHorizontal: 10,
    paddingBottom: 20,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 8,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
  },
  navText: {
    fontSize: 12,
    fontWeight: '500',
    color: Colors.navInactive,
    marginTop: 4,
  },
  navTextActive: {
    color: Colors.primary,
    fontWeight: '600',
  },
  taskBadge: {
    position: 'absolute',
    top: -6,
    right: -10,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.error,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  taskBadgeText: {
    color: 'white',
    fontSize: 11,
    fontWeight: '700',
  },
  dotBadge: {
    position: 'absolute',
    top: -3,
    right: -4,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.error,
  },
});
