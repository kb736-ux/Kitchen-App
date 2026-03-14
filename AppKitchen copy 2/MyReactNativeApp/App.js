import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, TouchableOpacity, SafeAreaView, ActivityIndicator, Platform, AppState, Vibration } from 'react-native';
import { useState, useEffect, useRef } from 'react';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import HomePage from './components/HomePage';
import TasksPage from './components/TasksPage';
import SchedulePage from './components/SchedulePage';
import RecipesPage from './components/RecipesPage';
import ProgressPage from './components/ProgressPage';
import TaskDetailPage from './components/TaskDetailPage';
import OpenShiftsPage from './components/OpenShiftsPage';
import CalendarPage from './components/CalendarPage';
import ChatPage from './components/ChatPage';
import ProfilePage from './components/ProfilePage';
import { supabase, getOrgId, getRestaurantName } from './utils/supabase';
import { applyTaskCompletionToInventory } from './utils/inventorySync';
import { EmployeeProvider, useEmployee } from './EmployeeContext';
import LoginScreen from './LoginScreen';

// Show notifications even when app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

async function registerForPushNotifications(orgId, employeeName) {
    if (!Device.isDevice) {
    return;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') {
    console.warn('[Notifications] Permission not granted.');
    return;
  }

  try {
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;
    const tokenData = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync();
    const token = tokenData.data;

    // Store token in Supabase so the web app can look it up
    const { error } = await supabase.from('push_tokens').upsert(
      {
        org_id: orgId,
        employee_name: employeeName,
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

  if (Platform.OS === 'android') {
    Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
    });
  }
}

function MainApp() {
  const [activeTab, setActiveTab] = useState('Home');
  const [showProgress, setShowProgress] = useState(false);
  const [showTaskDetail, setShowTaskDetail] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  const [showOpenShifts, setShowOpenShifts] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);

  const { employeeName, displayName, defaultEmployeeName, employeeId } = useEmployee();

  // Org state (no auth needed)
  const [orgId, setOrgId] = useState(null);
  const [restaurantName, setRestaurantName] = useState('');
  const [booting, setBooting] = useState(true);

  const [showProfile, setShowProfile] = useState(false);
  const [profileData, setProfileData] = useState({ displayName: '', avatarColor: '#4CAF50', avatarUrl: null });

  // Tasks from Supabase
  const [tasks, setTasks] = useState([]);

  // Shift data for home page
  const [todayShift, setTodayShift] = useState(null);   // full shift row or null
  const [nextShift, setNextShift] = useState(null);     // next upcoming shift row

  // Filter tasks: off-shift = none; on-shift = only assigned to me
  const displayedTasks = todayShift
    ? tasks.filter(t => (employeeId && t.employee_id === employeeId) || (t.employee_name || '').toLowerCase() === employeeName.toLowerCase())
    : [];

  const taskStats = {
    total: displayedTasks.length,
    completed: displayedTasks.filter(t => t.completed).length,
  };

  // Unread task-assignment notifications (badge on Tasks tab)
  const [taskNotifCount, setTaskNotifCount] = useState(0);

  // Notification listener ref (cleanup on unmount)
  const notificationListener = useRef();
  const responseListener = useRef();
  const orgIdRef = useRef(orgId);
  orgIdRef.current = orgId;

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
    const { data } = await supabase
      .from('profiles')
      .select('display_name, avatar_color, avatar_url')
      .eq('org_id', oid)
      .eq('employee_name', employeeName)
      .maybeSingle();

    if (data) {
      setProfileData({
        displayName: data.display_name || '',
        avatarColor: data.avatar_color || '#4CAF50',
        avatarUrl: data.avatar_url || null,
      });
    }
  }

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

  // ── Boot: load org, fetch tasks, register push token ──────────────────────
  useEffect(() => {
    async function boot() {
      const oid = await getOrgId();
      setOrgId(oid);
      if (oid) {
        const name = await getRestaurantName(oid);
        setRestaurantName(name || '');
        await fetchTasks(oid);
        await checkTodayShift(oid);
        await fetchTaskNotifCount(oid);
        await fetchTransferRequests(oid);
        await fetchProfileData(oid);
        registerForPushNotifications(oid, employeeName);
      }
      setBooting(false);
    }
    boot();

    // Listen for incoming notifications while app is open
    notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
      console.log('[Notification received]', notification);
      if (notification?.request?.content?.data?.type) {
        Vibration.vibrate(500);
      }
    });
    // Listen for notification taps — navigate to Tasks or Schedule
    responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification?.request?.content?.data;
      setActiveTab(data?.type === 'task_assigned' ? 'Tasks' : 'Schedule');
      if (data?.type === 'task_assigned') markTaskNotifsRead(orgIdRef.current);
    });

    return () => {
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, [employeeName]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && orgId) {
        getRestaurantName(orgId).then((name) => {
          if (name != null) setRestaurantName(name);
        });
        fetchTasks(orgId);
        fetchTaskNotifCount(orgId);
        fetchTransferRequests(orgId);
        fetchProfileData(orgId);
      }
    });
    return () => sub?.remove();
  }, [orgId]);

  // ── Fetch tasks from Supabase ─────────────────────────────────────────────
  async function fetchTasks(oid) {
    if (!oid) {
      console.warn('[Tasks] No orgId — cannot fetch');
      return;
    }

    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('org_id', oid)
      .order('created_at', { ascending: true });

    if (error) {
      console.warn('[Tasks] Fetch failed:', error.message);
      setTasks([]);
      return;
    }

    const all = data || [];
    const active = all.filter(t => t.status !== 'completed').map(t => ({
      id: t.id,
      text: t.text,
      completed: t.status === 'completed',
      is_urgent: t.is_urgent ?? false,
      status: t.status,
      employee_name: t.employee_name || null,
      employee_id: t.employee_id || null,
    }));

    setTasks(active);
  }

  // ── Fetch today's shift + next upcoming shift for this employee ───────────
  async function checkTodayShift(oid) {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    // Fetch shifts for this org and date, then match employee name
    const { data: shiftsToday } = await supabase
      .from('shifts')
      .select('*')
      .eq('org_id', oid)
      .eq('shift_date', todayStr);

    const candidateNames = Array.from(
      new Set(
        [employeeName, displayName, defaultEmployeeName]
          .map(n => (n || '').trim())
          .filter(Boolean)
      )
    );

    const normalizedCandidates = candidateNames.map(n => n.toLowerCase());

    const matchesMe = (rawName) => {
      const n = (rawName || '').trim().toLowerCase();
      if (!n || normalizedCandidates.length === 0) return false;
      return normalizedCandidates.some(me => {
        if (!me) return false;
        if (n === me) return true;
        return (
          n.startsWith(me + ' ') ||
          n.endsWith(' ' + me) ||
          n.includes(' ' + me + ' ')
        );
      });
    };

    const todayData = (shiftsToday || []).find((s) => {
      if (employeeId && s.employee_id === employeeId) return true;
      return matchesMe(s.employee_name);
    }) || null;

    setTodayShift(todayData);

    if (!todayData) {
      const { data: upcoming } = await supabase
        .from('shifts')
        .select('*')
        .eq('org_id', oid)
        .gt('shift_date', todayStr)
        .order('shift_date', { ascending: true });

      const nextData = (upcoming || []).find((s) => {
        if (employeeId && s.employee_id === employeeId) return true;
        return matchesMe(s.employee_name);
      }) || null;

      setNextShift(nextData);
    } else {
      setNextShift(null);
    }
  }

  // ── Toggle task complete / incomplete ──────────────────────────────────────
  const toggleTask = async (taskId) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const nowCompleted = !task.completed;
    setTasks(prev =>
      prev.map(t => t.id === taskId ? { ...t, completed: nowCompleted, status: nowCompleted ? 'completed' : 'todo' } : t)
    );
    const { error } = await supabase
      .from('tasks')
      .update({ status: nowCompleted ? 'completed' : 'todo', completed_at: nowCompleted ? new Date().toISOString() : null })
      .eq('id', taskId);
    if (error) {
      console.warn('[Supabase] toggleTask failed:', error.message);
      setTasks(prev =>
        prev.map(t => t.id === taskId ? { ...t, completed: !nowCompleted, status: !nowCompleted ? 'completed' : 'todo' } : t)
      );
    } else if (nowCompleted && orgId) {
      applyTaskCompletionToInventory(supabase, orgId, task.text, true);
    }
  };

  const toggleUrgent = async (taskId) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const nowUrgent = !task.is_urgent;
    setTasks(prev =>
      prev.map(t => t.id === taskId ? { ...t, is_urgent: nowUrgent } : t)
    );
    await supabase.from('tasks').update({ is_urgent: nowUrgent }).eq('id', taskId);
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
      employee_name: assignToMe ? employeeName : null,
      employee_id: assignToMe ? employeeId : null,
    };
    setTasks(prev => [newTask, ...prev]);
    const insertRow = { org_id: orgId, text: trimmed, status: 'todo', is_urgent: true };
    if (assignToMe) {
        insertRow.employee_name = employeeName;
        insertRow.employee_id = employeeId || null;
    }
    const { data, error } = await supabase.from('tasks').insert(insertRow).select().single();
    if (error) {
      console.warn('[Supabase] addUrgentTask failed:', error.message);
      setTasks(prev => prev.filter(t => t.id !== optimisticId));
    } else {
      setTasks(prev =>
        prev.map(t => t.id === optimisticId ? { ...t, id: data.id, employee_name: data.employee_name || null } : t)
      );
    }
  };

  const takeUrgentTask = async (taskId) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.employee_name || task.employee_id) return;
    setTasks(prev =>
      prev.map(t => t.id === taskId ? { ...t, employee_name: employeeName, employee_id: employeeId } : t)
    );
    const { error } = await supabase
      .from('tasks')
      .update({ employee_name: employeeName, employee_id: employeeId || null })
      .eq('id', taskId);
    if (error) {
      console.warn('[Supabase] takeUrgentTask failed:', error.message);
      setTasks(prev =>
        prev.map(t => t.id === taskId ? { ...t, employee_name: null, employee_id: null } : t)
      );
    }
  };

  // ── Task transfer (request → recipient must accept) ─────────────────────────
  const [transferRequests, setTransferRequests] = useState([]);

  async function fetchTransferRequests(oid) {
    if (!oid) return;
    const { data: reqs } = await supabase
      .from('task_transfer_requests')
      .select('*')
      .eq('org_id', oid)
      .eq('to_employee_name', employeeName)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (!reqs?.length) {
      setTransferRequests([]);
      return;
    }
    const taskIds = reqs.map(r => r.task_id);
    const { data: taskData } = await supabase.from('tasks').select('id, text').in('id', taskIds);
    const taskMap = {};
    (taskData || []).forEach(t => { taskMap[t.id] = t.text; });
    setTransferRequests(reqs.map(r => ({ ...r, task_text: taskMap[r.task_id] || 'Task' })));
  }

  const requestTaskTransfer = async (taskId, toEmployeeName) => {
    if (!orgId) return;
    const task = tasks.find(t => t.id === taskId);
    const taskText = task?.text || 'A task';
    const { error } = await supabase.from('task_transfer_requests').insert({
      org_id: orgId,
      task_id: taskId,
      from_employee_name: employeeName,
      to_employee_name: toEmployeeName,
      status: 'pending',
    });
    if (error) {
      console.warn('[Supabase] requestTaskTransfer failed:', error.message);
      return false;
    }
    await supabase.from('notifications').insert({
      org_id: orgId,
      employee_name: toEmployeeName,
      type: 'task_transfer_request',
      title: 'Task Transfer Request',
      body: `${employeeName} wants to transfer "${taskText}" to you. Accept on the Tasks tab.`,
    });
    return true;
  };

  const acceptTaskTransfer = async (requestId) => {
    const req = transferRequests.find(r => r.id === requestId);
    if (!req) return;
    const { error: updateErr } = await supabase
      .from('tasks')
      .update({ employee_name: req.to_employee_name })
      .eq('id', req.task_id);
    if (updateErr) {
      console.warn('[Supabase] acceptTaskTransfer failed:', updateErr.message);
      return;
    }
    await supabase
      .from('task_transfer_requests')
      .update({ status: 'accepted' })
      .eq('id', requestId);
    setTransferRequests(prev => prev.filter(r => r.id !== requestId));
    const oid = orgId;
    if (oid) {
      await fetchTasks(oid);
      fetchTransferRequests(oid);
    }
  };

  const declineTaskTransfer = async (requestId) => {
    await supabase
      .from('task_transfer_requests')
      .update({ status: 'declined' })
      .eq('id', requestId);
    setTransferRequests(prev => prev.filter(r => r.id !== requestId));
  };

  const fetchEmployeesOnShift = async (oid) => {
    if (!oid) return [];
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const { data } = await supabase
      .from('shifts')
      .select('employee_name')
      .eq('org_id', oid)
      .eq('shift_date', todayStr)
      .not('employee_name', 'is', null);
    const names = [...new Set((data || []).map(s => s.employee_name).filter(Boolean))];
    return names.filter(n => n.toLowerCase() !== employeeName.toLowerCase());
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

  const handleOpenShiftsPress = () => setShowOpenShifts(true);
  const handleBackFromOpenShifts = () => setShowOpenShifts(false);

  const handleCalendarPress = () => setShowCalendar(true);
  const handleBackFromCalendar = () => setShowCalendar(false);

  const handleProfilePress = () => setShowProfile(true);
  const handleBackFromProfile = () => setShowProfile(false);

  // ── Render ─────────────────────────────────────────────────────────────────
  if (booting) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4CAF50" />
        <Text style={styles.loadingText}>Connecting to kitchen...</Text>
      </View>
    );
  }

  const prioritizeTask = (taskId) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    setTasks(prev => {
      const rest = prev.filter(t => t.id !== taskId);
      return [task, ...rest];
    });
    setActiveTab('Tasks');
  };

  const renderCurrentPage = () => {
    if (showTaskDetail && selectedTask) {
      const currentTask = tasks.find(t => t.id === selectedTask.id) || selectedTask;
      return <TaskDetailPage onBack={handleBackFromTaskDetail} task={currentTask} toggleTask={toggleTask} toggleUrgent={toggleUrgent} orgId={orgId} requestTaskTransfer={requestTaskTransfer} fetchEmployeesOnShift={fetchEmployeesOnShift} />;
    }
    if (showProgress) {
      return <ProgressPage onBack={handleBackFromProgress} tasks={displayedTasks} allTasks={tasks} toggleTask={toggleTask} onTaskPress={handleTaskPress} />;
    }
    if (showOpenShifts) {
      return <OpenShiftsPage onBack={handleBackFromOpenShifts} orgId={orgId} />;
    }
    if (showCalendar) {
      return <CalendarPage onBack={handleBackFromCalendar} orgId={orgId} />;
    }
    if (showProfile) {
      return <ProfilePage onBack={handleBackFromProfile} profile={profileData} onProfileUpdate={setProfileData} restaurantName={restaurantName} />;
    }

    switch (activeTab) {
      case 'Home':
        return <HomePage orgId={orgId} restaurantName={restaurantName} tasks={displayedTasks} todayShift={todayShift} nextShift={nextShift} taskStats={taskStats} onProfilePress={handleProfilePress} profileData={profileData} onTasksPress={() => setActiveTab('Tasks')} addUrgentTask={addUrgentTask} takeUrgentTask={takeUrgentTask} onUrgentTaskPress={prioritizeTask} />;
      case 'Tasks':
        return <TasksPage onProgressPress={handleProgressPress} tasks={displayedTasks} toggleTask={toggleTask} onTaskPress={handleTaskPress} todayIsShift={!!todayShift} toggleUrgent={toggleUrgent} addUrgentTask={addUrgentTask} onRefresh={async () => { if (orgId) { await fetchTasks(orgId); await fetchTransferRequests(orgId); } }} transferRequests={transferRequests} acceptTaskTransfer={acceptTaskTransfer} declineTaskTransfer={declineTaskTransfer} />;
      case 'Schedule':
        return <SchedulePage onOpenShiftsPress={handleOpenShiftsPress} orgId={orgId} />;
      case 'Recipes':
        return <RecipesPage orgId={orgId} />;
      case 'Chat':
        return <ChatPage orgId={orgId} />;
      default:
        return <HomePage orgId={orgId} restaurantName={restaurantName} tasks={displayedTasks} todayShift={todayShift} nextShift={nextShift} taskStats={taskStats} onProfilePress={handleProfilePress} profileData={profileData} onTasksPress={() => setActiveTab('Tasks')} addUrgentTask={addUrgentTask} takeUrgentTask={takeUrgentTask} onUrgentTaskPress={prioritizeTask} />;
    }
  };

  const getTabIcon = (tab, isActive) => {
    const iconColor = isActive ? '#4CAF50' : '#666';
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
      <View style={[styles.content, (showProgress || showTaskDetail || showOpenShifts || showCalendar || showProfile) && styles.contentFullScreen]}>
        {renderCurrentPage()}
      </View>
      {!showProgress && !showTaskDetail && !showOpenShifts && !showCalendar && !showProfile && (
        <View style={styles.bottomNav}>
          {['Home', 'Tasks', 'Schedule', 'Recipes', 'Chat'].map((tab) => (
            <TouchableOpacity
              key={tab}
              style={styles.navItem}
              onPress={() => {
                if (tab === 'Tasks') markTaskNotifsRead(orgId);
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
              </View>
              <Text style={[styles.navText, activeTab === tab && styles.navTextActive]}>
                {tab}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

function InnerApp() {
  const { email, authLoading } = useEmployee();

  if (authLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4CAF50" />
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    );
  }
  if (!email) {
    return <LoginScreen />;
  }
  return <MainApp />;
}

export default function App() {
  return (
    <EmployeeProvider>
      <InnerApp />
    </EmployeeProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    gap: 16,
  },
  loadingText: {
    fontSize: 16,
    color: '#666',
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
    backgroundColor: 'white',
    paddingVertical: 12,
    paddingHorizontal: 10,
    paddingBottom: 20,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
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
    color: '#666',
    marginTop: 4,
  },
  navTextActive: {
    color: '#4CAF50',
    fontWeight: '600',
  },
  taskBadge: {
    position: 'absolute',
    top: -6,
    right: -10,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#e53e3e',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  taskBadgeText: {
    color: 'white',
    fontSize: 11,
    fontWeight: '700',
  },
});
