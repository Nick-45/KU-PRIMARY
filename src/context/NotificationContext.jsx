// src/context/NotificationContext.jsx
import React, {
    createContext,
    useContext,
    useState,
    useEffect,
    useRef,
    useCallback
} from 'react';

import { useAuth } from './AuthContext';
import { db } from '../firebase';

import {
    collection,
    query,
    where,
    onSnapshot,
    orderBy,
    limit,
    doc,
    getDoc
} from 'firebase/firestore';

const NotificationContext = createContext();

export function useNotifications() {
    const context = useContext(NotificationContext);

    if (!context) {
        throw new Error(
            'useNotifications must be used within a NotificationProvider'
        );
    }

    return context;
}

export function NotificationProvider({ children }) {
    const { userData, currentUser } = useAuth();

    const [notifications, setNotifications] = useState([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [loading, setLoading] = useState(true);

    /*
     * IMPORTANT:
     *
     * We use Maps instead of Sets because we need to remember
     * the previous document data in order to detect changes.
     */
    const previousDataRef = useRef({
        students: new Map(),
        teachers: new Map(),
        exams: new Map()
    });

    /*
     * Prevents the initial Firestore snapshot from generating
     * notifications for all existing records.
     *
     * Firestore sends existing documents as "added" when the
     * listener first starts.
     */
    const initializedRef = useRef({
        students: false,
        teachers: false,
        exams: false
    });

    const cleanupInterval = useRef(null);

    /*
     * ---------------------------------------------------------
     * HELPER: Convert Firestore timestamps / JS dates
     * ---------------------------------------------------------
     */
    const toDate = useCallback((value) => {
        if (!value) {
            return new Date();
        }

        if (value instanceof Date) {
            return value;
        }

        if (typeof value?.toDate === 'function') {
            return value.toDate();
        }

        if (typeof value === 'number') {
            return new Date(value);
        }

        if (typeof value === 'string') {
            const parsed = new Date(value);

            if (!Number.isNaN(parsed.getTime())) {
                return parsed;
            }
        }

        return new Date();
    }, []);

    /*
     * ---------------------------------------------------------
     * FORMAT TIME AGO
     * ---------------------------------------------------------
     */
    const formatTimeAgo = useCallback((timestamp) => {
        const date = toDate(timestamp);
        const now = new Date();

        const diff = now - date;

        if (diff < 60000) {
            return 'Just now';
        }

        if (diff < 3600000) {
            return `${Math.floor(diff / 60000)} minutes ago`;
        }

        if (diff < 86400000) {
            return `${Math.floor(diff / 3600000)} hours ago`;
        }

        if (diff < 604800000) {
            return `${Math.floor(diff / 86400000)} days ago`;
        }

        if (diff < 2592000000) {
            return `${Math.floor(diff / 604800000)} weeks ago`;
        }

        return date.toLocaleDateString();
    }, [toDate]);

    /*
     * ---------------------------------------------------------
     * GET USER INFO
     * ---------------------------------------------------------
     */
    const getUserInfo = useCallback(async (uid) => {
        if (!uid) {
            return {
                displayName: 'System'
            };
        }

        try {
            // users collection
            const userDoc = await getDoc(
                doc(db, 'users', uid)
            );

            if (userDoc.exists()) {
                return userDoc.data();
            }

            // teachers collection
            const teacherDoc = await getDoc(
                doc(db, 'teachers', uid)
            );

            if (teacherDoc.exists()) {
                return teacherDoc.data();
            }

            // students collection
            const studentDoc = await getDoc(
                doc(db, 'students', uid)
            );

            if (studentDoc.exists()) {
                return studentDoc.data();
            }

            return {
                displayName: 'Someone'
            };
        } catch (error) {
            console.error('Error getting user info:', error);

            return {
                displayName: 'Someone'
            };
        }
    }, []);

    /*
     * ---------------------------------------------------------
     * GENERATE NOTIFICATION
     * ---------------------------------------------------------
     */
    const generateNotification = useCallback((type, data, user) => {
        const userName =
            user?.displayName ||
            user?.firstName ||
            user?.fullName ||
            'Someone';

        const now = new Date();

        /*
         * IMPORTANT:
         *
         * Do NOT use Date.now() as the notification identity.
         *
         * The same Firestore document can trigger the listener
         * again after reconnecting. A stable ID prevents duplicates.
         */
        switch (type) {
            case 'student_added':
                return {
                    id: `student_added_${data.id}`,
                    type: 'student_added',
                    title: 'New Student Added',
                    message: `${userName} added a new student: ${data.firstName || ''} ${data.lastName || ''}`.trim(),
                    icon: 'fa-user-graduate',
                    color: '#4a5fc1',
                    timestamp: now,
                    read: false,
                    link: '/students',
                    data
                };

            case 'student_updated':
                return {
                    id: `student_updated_${data.id}_${data.updatedAt || now.getTime()}`,
                    type: 'student_updated',
                    title: 'Student Updated',
                    message: `${userName} updated student: ${data.firstName || ''} ${data.lastName || ''}`.trim(),
                    icon: 'fa-user-edit',
                    color: '#3498db',
                    timestamp: now,
                    read: false,
                    link: '/students',
                    data
                };

            case 'student_promoted':
                return {
                    id: `student_promoted_${data.id}_${data.toLevel}`,
                    type: 'student_promoted',
                    title: 'Student Promoted',
                    message: `${userName} promoted ${data.firstName || ''} ${data.lastName || ''} to ${data.toLevel}`,
                    icon: 'fa-arrow-up',
                    color: '#27ae60',
                    timestamp: now,
                    read: false,
                    link: '/students',
                    data
                };

            case 'teacher_added':
                return {
                    id: `teacher_added_${data.id}`,
                    type: 'teacher_added',
                    title: 'New Teacher Added',
                    message: `${userName} added a new teacher: ${data.firstName || ''} ${data.lastName || ''}`.trim(),
                    icon: 'fa-chalkboard-teacher',
                    color: '#f5576c',
                    timestamp: now,
                    read: false,
                    link: '/teachers',
                    data
                };

            case 'teacher_invited':
                return {
                    id: `teacher_invited_${data.id}`,
                    type: 'teacher_invited',
                    title: 'Teacher Invited',
                    message: `Invitation sent to ${data.firstName || ''} ${data.lastName || ''} (${data.email || ''})`,
                    icon: 'fa-envelope',
                    color: '#f39c12',
                    timestamp: now,
                    read: false,
                    link: '/teachers',
                    data
                };

            case 'exam_created':
                return {
                    id: `exam_created_${data.id}`,
                    type: 'exam_created',
                    title: 'New Exam Created',
                    message: `${userName} created a new exam: ${data.title || 'Untitled Exam'}`,
                    icon: 'fa-file-alt',
                    color: '#4facfe',
                    timestamp: now,
                    read: false,
                    link: '/exams',
                    data
                };

            case 'exam_published':
                return {
                    id: `exam_published_${data.id}`,
                    type: 'exam_published',
                    title: 'Exam Published',
                    message: `${userName} published exam results: ${data.title || 'Untitled Exam'}`,
                    icon: 'fa-upload',
                    color: '#27ae60',
                    timestamp: now,
                    read: false,
                    link: '/results',
                    data
                };

            case 'results_entry':
                return {
                    id: `results_entry_${data.id}`,
                    type: 'results_entry',
                    title: 'Results Entry',
                    message: `${userName} entered results for ${data.studentName || 'a student'} in ${data.examTitle || 'an exam'}`,
                    icon: 'fa-chart-line',
                    color: '#8e44ad',
                    timestamp: now,
                    read: false,
                    link: '/results',
                    data
                };

            case 'results_published':
                return {
                    id: `results_published_${data.id}`,
                    type: 'results_published',
                    title: 'Results Published',
                    message: `${userName} published results for ${data.examTitle || 'an exam'}`,
                    icon: 'fa-chart-bar',
                    color: '#2ecc71',
                    timestamp: now,
                    read: false,
                    link: '/results',
                    data
                };

            case 'subscription_updated':
                return {
                    id: `subscription_updated_${data.id || data.status}`,
                    type: 'subscription_updated',
                    title: 'Subscription Updated',
                    message: `School subscription was updated to ${data.status}`,
                    icon: 'fa-credit-card',
                    color: '#9b59b6',
                    timestamp: now,
                    read: false,
                    link: '/subscription',
                    data
                };

            default:
                return null;
        }
    }, []);

    /*
     * ---------------------------------------------------------
     * ADD NOTIFICATION SAFELY
     * ---------------------------------------------------------
     *
     * This is very important.
     *
     * Before adding a notification, we check whether the same
     * notification ID already exists.
     *
     * Therefore:
     *
     *   READ notification -> stays READ
     *   Firestore reconnect -> does NOT create another one
     *   Component re-render -> does NOT create another one
     */
    const addNotification = useCallback((notification) => {
        if (!notification) {
            return;
        }

        setNotifications(prev => {
            const existing = prev.find(
                item => item.id === notification.id
            );

            // Already exists.
            // NEVER replace it with a new unread notification.
            if (existing) {
                return prev;
            }

            return [notification, ...prev];
        });
    }, []);

    /*
     * ---------------------------------------------------------
     * STUDENTS LISTENER
     * ---------------------------------------------------------
     */
    useEffect(() => {
        if (!userData?.schoolId) {
            return;
        }

        const schoolId = userData.schoolId;

        // Reset listener state for a new school/user.
        previousDataRef.current.students = new Map();
        initializedRef.current.students = false;

        const studentsQuery = query(
            collection(db, 'students'),
            where('schoolId', '==', schoolId),
            orderBy('createdAt', 'desc'),
            limit(50)
        );

        const unsubscribeStudents = onSnapshot(
            studentsQuery,
            async (snapshot) => {
                /*
                 * FIRST SNAPSHOT
                 *
                 * Existing records must NOT become notifications.
                 *
                 * We only store their current state.
                 */
                if (!initializedRef.current.students) {
                    snapshot.docs.forEach(docSnapshot => {
                        previousDataRef.current.students.set(
                            docSnapshot.id,
                            docSnapshot.data()
                        );
                    });

                    initializedRef.current.students = true;
                    setLoading(false);

                    return;
                }

                /*
                 * AFTER INITIALIZATION
                 *
                 * Only genuine new changes create notifications.
                 */
                for (const change of snapshot.docChanges()) {
                    const data = change.doc.data();
                    const docId = change.doc.id;

                    const newData = {
                        id: docId,
                        ...data
                    };

                    if (change.type === 'added') {
                        /*
                         * New student created AFTER listener started.
                         */
                        const user = await getUserInfo(
                            data.createdBy || data.uid
                        );

                        const notification = generateNotification(
                            'student_added',
                            newData,
                            user
                        );

                        addNotification(notification);

                        previousDataRef.current.students.set(
                            docId,
                            data
                        );
                    }

                    if (change.type === 'modified') {
                        const oldData =
                            previousDataRef.current.students.get(docId);

                        /*
                         * Detect promotion.
                         */
                        if (
                            oldData &&
                            oldData.level !== data.level
                        ) {
                            const user = await getUserInfo(
                                data.updatedBy ||
                                data.createdBy ||
                                data.uid
                            );

                            const notification = generateNotification(
                                'student_promoted',
                                {
                                    ...newData,
                                    fromLevel: oldData.level,
                                    toLevel: data.level
                                },
                                user
                            );

                            addNotification(notification);
                        }

                        previousDataRef.current.students.set(
                            docId,
                            data
                        );
                    }

                    if (change.type === 'removed') {
                        previousDataRef.current.students.delete(docId);
                    }
                }

                setLoading(false);
            },
            (error) => {
                console.error(
                    'Error loading students notifications:',
                    error
                );

                setLoading(false);
            }
        );

        return () => unsubscribeStudents();
    }, [
        userData?.schoolId,
        getUserInfo,
        generateNotification,
        addNotification
    ]);

    /*
     * ---------------------------------------------------------
     * TEACHERS LISTENER
     * ---------------------------------------------------------
     */
    useEffect(() => {
        if (!userData?.schoolId) {
            return;
        }

        const schoolId = userData.schoolId;

        previousDataRef.current.teachers = new Map();
        initializedRef.current.teachers = false;

        const teachersQuery = query(
            collection(db, 'teachers'),
            where('schoolId', '==', schoolId),
            orderBy('createdAt', 'desc'),
            limit(50)
        );

        const unsubscribeTeachers = onSnapshot(
            teachersQuery,
            async (snapshot) => {
                /*
                 * Ignore existing teachers during initial load.
                 */
                if (!initializedRef.current.teachers) {
                    snapshot.docs.forEach(docSnapshot => {
                        previousDataRef.current.teachers.set(
                            docSnapshot.id,
                            docSnapshot.data()
                        );
                    });

                    initializedRef.current.teachers = true;

                    return;
                }

                for (const change of snapshot.docChanges()) {
                    const data = change.doc.data();
                    const docId = change.doc.id;

                    const newData = {
                        id: docId,
                        ...data
                    };

                    if (change.type === 'added') {
                        const user = await getUserInfo(
                            data.createdBy || data.uid
                        );

                        const type =
                            data.status === 'invited'
                                ? 'teacher_invited'
                                : 'teacher_added';

                        const notification =
                            generateNotification(
                                type,
                                newData,
                                user
                            );

                        addNotification(notification);

                        previousDataRef.current.teachers.set(
                            docId,
                            data
                        );
                    }

                    if (change.type === 'modified') {
                        previousDataRef.current.teachers.set(
                            docId,
                            data
                        );
                    }

                    if (change.type === 'removed') {
                        previousDataRef.current.teachers.delete(
                            docId
                        );
                    }
                }
            },
            (error) => {
                console.error(
                    'Error loading teachers notifications:',
                    error
                );
            }
        );

        return () => unsubscribeTeachers();
    }, [
        userData?.schoolId,
        getUserInfo,
        generateNotification,
        addNotification
    ]);

    /*
     * ---------------------------------------------------------
     * EXAMS LISTENER
     * ---------------------------------------------------------
     */
    useEffect(() => {
        if (!userData?.schoolId) {
            return;
        }

        const schoolId = userData.schoolId;

        previousDataRef.current.exams = new Map();
        initializedRef.current.exams = false;

        const examsQuery = query(
            collection(db, 'exams'),
            where('schoolId', '==', schoolId),
            orderBy('createdAt', 'desc'),
            limit(50)
        );

        const unsubscribeExams = onSnapshot(
            examsQuery,
            async (snapshot) => {
                /*
                 * Ignore existing exams during initial load.
                 */
                if (!initializedRef.current.exams) {
                    snapshot.docs.forEach(docSnapshot => {
                        previousDataRef.current.exams.set(
                            docSnapshot.id,
                            docSnapshot.data()
                        );
                    });

                    initializedRef.current.exams = true;

                    return;
                }

                for (const change of snapshot.docChanges()) {
                    const data = change.doc.data();
                    const docId = change.doc.id;

                    const newData = {
                        id: docId,
                        ...data
                    };

                    if (change.type === 'added') {
                        const user = await getUserInfo(
                            data.createdBy || data.uid
                        );

                        const notification =
                            generateNotification(
                                'exam_created',
                                newData,
                                user
                            );

                        addNotification(notification);

                        previousDataRef.current.exams.set(
                            docId,
                            data
                        );
                    }

                    if (change.type === 'modified') {
                        const oldData =
                            previousDataRef.current.exams.get(docId);

                        /*
                         * Detect result publication.
                         */
                        if (
                            oldData &&
                            !oldData.resultsPublished &&
                            data.resultsPublished
                        ) {
                            const user = await getUserInfo(
                                data.updatedBy ||
                                data.createdBy ||
                                data.uid
                            );

                            const notification =
                                generateNotification(
                                    'exam_published',
                                    newData,
                                    user
                                );

                            addNotification(notification);
                        }

                        previousDataRef.current.exams.set(
                            docId,
                            data
                        );
                    }

                    if (change.type === 'removed') {
                        previousDataRef.current.exams.delete(
                            docId
                        );
                    }
                }
            },
            (error) => {
                console.error(
                    'Error loading exams notifications:',
                    error
                );
            }
        );

        return () => unsubscribeExams();
    }, [
        userData?.schoolId,
        getUserInfo,
        generateNotification,
        addNotification
    ]);

    /*
     * ---------------------------------------------------------
     * RECALCULATE UNREAD COUNT
     * ---------------------------------------------------------
     *
     * Instead of manually doing:
     *
     *     setUnreadCount(prev => prev + 1)
     *
     * everywhere, we calculate the count directly from the
     * notifications array.
     *
     * This prevents the count from becoming incorrect.
     */
    useEffect(() => {
        const count = notifications.filter(
            notification => !notification.read
        ).length;

        setUnreadCount(count);
    }, [notifications]);

    /*
     * ---------------------------------------------------------
     * CLEANUP READ NOTIFICATIONS AFTER 48 HOURS
     * ---------------------------------------------------------
     */
    const cleanupReadNotifications = useCallback(() => {
        const fortyEightHoursAgo = new Date();

        fortyEightHoursAgo.setHours(
            fortyEightHoursAgo.getHours() - 48
        );

        setNotifications(prev => {
            const filtered = prev.filter(notification => {
                /*
                 * ALWAYS keep unread notifications.
                 */
                if (!notification.read) {
                    return true;
                }

                /*
                 * Keep read notifications younger than 48 hours.
                 */
                const timestamp = toDate(
                    notification.timestamp
                );

                return timestamp > fortyEightHoursAgo;
            });

            if (filtered.length < prev.length) {
                console.log(
                    `Cleaned up ${
                        prev.length - filtered.length
                    } old read notifications`
                );
            }

            return filtered;
        });
    }, [toDate]);

    /*
     * Run cleanup every hour.
     */
    useEffect(() => {
        cleanupInterval.current = setInterval(() => {
            cleanupReadNotifications();
        }, 60 * 60 * 1000);

        /*
         * Initial cleanup.
         */
        const initialCleanup = setTimeout(() => {
            cleanupReadNotifications();
        }, 5000);

        return () => {
            clearInterval(cleanupInterval.current);
            clearTimeout(initialCleanup);
        };
    }, [cleanupReadNotifications]);

    /*
     * ---------------------------------------------------------
     * MARK ONE AS READ
     * ---------------------------------------------------------
     *
     * We first check whether it is actually unread.
     *
     * This prevents:
     *
     *     unreadCount: 0
     *
     * from becoming:
     *
     *     unreadCount: -1
     */
    const markAsRead = useCallback((id) => {
        setNotifications(prev =>
            prev.map(notification => {
                if (notification.id !== id) {
                    return notification;
                }

                /*
                 * Already read.
                 * Keep it read.
                 */
                if (notification.read) {
                    return notification;
                }

                return {
                    ...notification,
                    read: true
                };
            })
        );
    }, []);

    /*
     * ---------------------------------------------------------
     * MARK ALL AS READ
     * ---------------------------------------------------------
     */
    const markAllAsRead = useCallback(() => {
        setNotifications(prev =>
            prev.map(notification => ({
                ...notification,
                read: true
            }))
        );
    }, []);

    /*
     * ---------------------------------------------------------
     * CLEAR ALL
     * ---------------------------------------------------------
     */
    const clearAllNotifications = useCallback(() => {
        setNotifications([]);
    }, []);

    /*
     * ---------------------------------------------------------
     * CLEAR NOTIFICATIONS OLDER THAN 7 DAYS
     * ---------------------------------------------------------
     */
    const clearOldNotifications = useCallback(() => {
        const sevenDaysAgo = new Date();

        sevenDaysAgo.setDate(
            sevenDaysAgo.getDate() - 7
        );

        setNotifications(prev =>
            prev.filter(notification => {
                const timestamp = toDate(
                    notification.timestamp
                );

                return timestamp > sevenDaysAgo;
            })
        );
    }, [toDate]);

    /*
     * ---------------------------------------------------------
     * CONTEXT VALUE
     * ---------------------------------------------------------
     */
    const value = {
        notifications,
        unreadCount,
        loading,
        markAsRead,
        markAllAsRead,
        clearOldNotifications,
        clearAllNotifications,
        formatTimeAgo
    };

    return (
        <NotificationContext.Provider value={value}>
            {children}
        </NotificationContext.Provider>
    );
}
