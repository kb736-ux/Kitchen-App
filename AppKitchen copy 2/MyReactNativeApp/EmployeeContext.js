import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase, ORG_ID, EMPLOYEE_NAME as DEFAULT_EMPLOYEE_NAME } from './utils/supabase';

const EmployeeContext = createContext({
  employeeId: null,
  employeeName: '',
  displayName: '',
  email: '',
  authLoading: true,
  setIdentity: () => {},
  updateDisplayName: () => {},
  logout: () => {},
});

function resolveFromProfile(profileData, userEmail) {
  const localPart = (userEmail || '').split('@')[0];
  if (!profileData) {
    const base = (DEFAULT_EMPLOYEE_NAME || '').trim() || localPart;
    return { employeeName: base, displayName: base };
  }
  const profileEmployee = (profileData.employee_name || '').trim();
  const profileDisplay = (profileData.display_name || '').trim();
  const base = profileEmployee || profileDisplay || (DEFAULT_EMPLOYEE_NAME || '').trim() || localPart;
  const employeeName = base;
  const displayName = profileDisplay || base;
  return { employeeName, displayName };
}

export function EmployeeProvider({ children }) {
  const [employeeId, setEmployeeId] = useState(null);
  const [employeeName, setEmployeeName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [authLoading, setAuthLoading] = useState(true);

  const setIdentity = ({ email: rawEmail, employeeName: rawName, displayName: rawDisplayName, employeeId: rawId }) => {
    const nextEmail = (rawEmail || '').trim().toLowerCase();
    const nextName = (rawName || '').trim();
    const nextDisplay = (rawDisplayName || '').trim() || nextName;
    setEmail(nextEmail);
    setEmployeeName(nextName);
    setDisplayName(nextDisplay);
    setEmployeeId(rawId || null);
  };

  const updateDisplayName = (name) => {
    const next = (name || '').trim();
    if (next) setDisplayName(next);
  };

  const logout = async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn('[Auth] signOut error:', e?.message);
    }
    setEmployeeName('');
    setEmployeeId(null);
    setEmail('');
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (cancelled || !session?.user?.email) {
          setAuthLoading(false);
          return;
        }
        const userEmail = session.user.email;
        let employeeName = userEmail.split('@')[0];
        let displayName = employeeName;
        let employeeId = null;
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
        
        // Attempt to find the UUID in profiles
        if (employeeName) {
          const candidateNames = Array.from(
            new Set([employeeName, displayName, DEFAULT_EMPLOYEE_NAME].map(n => (n || '').trim()).filter(Boolean))
          );
          
          if (candidateNames.length > 0) {
            // query profiles to match employee id
            const { data: posData } = await supabase
              .from('profiles')
              .select('id, employee_name, display_name')
              .eq('org_id', ORG_ID);

            const normalizedCandidates = candidateNames.map(n => n.toLowerCase());
            const matchedPos = (posData || []).find(p => {
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
        if (!cancelled) setIdentity({ email: userEmail, employeeName, displayName, employeeId });
      } catch (e) {
        console.warn('[Auth] Session restore failed:', e?.message);
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <EmployeeContext.Provider
      value={{
        employeeId,
        employeeName,
        displayName,
        email,
        authLoading,
        setIdentity,
        updateDisplayName,
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

