import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase, getOrgId, clearOrgIdCache, EMPLOYEE_NAME as DEFAULT_EMPLOYEE_NAME } from './utils/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

const EmployeeContext = createContext({
  employeeId: null,
  authUserId: null,
  employeeName: '',
  displayName: '',
  firstName: '',
  lastName: '',
  email: '',
  authLoading: true,
  setIdentity: () => {},
  updateDisplayName: () => {},
  updateIdentity: () => {},
  logout: () => {},
});

function resolveFromProfile(profileData, userEmail) {
  const localPart = (userEmail || '').split('@')[0];
  if (!profileData) {
    const base = (DEFAULT_EMPLOYEE_NAME || '').trim() || localPart;
    return { employeeName: base, displayName: base, firstName: '', lastName: '' };
  }
  const profileEmployee = (profileData.employee_name || '').trim();
  const profileDisplay = (profileData.display_name || '').trim();
  const first = (profileData.first_name || '').trim();
  const last = (profileData.last_name || '').trim();
  const combined = [first, last].filter(Boolean).join(' ').trim();
  const displayName = combined || profileDisplay || profileEmployee || (DEFAULT_EMPLOYEE_NAME || '').trim() || localPart;
  const base = profileEmployee || profileDisplay || combined || (DEFAULT_EMPLOYEE_NAME || '').trim() || localPart;
  const employeeName = base;
  return { employeeName, displayName, firstName: first, lastName: last };
}

const IDENTITY_CACHE_PREFIX = 'kk_identity_cache_v1';

function identityCacheKey(userEmail) {
  return `${IDENTITY_CACHE_PREFIX}:${String(userEmail || '').trim().toLowerCase()}`;
}

async function loadIdentityCache(userEmail) {
  const key = identityCacheKey(userEmail);
  if (!key) return null;
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      employeeName: (parsed.employeeName || '').trim() || null,
      displayName: (parsed.displayName || '').trim() || null,
      firstName: (parsed.firstName || '').trim() || null,
      lastName: (parsed.lastName || '').trim() || null,
      employeeId: (parsed.employeeId || '').trim() || null,
    };
  } catch (_) {
    return null;
  }
}

