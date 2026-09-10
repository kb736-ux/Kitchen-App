import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, KeyboardAvoidingView,
  Platform, Image, Modal,
} from 'react-native';
import { Buffer } from 'buffer';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { supabase, ORG_ID } from '../utils/supabase';
import { useEmployee } from '../EmployeeContext';
import { APP_BRAND_NAME } from '../constants/branding';
import { Colors } from '../constants/theme';

const AVATAR_COLORS = [
  Colors.primary, '#2196F3', '#9C27B0', '#FF5722',
  '#009688', '#E91E63', '#FF9800', '#607D8B',
];

const STORAGE_BUCKET = 'avatars';

function pickBestProfileRow(rows, userEmail = '') {
  const arr = Array.isArray(rows) ? rows.filter(Boolean) : (rows ? [rows] : []);
  if (!arr.length) return null;
  const local = (userEmail || '').split('@')[0].trim().toLowerCase();
  const score = (r) => {
    const dn = (r?.display_name || '').trim();
    const en = (r?.employee_name || '').trim();
    const avatar = (r?.avatar_url || '').trim();
    let s = 0;
    if (avatar) s += 35;
    if (dn) s += 20;
    if (dn.includes(' ')) s += 15;
    if (en) s += 10;
    if (dn && dn.toLowerCase() === local) s -= 20;
    if (en && en.toLowerCase() === local) s -= 12;
    return s;
  };
  return arr.sort((a, b) => score(b) - score(a))[0] || arr[0];
}

function isMissingNameColumnsError(err) {
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes("first_name") || msg.includes("last_name");
}

function splitName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first: '', last: '' };
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

