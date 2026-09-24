// src/context/AuthContext.jsx
import React, {
    createContext, useState, useEffect, useContext, useCallback, useRef
} from 'react';
import { auth, db } from '../firebase';
import { onAuthStateChanged, signOut, getIdTokenResult } from 'firebase/auth';
import {
    doc, getDoc, setDoc, updateDoc, serverTimestamp
} from 'firebase/firestore';
import { useSync } from './SyncContext';

const AuthContext = createContext();

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
    return ctx;
}

// ---------------------------------------------------------------------------
// School branding: read once per session, merged into userData so every PDF
// and every page can access it without additional Firestore reads.
// ---------------------------------------------------------------------------
async function fetchSchoolBranding(schoolId) {
    if (!schoolId) return null;
    try {
        const snap = await getDoc(doc(db, 'schools', schoolId));
        if (!snap.exists()) return null;
        const s = snap.data();
        return {
            schoolName: s.name || s.schoolName || '',
            schoolMotto: s.motto || '',
            schoolLogo: s.logoUrl || '',
            schoolAddress: s.address || '',
            schoolPhone: s.phone || '',
            schoolEmail: s.email || '',
            schoolFeatures: s.features || null,
            schoolPaybill: s.paybillNumber || ''
        };
    } catch (e) {
        console.warn('fetchSchoolBranding failed:', e);
        return null;
    }
}

