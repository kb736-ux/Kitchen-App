import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Alert, Image } from 'react-native';
import { useEmployee } from './EmployeeContext';
import { supabase, getOrgId } from './utils/supabase';
import * as SecureStore from 'expo-secure-store';
import { Colors } from './constants/theme';

function resolveFromProfile(profileData, email) {
  const localPart = (email || '').split('@')[0];
  if (!profileData) return { employeeName: localPart, displayName: localPart, firstName: '', lastName: '' };
  const first = (profileData.first_name || '').trim();
  const last = (profileData.last_name || '').trim();
  const combined = [first, last].filter(Boolean).join(' ').trim();
  const profileDisplay = (profileData.display_name || '').trim();
  const profileEmployee = (profileData.employee_name || '').trim();
  const displayName = combined || profileDisplay || profileEmployee || localPart;
  const employeeName = profileEmployee || profileDisplay || combined || localPart;
  return { employeeName, displayName, firstName: first, lastName: last };
}

function pickBestProfile(rows, userEmail) {
  const arr = Array.isArray(rows) ? rows.filter(Boolean) : (rows ? [rows] : []);
  if (!arr.length) return null;
  const local = (userEmail || '').split('@')[0].trim().toLowerCase();
  const score = (r) => {
    const dn = (r?.display_name || '').trim();
    const en = (r?.employee_name || '').trim();
    let s = 0;
    if (dn) s += 20;
    if (dn.includes(' ')) s += 15;
    if (en) s += 10;
    if (dn && dn.toLowerCase() === local) s -= 20;
    if (en && en.toLowerCase() === local) s -= 12;
    return s;
  };
  return arr.sort((a, b) => score(b) - score(a))[0] || arr[0];
}

async function loadBestProfile(userId, userEmail, orgId = null) {
  const safe = async (query) => {
    try {
      const { data, error } = await query;
      if (error) return null;
      return data || null;
    } catch (_) {
      return null;
    }
  };

  const profileCols = 'id, user_id, employee_name, display_name, first_name, last_name, email';
  const [byOrgUserId, byOrgEmail, byUserIdAnyOrg, byIdAnyOrg, byEmailAnyOrg] = await Promise.all([
    orgId && userId
      ? safe(
          supabase
            .from('profiles')
            .select(profileCols)
            .eq('org_id', orgId)
            .eq('user_id', userId)
            .limit(5)
        )
      : Promise.resolve(null),
    orgId && userEmail
      ? safe(
          supabase
            .from('profiles')
            .select(profileCols)
            .eq('org_id', orgId)
            .ilike('email', userEmail)
            .limit(5)
        )
      : Promise.resolve(null),
    userId
      ? safe(
          supabase
            .from('profiles')
            .select(profileCols)
            .eq('user_id', userId)
            .limit(5)
        )
      : Promise.resolve(null),
    userId
      ? safe(
          supabase
            .from('profiles')
            .select(profileCols)
            .eq('id', userId)
            .limit(5)
        )
      : Promise.resolve(null),
    userEmail
      ? safe(
          supabase
            .from('profiles')
            .select(profileCols)
            .ilike('email', userEmail)
            .limit(5)
        )
      : Promise.resolve(null),
  ]);

  return (
    pickBestProfile(byOrgUserId, userEmail) ||
    pickBestProfile(byOrgEmail, userEmail) ||
    pickBestProfile(byUserIdAnyOrg, userEmail) ||
    pickBestProfile(byIdAnyOrg, userEmail) ||
    pickBestProfile(byEmailAnyOrg, userEmail) ||
    null
  );
}

export default function LoginScreen() {
  const { setIdentity } = useEmployee();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  // Prefill last-used email on this device
  useEffect(() => {
    (async () => {
      try {
        const stored = await SecureStore.getItemAsync('kk_last_email');
        if (stored) setEmail(stored);
      } catch (e) {
        console.warn('[Login] Could not load saved email:', e?.message);
      }
    })();
  }, []);

  const handleLogin = async () => {
    const trimmed = (email || '').trim().toLowerCase();
    if (!trimmed) {
      Alert.alert('Email required', 'Please enter your work email.');
      return;
    }
    if (!(password || '').trim()) {
      Alert.alert('Password required', 'Please enter your password.');
      return;
    }

    setLoading(true);
    try {
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: trimmed,
        password: password.trim(),
      });

      if (authError) {
        setLoading(false);
        Alert.alert('Sign in failed', authError.message || 'Invalid email or password.');
        return;
      }

      const userEmail = authData?.user?.email || trimmed;
      const userId = authData?.user?.id || null;
      const userMetaName = (authData?.user?.user_metadata?.full_name || authData?.user?.user_metadata?.name || '').trim();
      // Remember this email for next time (device-local only)
      try {
        await SecureStore.setItemAsync('kk_last_email', userEmail);
      } catch (e) {
        console.warn('[Login] Could not save email:', e?.message);
      }
      const localPart = userEmail.split('@')[0];
      let employeeName = userMetaName || localPart;
      let displayName = userMetaName || employeeName;
      let employeeId = null;

      const resolvedOrgId = await getOrgId();
      const profile = await loadBestProfile(userId, userEmail, resolvedOrgId);
      const resolved = resolveFromProfile(profile, userEmail);
      employeeName = resolved.employeeName || employeeName;
      displayName = resolved.displayName || displayName;
      const firstName = resolved.firstName || '';
      const lastName = resolved.lastName || '';
      employeeId = profile?.id || null;

      setIdentity({ email: userEmail, employeeName, displayName, firstName, lastName, employeeId });
    } catch (e) {
      console.warn('[Login] Error:', e.message);
      Alert.alert('Error', e.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.card}>
        <Image source={require('./assets/logo.png')} style={styles.logo} />
        <Text style={styles.title}>Sign in to Sheek</Text>
        <Text style={styles.subtitle}>
          Sign in with your work email and password. You can change your display name in Profile.
        </Text>

        <TextInput
          style={styles.input}
          placeholder="you@example.com"
          placeholderTextColor={Colors.textMuted}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          value={email}
          onChangeText={setEmail}
          returnKeyType="next"
        />

        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={Colors.textMuted}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          value={password}
          onChangeText={setPassword}
          returnKeyType="done"
          onSubmitEditing={handleLogin}
        />

        <TouchableOpacity
          style={[styles.primaryButton, loading && { opacity: 0.7 }]}
          onPress={handleLogin}
          activeOpacity={0.85}
          disabled={loading}
        >
          <Text style={styles.primaryButtonText}>{loading ? 'Signing in…' : 'Sign in'}</Text>
        </TouchableOpacity>

        <Text style={styles.helperText}>
          Use the same email your manager used when inviting you. You can update your display name in the Profile tab.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    paddingVertical: 32,
    paddingHorizontal: 24,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 6,
  },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 16,
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
    color: Colors.text,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    color: Colors.textMuted,
    marginBottom: 20,
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: Colors.text,
    marginBottom: 16,
    backgroundColor: Colors.surface,
  },
  primaryButton: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 10,
  },
  primaryButtonText: {
    color: Colors.onPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  helperText: {
    fontSize: 12,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: 4,
  },
});