const ProfilePage = ({
  onBack,
  profile,
  onProfileUpdate,
  orgId,
  currentOrgName = '',
  canSwitchOrg = false,
  onOpenOrgPicker,
}) => {
  const { employeeName, displayName: contextDisplayName, firstName: contextFirstName, lastName: contextLastName, logout, updateIdentity } = useEmployee();
  const activeOrgId = orgId || ORG_ID;
  const [currentUserId, setCurrentUserId] = useState(null);
  const [currentUserEmail, setCurrentUserEmail] = useState('');
  const [dbProfileId, setDbProfileId] = useState(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail]             = useState('');
  const [phone, setPhone]             = useState('');
  const [avatarColor, setAvatarColor] = useState(AVATAR_COLORS[0]);
  const [avatarUrl, setAvatarUrl]     = useState(null);
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);
  const [dbEmployeeName, setDbEmployeeName] = useState(null); // exact employee_name from DB for updates
  const [saving, setSaving]           = useState(false);
  const [loading, setLoading]         = useState(true);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [showPhotoMenu, setShowPhotoMenu]   = useState(false);
  const [activeSection, setActiveSection]   = useState('personal');

  useEffect(() => { loadProfile(); }, []);
  useEffect(() => { setAvatarLoadFailed(false); }, [avatarUrl]);
  useEffect(() => {
    const propAvatar = (profile?.avatarUrl || '').trim();
    if (propAvatar) setAvatarUrl(propAvatar);
    const propColor = (profile?.avatarColor || '').trim();
    if (propColor) setAvatarColor(propColor);
  }, [profile?.avatarUrl, profile?.avatarColor]);

  async function loadProfile() {
    setLoading(true);
    let authUser = null;
    try {
      const { data: userRes } = await supabase.auth.getUser();
      authUser = userRes?.user || null;
      setCurrentUserId(authUser?.id || null);
      setCurrentUserEmail(authUser?.email || '');
    } catch (_) {}

    const safeRows = async (query) => {
      try {
        const { data: rows, error } = await query;
        if (error) return [];
        return Array.isArray(rows) ? rows : (rows ? [rows] : []);
      } catch (_) {
        return [];
      }
    };

    let data = null;
    if (authUser?.id) {
      const rows = await safeRows(
        supabase
          .from('profiles')
          .select('*')
          .eq('org_id', activeOrgId)
          .eq('user_id', authUser.id)
          .limit(20)
      );
      data = pickBestProfileRow(rows, authUser?.email || '');
    }

    if (!data && (authUser?.email || '').trim()) {
      const rows = await safeRows(
        supabase
          .from('profiles')
          .select('*')
          .eq('org_id', activeOrgId)
          .ilike('email', authUser.email)
          .limit(20)
      );
      data = pickBestProfileRow(rows, authUser?.email || '');
    }

    if (!data && authUser?.id) {
      const rows = await safeRows(
        supabase
          .from('profiles')
          .select('*')
          .eq('user_id', authUser.id)
          .limit(20)
      );
      data = pickBestProfileRow(rows, authUser?.email || '');
    }

    if (!data && authUser?.id) {
      const rows = await safeRows(
        supabase
          .from('profiles')
          .select('*')
          .eq('id', authUser.id)
          .limit(20)
      );
      data = pickBestProfileRow(rows, authUser?.email || '');
    }

    if (!data) {
      // Last fallback: employee_name (legacy rows)
      const rows = await safeRows(
        supabase
          .from('profiles')
          .select('*')
          .eq('org_id', activeOrgId)
          .ilike('employee_name', employeeName)
          .limit(20)
      );
      data = pickBestProfileRow(rows, authUser?.email || '');
    }

    let adminProfile = null;
    if (authUser?.id) {
      const adminRows = await safeRows(
        supabase
          .from('admin_profiles')
          .select('first_name, last_name, display_name, avatar_url')
          .eq('user_id', authUser.id)
          .limit(5)
      );
      adminProfile = adminRows?.[0] || null;
    }

    if (data) {
      const dbFirst = (data.first_name || '').trim() || (adminProfile?.first_name || '').trim();
      const dbLast = (data.last_name || '').trim() || (adminProfile?.last_name || '').trim();
      const dbDisplay = (data.display_name || '').trim();
      const dbEmployee = (data.employee_name || '').trim();
      setDbProfileId(data.id || null);
      setDbEmployeeName(dbEmployee || employeeName);
      if (dbFirst || dbLast) {
        setFirstName(dbFirst);
        setLastName(dbLast);
      } else if (dbDisplay) {
        const parsed = splitName(dbDisplay);
        setFirstName(parsed.first);
        setLastName(parsed.last);
      } else {
        const fallbackDisplay =
          (adminProfile?.display_name || '').trim() ||
          (profile?.displayName || '').trim() ||
          (contextDisplayName || '').trim();
        const parsed = splitName(fallbackDisplay);
        setFirstName((profile?.firstName || contextFirstName || parsed.first || '').trim() || '');
        setLastName((profile?.lastName || contextLastName || parsed.last || '').trim() || '');
      }
      setEmail(data.email ?? '');
      setPhone(data.phone ?? '');
      setAvatarColor(data.avatar_color ?? AVATAR_COLORS[0]);
      const resolvedAvatar =
        (data.avatar_url || '').trim() ||
        (adminProfile?.avatar_url || '').trim() ||
        (profile?.avatarUrl || '').trim() ||
        null;
      setAvatarUrl(resolvedAvatar);
    } else {
      setDbProfileId(null);
      setDbEmployeeName(employeeName);
      const fallbackDisplay =
        (adminProfile?.display_name || '').trim() ||
        (profile?.displayName || '').trim() ||
        (contextDisplayName || '').trim();
      const parsed = splitName(fallbackDisplay);
      setFirstName((adminProfile?.first_name || contextFirstName || parsed.first || '').trim());
      setLastName((adminProfile?.last_name || contextLastName || parsed.last || '').trim());
      const fallbackAvatar = (profile?.avatarUrl || '').trim() || null;
      const adminAvatar = (adminProfile?.avatar_url || '').trim() || null;
      if (adminAvatar) setAvatarUrl(adminAvatar);
      else if (fallbackAvatar) setAvatarUrl(fallbackAvatar);
      const fallbackColor = (profile?.avatarColor || '').trim();
      if (fallbackColor) setAvatarColor(fallbackColor);
      if (!email) setEmail((authUser?.email || '').trim());
    }
    setLoading(false);
  }

  // ── Photo picker ────────────────────────────────────────────────────────────
  async function pickFromLibrary() {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please allow access to your photo library in Settings.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions ? ImagePicker.MediaTypeOptions.Images : 'images',
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
        base64: true,
      });
      setShowPhotoMenu(false);
      if (!result.canceled && result.assets?.[0]) {
        await uploadPhoto(result.assets[0].uri, result.assets[0].base64);
      }
    } catch (e) {
      setShowPhotoMenu(false);
      console.warn('[Library]', e?.message);
    }
  }

  async function takePhoto() {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please allow camera access in Settings.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
        base64: true,
      });
      setShowPhotoMenu(false);
      if (!result.canceled && result.assets?.[0]) {
        await uploadPhoto(result.assets[0].uri, result.assets[0].base64);
      }
    } catch (e) {
      setShowPhotoMenu(false);
      console.warn('[Camera]', e?.message);
      Alert.alert(
        'Camera unavailable',
        'Use "Choose from Library" to pick a photo instead, or try on a physical device if you\'re using a simulator.'
      );
    }
  }

  async function removePhoto() {
    setShowPhotoMenu(false);
    setAvatarUrl(null);
    try {
      const { data: authRes } = await supabase.auth.getUser();
      const liveUser = authRes?.user || null;
      const liveUserId = liveUser?.id || currentUserId || null;

      if (dbProfileId) {
        await supabase
          .from('profiles')
          .update({ avatar_url: null })
          .eq('id', dbProfileId);
      } else if (liveUserId) {
        await supabase
          .from('profiles')
          .update({ avatar_url: null })
          .eq('org_id', activeOrgId)
          .eq('user_id', liveUserId);
      }
    } catch (_) {
      // Ignore if avatar_url column does not exist
    }
    const combined = [firstName, lastName].filter(Boolean).join(' ').trim() || contextDisplayName || employeeName;
    onProfileUpdate?.({ firstName, lastName, displayName: combined, avatarColor, avatarUrl: null });
  }

  async function resolveExistingProfileRow(liveUserId, liveUserEmail) {
    // 1) Strongest match: auth user_id (any org, to recover bad org_id data)
    if (liveUserId) {
      const byUserIdAnyOrg = await supabase
        .from('profiles')
        .select('id, user_id, email, employee_name, org_id')
        .eq('user_id', liveUserId)
        .limit(5);
      if ((byUserIdAnyOrg?.data || []).length) {
        return byUserIdAnyOrg.data[0];
      }
    }

    // 2) Same-org email match
    if ((liveUserEmail || '').trim()) {
      const byEmail = await supabase
        .from('profiles')
        .select('id, user_id, email, employee_name, org_id')
        .eq('org_id', activeOrgId)
        .ilike('email', liveUserEmail)
        .limit(5);
      if ((byEmail?.data || []).length) {
        return byEmail.data[0];
      }
    }

    // 3) Legacy fallback: same-org employee_name
    const byName = await supabase
      .from('profiles')
      .select('id, user_id, email, employee_name, org_id')
      .eq('org_id', activeOrgId)
      .ilike('employee_name', employeeName)
      .limit(5);
    if ((byName?.data || []).length) {
      return byName.data[0];
    }

    return null;
  }

  async function saveProfilePayload(profilePayload, liveUserId, liveUserEmail) {
    const legacyPayload = { ...profilePayload };
    delete legacyPayload.first_name;
    delete legacyPayload.last_name;

    const runUpdate = async (payload, id) => {
      const { error } = await supabase
        .from('profiles')
        .update(payload)
        .eq('id', id);
      return error || null;
    };

    const runInsert = async (payload) => {
      const { error } = await supabase
        .from('profiles')
        .insert({ id: liveUserId, ...payload });
      return error || null;
    };

    let existingRow = dbProfileId ? { id: dbProfileId } : await resolveExistingProfileRow(liveUserId, liveUserEmail);

    if (existingRow?.id) {
      let error = await runUpdate(profilePayload, existingRow.id);
      if (error && isMissingNameColumnsError(error)) {
        error = await runUpdate(legacyPayload, existingRow.id);
      }
      if (error) throw error;
      setDbProfileId(existingRow.id);
      return;
    }

    // Insert with stable ID; if row already exists on same PK, recover by update.
    let insertError = await runInsert(profilePayload);
    if (insertError && isMissingNameColumnsError(insertError)) {
      insertError = await runInsert(legacyPayload);
    }
    if (!insertError) {
      setDbProfileId(liveUserId);
      return;
    }

    const duplicatePk =
      insertError?.code === '23505' ||
      /duplicate key/i.test(insertError?.message || '') ||
      /profiles_pkey/i.test(insertError?.message || '');
    if (!duplicatePk) throw insertError;

    let recoverError = await runUpdate(profilePayload, liveUserId);
    if (recoverError && isMissingNameColumnsError(recoverError)) {
      recoverError = await runUpdate(legacyPayload, liveUserId);
    }
    if (recoverError) throw recoverError;
    setDbProfileId(liveUserId);
  }

  async function uploadPhoto(uri, base64) {
    setUploadingPhoto(true);
    try {
      const { data: authRes } = await supabase.auth.getUser();
      const liveUser = authRes?.user || null;
      const liveUserId = liveUser?.id || currentUserId || null;
      const liveUserEmail = liveUser?.email || currentUserEmail || '';
      if (!liveUserId) {
        throw new Error('Session expired. Please sign in again.');
      }

      const fileName = `${activeOrgId}/${employeeName.toLowerCase().replace(/\s+/g, '_')}.jpg`;
      const storageKey = (liveUserId || employeeName || 'user').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      const fileNameSafe = `${activeOrgId}/${storageKey}.jpg`;

      let uploadError;
      
      if (base64) {
        // Use base64 string because fetch(uri) is notoriously flaky in React Native
        const { error } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(fileNameSafe, Buffer.from(base64, 'base64'), {
            contentType: 'image/jpeg',
            upsert: true,
          });
        uploadError = error;
      } else {
        // Fallback for older approach if base64 somehow isn't passed (shouldn't happen)
        const response = await fetch(uri);
        const blob = await response.blob();
        const { error } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(fileNameSafe, blob, {
            contentType: 'image/jpeg',
            upsert: true,
          });
        uploadError = error;
      }

      if (uploadError) throw uploadError;

      // Get the public URL
      const { data: urlData } = supabase.storage
        .from(STORAGE_BUCKET)
        .getPublicUrl(fileNameSafe);

      const publicUrl = urlData?.publicUrl;
      if (!publicUrl) throw new Error('Could not get public URL');

      // Bust cache with timestamp
      const timedUrl = publicUrl + '?t=' + Date.now();
      setAvatarUrl(timedUrl);

      // Persist to profiles (update existing row or insert if missing)
      const combinedName = [firstName, lastName].filter(Boolean).join(' ').trim() || employeeName;
      const profilePayload = {
        org_id: activeOrgId,
        employee_name: employeeName,
        first_name: (firstName || '').trim() || null,
        last_name: (lastName || '').trim() || null,
        display_name: combinedName,
        email: (email || liveUserEmail || '').trim() || null,
        user_id: liveUserId,
        ...(publicUrl != null && { avatar_url: publicUrl }),
      };

      await saveProfilePayload(profilePayload, liveUserId, liveUserEmail);

      onProfileUpdate?.({ firstName, lastName, displayName: combinedName, avatarColor, avatarUrl: timedUrl });
    } catch (e) {
      const isBucketMissing = (e?.message || '').toLowerCase().includes('bucket') && (e?.message || '').toLowerCase().includes('not found');
      const message = isBucketMissing
        ? `Create a storage bucket named "avatars" in Supabase: Dashboard → Storage → New bucket → Name: avatars → set Public. Then try again.`
        : (e?.message || 'Could not upload photo.');
      Alert.alert('Upload failed', message);
      console.warn('[Avatar upload]', e?.message);
    } finally {
      setUploadingPhoto(false);
    }
  }

  // ── Save profile (update if row exists, otherwise insert) ──
  async function saveProfile() {
    setSaving(true);
    const { data: authRes } = await supabase.auth.getUser();
    const liveUser = authRes?.user || null;
    const liveUserId = liveUser?.id || currentUserId || null;
    const liveUserEmail = liveUser?.email || currentUserEmail || '';
    if (!liveUserId) {
      Alert.alert('Session expired', 'Please sign in again and retry.');
      setSaving(false);
      return;
    }

    const combinedName = [firstName, lastName].filter(Boolean).join(' ').trim() || employeeName;
    const payload = {
      org_id: activeOrgId,
      employee_name: employeeName,
      first_name: (firstName || '').trim() || null,
      last_name: (lastName || '').trim() || null,
      display_name: combinedName,
      email: (email || liveUserEmail || '').trim(),
      user_id: liveUserId,
    };

    try {
      await saveProfilePayload(payload, liveUserId, liveUserEmail);

      onProfileUpdate?.({ firstName, lastName, displayName: combinedName, avatarColor, avatarUrl });
      updateIdentity?.({ displayName: combinedName, firstName, lastName });
      await loadProfile();
      Alert.alert('Saved', 'Your profile has been updated.');
    } catch (e) {
      Alert.alert('Error', 'Could not save profile: ' + (e?.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  }

  const displayName = [firstName, lastName].filter(Boolean).join(' ').trim() || contextDisplayName || employeeName;
  const initials = (displayName || employeeName)
    .split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color="#2d3748" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Profile</Text>
        <TouchableOpacity onPress={saveProfile} disabled={saving} style={styles.saveBtn}>
          {saving
            ? <ActivityIndicator size="small" color={Colors.primary} />
            : <Text style={styles.saveBtnText}>Save</Text>}
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Avatar */}
        <View style={styles.avatarSection}>
          <TouchableOpacity
            style={styles.avatarWrap}
            onPress={() => setShowPhotoMenu(true)}
            activeOpacity={0.85}
          >
            {uploadingPhoto ? (
              <View style={[styles.avatarCircle, { backgroundColor: avatarColor }]}>
                <ActivityIndicator color="white" size="large" />
              </View>
            ) : (avatarUrl && !avatarLoadFailed) ? (
              <Image
                source={{ uri: avatarUrl }}
                style={styles.avatarCircle}
                onError={() => setAvatarLoadFailed(true)}
              />
            ) : (
              <View style={[styles.avatarCircle, { backgroundColor: avatarColor }]}>
                <Text style={styles.avatarInitials}>{initials}</Text>
              </View>
            )}
            {/* Camera badge */}
            <View style={styles.cameraBadge}>
              <Ionicons name="camera" size={14} color="white" />
            </View>
          </TouchableOpacity>
          <Text style={styles.avatarName}>{displayName || employeeName}</Text>
          <Text style={styles.avatarRole}>{APP_BRAND_NAME}</Text>
          <TouchableOpacity onPress={() => setShowPhotoMenu(true)} style={styles.changePhotoBtn}>
            <Text style={styles.changePhotoText}>Change Photo</Text>
          </TouchableOpacity>
        </View>

        {/* Color picker — only shown when no photo */}
        {(!avatarUrl || avatarLoadFailed) && (
          <View style={styles.colorSection}>
            <Text style={styles.colorLabel}>Avatar Color</Text>
            <View style={styles.colorRow}>
              {AVATAR_COLORS.map(color => (
                <TouchableOpacity
                  key={color}
                  style={[
                    styles.colorSwatch,
                    { backgroundColor: color },
                    avatarColor === color && styles.colorSwatchSelected,
                  ]}
                  onPress={() => setAvatarColor(color)}
                  activeOpacity={0.8}
                >
                  {avatarColor === color && <Ionicons name="checkmark" size={14} color="white" />}
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Personal Info */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.sectionHeader}
            onPress={() => setActiveSection(activeSection === 'personal' ? null : 'personal')}
            activeOpacity={0.7}
          >
            <View style={styles.sectionHeaderLeft}>
              <View style={[styles.sectionIcon, { backgroundColor: Colors.primarySoft }]}>
                <Ionicons name="person-outline" size={18} color={Colors.primary} />
              </View>
              <Text style={styles.sectionTitle}>Personal Info</Text>
            </View>
            <Ionicons name={activeSection === 'personal' ? 'chevron-up' : 'chevron-down'} size={18} color="#a0aec0" />
          </TouchableOpacity>

          {activeSection === 'personal' && (
            <View style={styles.sectionBody}>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>First Name</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={firstName}
                  onChangeText={setFirstName}
                  placeholder="First name"
                  placeholderTextColor="#a0aec0"
                  autoCapitalize="words"
                />
              </View>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Last Name</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={lastName}
                  onChangeText={setLastName}
                  placeholder="Last name"
                  placeholderTextColor="#a0aec0"
                  autoCapitalize="words"
                />
              </View>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Email</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  placeholderTextColor="#a0aec0"
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Phone Number</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="+1 (555) 000-0000"
                  placeholderTextColor="#a0aec0"
                  keyboardType="phone-pad"
                />
              </View>
            </View>
          )}
        </View>

        {/* Security */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.sectionHeader}
            onPress={() => setActiveSection(activeSection === 'security' ? null : 'security')}
            activeOpacity={0.7}
          >
            <View style={styles.sectionHeaderLeft}>
              <View style={[styles.sectionIcon, { backgroundColor: '#ebf8ff' }]}>
                <Ionicons name="lock-closed-outline" size={18} color="#3182ce" />
              </View>
              <Text style={styles.sectionTitle}>Security</Text>
            </View>
            <Ionicons name={activeSection === 'security' ? 'chevron-up' : 'chevron-down'} size={18} color="#a0aec0" />
          </TouchableOpacity>

          {activeSection === 'security' && (
            <View style={styles.sectionBody}>
              <View style={styles.infoRow}>
                <Ionicons name="information-circle-outline" size={16} color="#718096" style={{ marginRight: 8 }} />
                <Text style={styles.infoText}>To change your password, contact your manager.</Text>
              </View>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Employee ID</Text>
                <View style={[styles.fieldInput, styles.fieldReadOnly]}>
                  <Text style={styles.fieldReadOnlyText}>{employeeName}</Text>
                </View>
              </View>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>App</Text>
                <View style={[styles.fieldInput, styles.fieldReadOnly]}>
                  <Text style={styles.fieldReadOnlyText}>{APP_BRAND_NAME}</Text>
                </View>
              </View>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Restaurant</Text>
                <View style={[styles.fieldRow, styles.fieldReadOnly]}>
                  <Text style={[styles.fieldReadOnlyText, { flex: 1 }]} numberOfLines={1}>
                    {currentOrgName || '—'}
                  </Text>
                  {canSwitchOrg ? (
                    <TouchableOpacity onPress={onOpenOrgPicker} style={styles.switchOrgBtn} activeOpacity={0.7}>
                      <Text style={styles.switchOrgBtnText}>Switch</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
              <TouchableOpacity
                style={styles.logoutBtn}
                onPress={() => {
                  Alert.alert(
                    'Sign out',
                    'Are you sure you want to sign out?',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Sign out', style: 'destructive', onPress: async () => { await logout(); onBack?.(); } },
                    ]
                  );
                }}
              >
                <Ionicons name="log-out-outline" size={20} color="#e53e3e" style={{ marginRight: 8 }} />
                <Text style={styles.logoutBtnText}>Sign out</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Save */}
        <TouchableOpacity
          style={[styles.primaryBtn, saving && styles.primaryBtnDisabled]}
          onPress={saveProfile}
          disabled={saving}
        >
          {saving
            ? <ActivityIndicator size="small" color="white" />
            : <>
                <Ionicons name="checkmark-circle-outline" size={20} color="white" style={{ marginRight: 8 }} />
                <Text style={styles.primaryBtnText}>Save Changes</Text>
              </>}
        </TouchableOpacity>
        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Photo source picker modal */}
      <Modal
        visible={showPhotoMenu}
        transparent
        animationType="slide"
        onRequestClose={() => setShowPhotoMenu(false)}
      >
        <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setShowPhotoMenu(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.menuSheet}>
            <View style={styles.menuHandle} />
            <Text style={styles.menuTitle}>Profile Photo</Text>

            <TouchableOpacity style={styles.menuItem} onPress={takePhoto}>
              <View style={[styles.menuItemIcon, { backgroundColor: Colors.primarySoft }]}>
                <Ionicons name="camera-outline" size={22} color={Colors.primary} />
              </View>
              <Text style={styles.menuItemText}>Take Photo</Text>
              <Ionicons name="chevron-forward" size={18} color="#cbd5e0" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.menuItem} onPress={pickFromLibrary}>
              <View style={[styles.menuItemIcon, { backgroundColor: '#ebf8ff' }]}>
                <Ionicons name="images-outline" size={22} color="#3182ce" />
              </View>
              <Text style={styles.menuItemText}>Choose from Library</Text>
              <Ionicons name="chevron-forward" size={18} color="#cbd5e0" />
            </TouchableOpacity>

            {avatarUrl && (
              <TouchableOpacity style={styles.menuItem} onPress={removePhoto}>
                <View style={[styles.menuItemIcon, { backgroundColor: '#fff5f5' }]}>
                  <Ionicons name="trash-outline" size={22} color="#e53e3e" />
                </View>
                <Text style={[styles.menuItemText, { color: '#e53e3e' }]}>Remove Photo</Text>
                <Ionicons name="chevron-forward" size={18} color="#cbd5e0" />
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.menuCancel} onPress={() => setShowPhotoMenu(false)}>
              <Text style={styles.menuCancelText}>Cancel</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </KeyboardAvoidingView>
  );
};

export default ProfilePage;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 60, paddingBottom: 16,
    backgroundColor: 'white', borderBottomWidth: 1, borderBottomColor: '#e2e8f0',
  },
  backBtn: { padding: 4 },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700', color: '#2d3748' },
  saveBtn: { paddingHorizontal: 4, minWidth: 40, alignItems: 'flex-end' },
  saveBtnText: { fontSize: 16, fontWeight: '700', color: Colors.primary },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 24 },

  // Avatar
  avatarSection: { alignItems: 'center', marginBottom: 20 },
  avatarWrap: { position: 'relative', marginBottom: 12 },
  avatarCircle: {
    width: 96, height: 96, borderRadius: 48,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18, shadowRadius: 10, elevation: 6,
  },
  avatarInitials: { fontSize: 36, fontWeight: '800', color: 'white' },
  cameraBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: Colors.primary, borderWidth: 2, borderColor: 'white',
    justifyContent: 'center', alignItems: 'center',
  },
  avatarName: { fontSize: 22, fontWeight: '700', color: '#2d3748' },
  avatarRole: { fontSize: 14, color: '#718096', marginTop: 2, marginBottom: 10 },
  changePhotoBtn: {
    backgroundColor: Colors.primarySoft, borderWidth: 1.5, borderColor: Colors.successSoft,
    borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6,
  },
  changePhotoText: { fontSize: 13, fontWeight: '700', color: Colors.primary },

  // Color picker
  colorSection: { alignItems: 'center', marginBottom: 20 },
  colorLabel: { fontSize: 12, fontWeight: '600', color: '#a0aec0', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  colorRow: { flexDirection: 'row', gap: 10 },
  colorSwatch: {
    width: 30, height: 30, borderRadius: 15,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: 'transparent',
  },
  colorSwatchSelected: { borderColor: 'white', transform: [{ scale: 1.2 }] },

  // Sections
  section: {
    backgroundColor: 'white', borderRadius: 16, marginBottom: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 6, elevation: 2, overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', padding: 16,
  },
  sectionHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sectionIcon: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#2d3748' },
  sectionBody: { paddingHorizontal: 16, paddingBottom: 16, borderTopWidth: 1, borderTopColor: '#f7fafc' },

  fieldGroup: { marginTop: 14 },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: '#718096', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 },
  fieldInput: {
    backgroundColor: '#f7fafc', borderWidth: 1.5, borderColor: '#e2e8f0',
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: '#2d3748',
  },
  fieldReadOnly: { justifyContent: 'center' },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f7fafc',
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  switchOrgBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: Colors.primarySoft,
    marginLeft: 8,
  },
  switchOrgBtnText: { fontSize: 14, fontWeight: '700', color: '#2e7d32' },
  fieldReadOnlyText: { fontSize: 15, color: '#a0aec0' },
  infoRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14, backgroundColor: '#f7fafc', borderRadius: 8, padding: 10 },
  infoText: { fontSize: 13, color: '#718096', flex: 1 },
  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginTop: 20, paddingVertical: 14, borderRadius: 12,
    backgroundColor: '#fff5f5', borderWidth: 1.5, borderColor: '#feb2b2',
  },
  logoutBtnText: { fontSize: 16, fontWeight: '600', color: '#e53e3e' },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 16, marginTop: 8,
    shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  primaryBtnDisabled: { backgroundColor: '#a8d5a2' },
  primaryBtnText: { fontSize: 16, fontWeight: '700', color: 'white' },

  // Photo menu
  menuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  menuSheet: {
    backgroundColor: 'white', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingBottom: 36, paddingTop: 12,
  },
  menuHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#e2e8f0', alignSelf: 'center', marginBottom: 16 },
  menuTitle: { fontSize: 17, fontWeight: '700', color: '#2d3748', marginBottom: 16, textAlign: 'center' },
  menuItem: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f7fafc',
  },
  menuItemIcon: { width: 42, height: 42, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  menuItemText: { flex: 1, fontSize: 16, fontWeight: '500', color: '#2d3748' },
  menuCancel: { alignItems: 'center', paddingVertical: 16, marginTop: 4 },
  menuCancelText: { fontSize: 16, color: '#718096', fontWeight: '500' },
});
