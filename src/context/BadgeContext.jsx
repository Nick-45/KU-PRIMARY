// src/context/BadgeContext.jsx
import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { db } from '../firebase';
import { collection, query, where, getDocs, onSnapshot } from 'firebase/firestore';

const BadgeContext = createContext();

export function useBadges() {
    return useContext(BadgeContext);
}

export function BadgeProvider({ children }) {
    const { userData } = useAuth();
    const [badges, setBadges] = useState({
        students: 0,
        teachers: 0,
        exams: 0,
        results: '0%'
    });

    useEffect(() => {
        if (!userData?.schoolId) return;

        // Listen to students count
        const studentsQuery = query(
            collection(db, 'students'),
            where('schoolId', '==', userData.schoolId)
        );
        const unsubscribeStudents = onSnapshot(studentsQuery, (snapshot) => {
            setBadges(prev => ({ ...prev, students: snapshot.size }));
        });

        // Listen to teachers count
        const teachersQuery = query(
            collection(db, 'teachers'),
            where('schoolId', '==', userData.schoolId)
        );
        const unsubscribeTeachers = onSnapshot(teachersQuery, (snapshot) => {
            setBadges(prev => ({ ...prev, teachers: snapshot.size }));
        });

        // Listen to active exams count
        const examsQuery = query(
            collection(db, 'exams'),
            where('schoolId', '==', userData.schoolId),
            where('status', '==', 'active')
        );
        const unsubscribeExams = onSnapshot(examsQuery, (snapshot) => {
            setBadges(prev => ({ ...prev, exams: snapshot.size }));
        });

        // Listen to results published
        const resultsQuery = query(
            collection(db, 'exams'),
            where('schoolId', '==', userData.schoolId),
            where('resultsPublished', '==', true)
        );
        const unsubscribeResults = onSnapshot(resultsQuery, (snapshot) => {
            const total = snapshot.size;
            setBadges(prev => ({ ...prev, results: total > 0 ? `${total} published` : '0%' }));
        });

        return () => {
            unsubscribeStudents();
            unsubscribeTeachers();
            unsubscribeExams();
            unsubscribeResults();
        };
    }, [userData?.schoolId]);

    const updateBadges = (newBadges) => {
        setBadges(prev => ({ ...prev, ...newBadges }));
    };

    return (
        <BadgeContext.Provider value={{ badges, updateBadges }}>
            {children}
        </BadgeContext.Provider>
    );
}