async function saveIdentityCache(userEmail, payload) {
  const key = identityCacheKey(userEmail);
  if (!key) return;
  try {
    await AsyncStorage.setItem(key, JSON.stringify({
      employeeName: payload?.employeeName || '',
      displayName: payload?.displayName || '',
      firstName: payload?.firstName || '',
      lastName: payload?.lastName || '',
      employeeId: payload?.employeeId || '',
    }));
  } catch (_) {}
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
  if (!userId && !userEmail) return null;
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

async function loadBestProfileWithRetry(userId, userEmail, orgId = null, attempts = 2) {
  for (let i = 0; i < attempts; i += 1) {
    const profile = await loadBestProfile(userId, userEmail, orgId);
    if (profile) return profile;
    if (i < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
  }
  return null;
}

export function EmployeeProvider({ children, identityVersion = 0 }) {
  const [employeeId, setEmployeeId] = useState(null);
  const [employeeName, setEmployeeName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [authLoading, setAuthLoading] = useState(true);
  const [authUserId, setAuthUserId] = useState(null);

  const setIdentity = ({ email: rawEmail, employeeName: rawName, displayName: rawDisplayName, firstName: rawFirst, lastName: rawLast, employeeId: rawId }) => {
    const nextEmail = (rawEmail || '').trim().toLowerCase();
    const nextName = (rawName || '').trim();
    const nextDisplay = (rawDisplayName || '').trim() || nextName;
    const nextFirst = (rawFirst || '').trim();
    const nextLast = (rawLast || '').trim();
    setEmail(nextEmail);
    setEmployeeName(nextName);
    setDisplayName(nextDisplay);
    setFirstName(nextFirst);
    setLastName(nextLast);
    setEmployeeId(rawId || null);
    // authUserId is set from session separately; do not clear here
  };

  const updateDisplayName = (name) => {
    const next = (name || '').trim();
    if (next) setDisplayName(next);
  };

  const updateIdentity = (payload) => {
    if (!payload) return;
    if ((payload.displayName || '').trim()) setDisplayName(payload.displayName.trim());
    if (payload.firstName !== undefined) setFirstName((payload.firstName || '').trim());
    if (payload.lastName !== undefined) setLastName((payload.lastName || '').trim());
  };

  const logout = async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn('[Auth] signOut error:', e?.message);
    }
    setEmployeeName('');
    setDisplayName('');
    setFirstName('');
    setLastName('');
    setEmployeeId(null);
    setAuthUserId(null);
    setEmail('');
    clearOrgIdCache();
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (cancelled || !session?.user?.email) {
          setAuthUserId(null);
          setAuthLoading(false);
          return;
        }
        const userEmail = session.user.email;
        const userId = session.user.id;
        if (!cancelled) setAuthUserId(userId || null);
        const localPart = userEmail.split('@')[0];
        const userMetaName = (session.user.user_metadata?.full_name || session.user.user_metadata?.name || '').trim();
        const cached = await loadIdentityCache(userEmail);
        let employeeName = cached?.employeeName || (DEFAULT_EMPLOYEE_NAME || '').trim() || userMetaName || localPart;
        let displayName = cached?.displayName || userMetaName || employeeName;
        let firstName = cached?.firstName || '';
        let lastName = cached?.lastName || '';
        let employeeId = null;
        if (cached?.employeeId) employeeId = cached.employeeId;
        // Always hydrate from cache/session so the app shell can render immediately (names refine after network).
        if (!cancelled) {
          setIdentity({ email: userEmail, employeeName, displayName, firstName, lastName, employeeId });
          setAuthLoading(false);
        }

        const resolvedOrgId = await getOrgId();
        const profile = await loadBestProfileWithRetry(userId, userEmail, resolvedOrgId, 2);
        const profileEmail = String(profile?.email || '').trim().toLowerCase();
        const authEmail = String(userEmail || '').trim().toLowerCase();
        if (profile?.id && userId && !profile.user_id && profileEmail && profileEmail === authEmail) {
          // Legacy self-heal: link profile row to auth UUID if missing.
          try {
            await supabase
              .from('profiles')
              .update({ user_id: userId, email: userEmail })
              .eq('id', profile.id);
          } catch (_) {}
        }
        const resolved = resolveFromProfile(profile, userEmail);
        employeeName = resolved.employeeName || employeeName;
        displayName = resolved.displayName || displayName;
        firstName = resolved.firstName || firstName;
        lastName = resolved.lastName || lastName;
        employeeId = profile?.id || null;

        // Fallback UUID lookup only if user_id/email lookup failed.
        if (!employeeId && employeeName && resolvedOrgId) {
          const candidateNames = Array.from(
            new Set([employeeName, displayName].map(n => (n || '').trim()).filter(Boolean))
          );
          
          if (candidateNames.length > 0) {
            // query profiles to match employee id
            const { data: posData } = await supabase
              .from('profiles')
              .select('id, user_id, employee_name, display_name, first_name, last_name')
              .eq('org_id', resolvedOrgId)
              .limit(200);

            const normalizedCandidates = candidateNames.map(n => n.toLowerCase());
            const matchedPos = (posData || []).find(p => {
              if (p?.user_id && userId && p.user_id === userId) return true;
              const namesToMatch = [
                (p.employee_name || '').trim().toLowerCase(),
                (p.display_name || '').trim().toLowerCase()
              ].filter(Boolean);
              
              return namesToMatch.some(n => {
                return normalizedCandidates.some(me => {
                  if (!me) return false;
                  if (n === me) return true;
                  return n.startsWith(me + ' ') || n.endsWith(' ' + me) || n.includes(' ' + me + ' ');
                });
              });
            });
            if (matchedPos) employeeId = matchedPos.id;
          }
        }
        if (!cancelled) {
          setIdentity({ email: userEmail, employeeName, displayName, firstName, lastName, employeeId });
          await saveIdentityCache(userEmail, { employeeName, displayName, firstName, lastName, employeeId });
        }
      } catch (e) {
        console.warn('[Auth] Session restore failed:', e?.message);
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [identityVersion]);

  return (
    <EmployeeContext.Provider
      value={{
        employeeId,
        authUserId,
        employeeName,
        displayName,
        firstName,
        lastName,
        email,
        authLoading,
        setIdentity,
        updateDisplayName,
        updateIdentity,
        logout,
        defaultEmployeeName: DEFAULT_EMPLOYEE_NAME,
      }}
    >
      {children}
    </EmployeeContext.Provider>
  );
}

export function useEmployee() {
  return useContext(EmployeeContext);
}

