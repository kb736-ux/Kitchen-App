import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useEmployee } from './EmployeeContext';
import { supabase, ORG_ID } from './utils/supabase';
import * as SecureStore from 'expo-secure-store';

function resolveFromProfile(profileData, email) {
  const localPart = (email || '').split('@')[0];
  if (!profileData) return { employeeName: localPart, displayName: localPart };
  const employeeName = (profileData.employee_name || '').trim() || (profileData.display_name || '').trim() || localPart;
  const displayName = (profileData.display_name || '').trim() || (profileData.employee_name || '').trim() || localPart;
  return { employeeName, displayName };
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
      // Remember this email for next time (device-local only)
      try {
        await SecureStore.setItemAsync('kk_last_email', userEmail);
      } catch (e) {
        console.warn('[Login] Could not save email:', e?.message);
      }
      let employeeName = userEmail.split('@')[0];
      let displayName = employeeName;

      if (ORG_ID) {
        let { data: profile } = await supabase
          .from('profiles')
          .select('employee_name, display_name')
          .eq('org_id', ORG_ID)
          .eq('email', userEmail)
          .maybeSingle();

        if (!profile) {
          const { data: altProfile } = await supabase
            .from('profiles')
            .select('employee_name, display_name')
            .eq('org_id', ORG_ID)
            .ilike('employee_name', employeeName)
            .limit(1)
            .maybeSingle();
          profile = altProfile;
        }

        const resolved = resolveFromProfile(profile, userEmail);
        employeeName = resolved.employeeName;
        displayName = resolved.displayName;
      }

      setIdentity({ email: userEmail, employeeName, displayName });
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
        <View style={styles.iconCircle}>
          <Ionicons name="person-circle" size={40} color="#4CAF50" />
        </View>
        <Text style={styles.title}>Sign in to the kitchen</Text>
        <Text style={styles.subtitle}>
          Sign in with your work email and password. You can change your display name in Profile.
        </Text>

        <TextInput
          style={styles.input}
          placeholder="you@example.com"
          placeholderTextColor="#a0aec0"
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
          placeholderTextColor="#a0aec0"
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
    backgroundColor: '#f8f9fa',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: 'white',
    borderRadius: 16,
    paddingVertical: 32,
    paddingHorizontal: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 6,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#e8f5e9',
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
    color: '#1a202c',
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    color: '#4a5568',
    marginBottom: 20,
  },
  input: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#1a202c',
    marginBottom: 16,
    backgroundColor: '#fdfdfd',
  },
  primaryButton: {
    backgroundColor: '#4CAF50',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 10,
  },
  primaryButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  helperText: {
    fontSize: 12,
    color: '#718096',
    textAlign: 'center',
    marginTop: 4,
  },
});

