// src/context/SchoolContext.jsx
import React, { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { getAssessmentConfigs } from '../services/firestore';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { LEVEL_CLASSES } from '../utils/constants';

const SchoolContext = createContext(null);

export function SchoolProvider({ children }) {
    const { userData } = useAuth();
    const [configs, setConfigs] = useState([]);
    const [schoolData, setSchoolData] = useState(null);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        let mounted = true;
        async function load() {
            if (!userData?.schoolId) {
                if (mounted) setLoaded(true);
                return;
            }
            try {
                const [assessmentList, schoolDocSnap] = await Promise.all([
                    getAssessmentConfigs(userData.schoolId),
                    getDoc(doc(db, 'schools', userData.schoolId))
                ]);
                if (mounted) {
                    setConfigs(assessmentList);
                    if (schoolDocSnap.exists()) {
                        setSchoolData({ id: schoolDocSnap.id, ...schoolDocSnap.data() });
                    }
                    setLoaded(true);
                }
            } catch (e) {
                console.error('SchoolContext load failed:', e);
                if (mounted) setLoaded(true);
            }
        }
        load();
        return () => { mounted = false; };
    }, [userData?.schoolId]);

    function findConfig(level, cls, subject, assessmentType) {
        return configs.find(c =>
            c.level === level &&
            c.class === cls &&
            c.subject === subject &&
            c.assessmentType === assessmentType
        );
    }

    function isDeadlinePassed(level, cls, subject, assessmentType) {
        const cfg = findConfig(level, cls, subject, assessmentType);
        if (!cfg?.deadline) return false;
        const dl = cfg.deadline.toDate ? cfg.deadline.toDate() : new Date(cfg.deadline);
        return new Date() > dl;
    }

    function getLevelClasses(level) {
        if (schoolData?.useCustomClasses && Array.isArray(schoolData?.customClasses) && schoolData.customClasses.length > 0) {
            const filtered = schoolData.customClasses
                .filter(c => c.level === level)
                .map(c => c.className);
            if (filtered.length > 0) {
                return filtered;
            }
        }
        return LEVEL_CLASSES[level] || [];
    }

    function refresh() {
        setLoaded(false);
        if (userData?.schoolId) {
            Promise.all([
                getAssessmentConfigs(userData.schoolId),
                getDoc(doc(db, 'schools', userData.schoolId))
            ]).then(([assessmentList, schoolDocSnap]) => {
                setConfigs(assessmentList);
                if (schoolDocSnap.exists()) {
                    setSchoolData({ id: schoolDocSnap.id, ...schoolDocSnap.data() });
                }
            }).finally(() => setLoaded(true));
        }
    }

    return (
        <SchoolContext.Provider value={{ configs, schoolData, loaded, findConfig, isDeadlinePassed, getLevelClasses, refresh }}>
            {children}
        </SchoolContext.Provider>
    );
}

export function useSchool() {
    const ctx = useContext(SchoolContext);
    if (!ctx) throw new Error('useSchool must be used within SchoolProvider');
    return ctx;
}