export function AuthProvider({ children }) {
    const [currentUser, setCurrentUser] = useState(null);
    const [userData, setUserData] = useState(null);
    const [userRole, setUserRole] = useState(null);
    const [userCollection, setUserCollection] = useState(null);
    const [claims, setClaims] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const { isOnline, saveToIndexedDB, getFromIndexedDB, addToSyncQueue } = useSync();

    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    // ---- IndexedDB cache ----
    const cacheUserData = useCallback(async (uid, data) => {
        try {
            await saveToIndexedDB(`cached_user_${uid}`, {
                ...data,
                cachedAt: new Date().toISOString()
            });
        } catch (e) {
            console.warn('cacheUserData failed:', e);
        }
    }, [saveToIndexedDB]);

    const getCachedUserData = useCallback(async (uid) => {
        try {
            return await getFromIndexedDB(`cached_user_${uid}`);
        } catch (e) {
            console.warn('getCachedUserData failed:', e);
            return null;
        }
    }, [getFromIndexedDB]);

    // -----------------------------------------------------------------------
    // Resolve user document
    //  1. Custom claims first (cheap, no Firestore reads)
    //  2. Firestore fallback (users → teachers → students)
    //  3. Offline cache
    //  4. Minimal shell
    // In every branch, if we have a schoolId, we enrich with school branding.
    // -----------------------------------------------------------------------
    const resolveUser = useCallback(async (user, email) => {
        const uid = user.uid;

        // 1. Custom claims
        let tokenClaims = {};
        try {
            const tokenResult = await getIdTokenResult(user, true);
            tokenClaims = tokenResult.claims || {};
        } catch (e) {
            console.warn('getIdTokenResult failed:', e);
        }

        // If claims are complete, no user-doc read needed — but we still need branding
        if (tokenClaims.role && tokenClaims.schoolId) {
            const branding = await fetchSchoolBranding(tokenClaims.schoolId);
            return {
                data: {
                    uid,
                    email: email || user.email || '',
                    role: tokenClaims.role,
                    schoolId: tokenClaims.schoolId,
                    level: tokenClaims.level || '',
                    classes: tokenClaims.classes || [],
                    subjects: tokenClaims.subjects || [],
                    fullName: user.displayName || email || '',
                    ...(branding || {})
                },
                role: tokenClaims.role,
                collection: 'claims',
                schoolId: tokenClaims.schoolId,
                claims: tokenClaims,
                source: 'claims'
            };
        }

        // 2. Firestore fallback
        const collections = ['users', 'teachers', 'students'];
        for (const name of collections) {
            try {
                const snap = await getDoc(doc(db, name, uid));
                if (snap.exists()) {
                    const data = snap.data();
                    const role = data.role
                        || (name === 'teachers' ? 'teacher'
                            : name === 'students' ? 'student'
                            : 'user');
                    const schoolId = data.schoolId || data.school_id || null;

                    // Enrich with branding (1 extra read, only when claims are missing)
                    const branding = await fetchSchoolBranding(schoolId);

                    return {
                        data: { ...data, uid, email: email || data.email || '', ...(branding || {}) },
                        role,
                        collection: name,
                        schoolId,
                        claims: tokenClaims,
                        source: 'firestore'
                    };
                }
            } catch (e) {
                console.warn(`Firestore ${name} lookup failed:`, e);
            }
        }

        // 3. Offline cache
        const cached = await getCachedUserData(uid);
        if (cached) {
            // Cached data already includes branding if it was saved post-login
            return {
                data: cached,
                role: cached.role || 'user',
                collection: cached.collection || 'users',
                schoolId: cached.schoolId || null,
                claims: tokenClaims,
                source: 'cache'
            };
        }

        // 4. Minimal shell
        return {
            data: {
                uid,
                email: email || user.email || '',
                role: 'user',
                schoolId: null
            },
            role: 'user',
            collection: 'users',
            schoolId: null,
            claims: tokenClaims,
            source: 'fallback'
        };
    }, [getCachedUserData]);

    // ---- Auth state listener ----
    useEffect(() => {
        const unsub = onAuthStateChanged(auth, async (user) => {
            if (!user) {
                if (!mountedRef.current) return;
                setCurrentUser(null);
                setUserData(null);
                setUserRole(null);
                setUserCollection(null);
                setClaims({});
                setLoading(false);
                return;
            }

            try {
                const resolved = await resolveUser(user, user.email);

                // Backfill users doc only when we had to fall back to Firestore
                if (
                    isOnline
                    && resolved.source === 'firestore'
                    && (!resolved.claims.role || !resolved.claims.schoolId)
                ) {
                    try {
                        await setDoc(doc(db, 'users', user.uid), {
                            uid: user.uid,
                            email: user.email || '',
                            role: resolved.role,
                            schoolId: resolved.schoolId,
                            lastLogin: serverTimestamp(),
                            updatedAt: serverTimestamp()
                        }, { merge: true });
                    } catch (e) {
                        console.warn('User doc backfill failed (non-fatal):', e);
                    }
                }

                if (!mountedRef.current) return;
                setCurrentUser(user);
                setUserData(resolved.data);
                setUserRole(resolved.role);
                setUserCollection(resolved.collection);
                setClaims(resolved.claims || {});

                // Cache enriched data (with branding) for offline use
                cacheUserData(user.uid, {
                    ...resolved.data,
                    role: resolved.role,
                    collection: resolved.collection,
                    schoolId: resolved.schoolId
                });
            } catch (e) {
                console.error('Auth bootstrap failed:', e);
                if (mountedRef.current) setError(e.message);
            } finally {
                if (mountedRef.current) setLoading(false);
            }
        });

        return () => unsub();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ---- Update user data ----
    const updateUserData = useCallback(async (updates) => {
        if (!currentUser) throw new Error('No user logged in');

        const uid = currentUser.uid;
        const collectionName = userCollection && userCollection !== 'claims'
            ? userCollection
            : 'users';
        const updated = { ...userData, ...updates };

        // If branding fields are in `updates`, they belong to the school doc,
        // not the user doc. Split them out.
        const {
            schoolName, schoolMotto, schoolLogo, schoolAddress,
            schoolPhone, schoolEmail, schoolFeatures, schoolPaybill,
            ...userOnlyUpdates
        } = updates;

        const hasBrandingUpdates = Object.keys({
            schoolName, schoolMotto, schoolLogo, schoolAddress,
            schoolPhone, schoolEmail, schoolFeatures, schoolPaybill
        }).some((k) => updates[k] !== undefined);

        if (isOnline) {
            try {
                if (Object.keys(userOnlyUpdates).length > 0) {
                    await updateDoc(doc(db, collectionName, uid), {
                        ...userOnlyUpdates,
                        updatedAt: serverTimestamp()
                    });
                }

                if (hasBrandingUpdates && userData?.schoolId) {
                    const schoolUpdates = {};
                    if (schoolName !== undefined) schoolUpdates.name = schoolName;
                    if (schoolMotto !== undefined) schoolUpdates.motto = schoolMotto;
                    if (schoolLogo !== undefined) schoolUpdates.logoUrl = schoolLogo;
                    if (schoolAddress !== undefined) schoolUpdates.address = schoolAddress;
                    if (schoolPhone !== undefined) schoolUpdates.phone = schoolPhone;
                    if (schoolEmail !== undefined) schoolUpdates.email = schoolEmail;
                    if (schoolFeatures !== undefined) schoolUpdates.features = schoolFeatures;
                    if (schoolPaybill !== undefined) schoolUpdates.paybillNumber = schoolPaybill;
                    schoolUpdates.updatedAt = serverTimestamp();

                    if (Object.keys(schoolUpdates).length > 0) {
                        await updateDoc(
                            doc(db, 'schools', userData.schoolId),
                            schoolUpdates
                        );
                    }
                }
            } catch (e) {
                console.warn('updateDoc failed, queueing:', e);
                await addToSyncQueue(collectionName, 'update', { id: uid, ...userOnlyUpdates });
            }
        } else {
            if (Object.keys(userOnlyUpdates).length > 0) {
                await addToSyncQueue(collectionName, 'update', { id: uid, ...userOnlyUpdates });
            }
        }

        setUserData(updated);
        await cacheUserData(uid, {
            ...updated,
            role: userRole,
            collection: collectionName
        });
        return updated;
    }, [
        currentUser, userCollection, userData, userRole,
        isOnline, addToSyncQueue, cacheUserData
    ]);

    // ---- Logout ----
    const logout = useCallback(async () => {
        try {
            if (isOnline && currentUser) {
                const uid = currentUser.uid;
                const collectionName = userCollection && userCollection !== 'claims'
                    ? userCollection
                    : 'users';
                updateDoc(doc(db, collectionName, uid), { lastLogout: serverTimestamp() })
                    .catch((e) => console.warn('lastLogout update failed:', e));
            }
            await signOut(auth);
            setCurrentUser(null);
            setUserData(null);
            setUserRole(null);
            setUserCollection(null);
            setClaims({});
        } catch (e) {
            console.error('Logout error:', e);
            throw e;
        }
    }, [currentUser, userCollection, isOnline]);

    const value = {
        currentUser,
        userData,
        userRole,
        userCollection,
        claims,
        loading,
        error,
        isOnline,
        logout,
        updateUserData
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}

export default AuthContext;
