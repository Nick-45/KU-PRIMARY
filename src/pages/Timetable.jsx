// src/pages/Timetable.jsx
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSchool } from '../context/SchoolContext';
import { db } from '../firebase';
import {
    collection, query, where, getDocs, doc, setDoc, getDoc, serverTimestamp
} from 'firebase/firestore';
import Layout from '../components/Layout/Layout';
import LoadingSpinner from '../components/Common/LoadingSpinner';
import { downloadTimetablePDF } from '../services/pdf';
import { SCHOOL_LEVELS, LEVEL_SUBJECTS } from '../utils/constants';

// ---------- constants ----------
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

const PERIODS = [
    { id: 'p1', name: 'Period 1', time: '08:00 - 08:40', type: 'class' },
    { id: 'p2', name: 'Period 2', time: '08:40 - 09:20', type: 'class' },
    { id: 'break1', name: 'Morning Break', time: '09:20 - 09:50', type: 'break', label: 'TEA / RECREATION BREAK' },
    { id: 'p3', name: 'Period 3', time: '09:50 - 10:30', type: 'class' },
    { id: 'p4', name: 'Period 4', time: '10:30 - 11:10', type: 'class' },
    { id: 'p5', name: 'Period 5', time: '11:10 - 11:50', type: 'class' },
    { id: 'lunch', name: 'Lunch Break', time: '11:50 - 13:00', type: 'break', label: 'NOON LUNCH BREAK' },
    { id: 'p6', name: 'Period 6', time: '13:00 - 13:40', type: 'class' },
    { id: 'p7', name: 'Period 7', time: '13:40 - 14:20', type: 'class' },
    { id: 'p8', name: 'Period 8', time: '14:20 - 15:00', type: 'class' }
];

const CLASS_PERIODS = PERIODS.filter(p => p.type === 'class');

const DUTY_AREAS = [
    { id: 'gate_morning', label: 'Main Gate (Morning)', time: '07:00 - 08:00' },
    { id: 'assembly',     label: 'Assembly Ground',     time: '08:00 - 08:20' },
    { id: 'break_duty',   label: 'Break Supervision',   time: '09:20 - 09:50' },
    { id: 'dining',       label: 'Dining Hall',         time: '12:00 - 13:00' },
    { id: 'gate_evening', label: 'Main Gate (Evening)', time: '15:00 - 16:30' },
    { id: 'library',      label: 'Library',             time: '15:00 - 16:30' },
    { id: 'playground',   label: 'Playground',          time: '16:00 - 17:00' },
    { id: 'dormitory',    label: 'Dormitory (Night)',   time: '21:00 - 22:00' }
];

// Subject color palette — hand-written classes referenced in the table cells
const SUBJECT_CLASS = {
    'Mathematics': 'tt-sub-math',
    'English': 'tt-sub-english',
    'Kiswahili': 'tt-sub-kiswahili',
    'Science and Technology': 'tt-sub-science',
    'Science': 'tt-sub-science',
    'Integrated Science': 'tt-sub-science',
    'Social Studies': 'tt-sub-social',
    'CRE/IRE/HRE': 'tt-sub-cre',
    'Religious Education': 'tt-sub-cre',
    'Art and Craft': 'tt-sub-creative',
    'Creative Arts and Sports': 'tt-sub-creative',
    'Music': 'tt-sub-creative',
    'Physical Education': 'tt-sub-creative',
    'Pre-Technical Studies': 'tt-sub-tech',
    'Agriculture and Nutrition': 'tt-sub-agric'
};

const SUBJECT_WEIGHTS = {
    'Mathematics': 5, 'English': 5, 'Kiswahili': 5,
    'Science and Technology': 4, 'Science': 4, 'Integrated Science': 4,
    'Social Studies': 4, 'Pre-Technical Studies': 4, 'Agriculture and Nutrition': 4,
    'CRE/IRE/HRE': 3, 'Religious Education': 3,
    'Art and Craft': 3, 'Creative Arts and Sports': 3,
    'Music': 3, 'Physical Education': 3
};
const DEFAULT_SUBJECT_WEIGHT = 3;

// ---------- helpers ----------
function safeSlug(s) {
    return String(s || '').trim().replace(/\s+/g, '_').replace(/[\/\\.#$\[\]]/g, '');
}

function teacherInitials(t) {
    if (!t) return 'TBA';
    if (t.initials && String(t.initials).trim()) return String(t.initials).trim().toUpperCase();
    const f = (t.firstName || '').trim();
    const l = (t.lastName || '').trim();
    if (f && l) return (f[0] + l[0]).toUpperCase();
    if (f) return f.slice(0, 2).toUpperCase();
    if (t.email) return String(t.email).slice(0, 2).toUpperCase();
    return 'TBA';
}

function teacherFullName(t) {
    if (!t) return 'Unassigned';
    const f = (t.firstName || '').trim();
    const l = (t.lastName || '').trim();
    return `${f} ${l}`.trim() || t.email || 'Unassigned';
}

function subjectsForTeacher(t, subjects) {
    if (!t) return [];
    const declared = Array.isArray(t.subjects) ? t.subjects : [];
    if (!declared.length) return subjects;
    return subjects.filter(s => declared.includes(s));
}

function weightForSubject(sub) {
    return SUBJECT_WEIGHTS[sub] ?? DEFAULT_SUBJECT_WEIGHT;
}

function buildPeriodKey(level, cls, term, year) {
    return `${safeSlug(level)}_${safeSlug(cls)}_${safeSlug(term)}_${safeSlug(year)}`;
}
function buildRosterKey(schoolId, term, year) {
    return `${safeSlug(schoolId)}_${safeSlug(term)}_${safeSlug(year)}`;
}

// ---------- main component ----------
export default function Timetable() {
    const { currentUser, userData, userRole } = useAuth();
    const { getLevelClasses } = useSchool();

    const schoolId = userData?.schoolId;
    const isAdmin = ['admin', 'user', 'school_admin', 'super-admin'].includes(userRole);

    const [activeTab, setActiveTab] = useState('class');
    const [selectedLevel, setSelectedLevel] = useState('lower-primary');
    const [selectedClass, setSelectedClass] = useState('Grade 1');
    const [selectedTerm, setSelectedTerm] = useState('Term 1');
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());

    const [teachers, setTeachers] = useState([]);
    const [schoolInfo, setSchoolInfo] = useState(null);

    const [classSchedule, setClassSchedule] = useState({});
    const [classDirty, setClassDirty] = useState(false);
    const [classLoading, setClassLoading] = useState(false);
    const [allSchedules, setAllSchedules] = useState({});

    const [dutyRoster, setDutyRoster] = useState({});
    const [dutyDirty, setDutyDirty] = useState(false);

    const [saving, setSaving] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [feedback, setFeedback] = useState({ message: '', type: '' });
    const [showSlotModal, setShowSlotModal] = useState(false);
    const [editingSlot, setEditingSlot] = useState(null);
    const [showBulkModal, setShowBulkModal] = useState(false);
    const [bulkGenerating, setBulkGenerating] = useState(false);

    const printRef = useRef(null);

    const availableClasses = useMemo(() => {
        if (!selectedLevel || !getLevelClasses) return [];
        try { return getLevelClasses(selectedLevel) || []; } catch { return []; }
    }, [selectedLevel, getLevelClasses]);

    useEffect(() => {
        if (availableClasses.length && !availableClasses.includes(selectedClass)) {
            setSelectedClass(availableClasses[0]);
        }
    }, [availableClasses, selectedClass]);

    const availableSubjects = useMemo(
        () => LEVEL_SUBJECTS[selectedLevel] || ['Mathematics', 'English', 'Kiswahili', 'Science', 'Social Studies'],
        [selectedLevel]
    );

    const notify = useCallback((message, type = 'success') => {
        setFeedback({ message, type });
        setTimeout(() => setFeedback({ message: '', type: '' }), 4000);
    }, []);

    useEffect(() => {
        if (!schoolId) return;
        (async () => {
            try {
                const [schoolSnap, teachersSnap] = await Promise.all([
                    getDoc(doc(db, 'schools', schoolId)),
                    getDocs(query(collection(db, 'teachers'), where('schoolId', '==', schoolId)))
                ]);
                if (schoolSnap.exists()) setSchoolInfo(schoolSnap.data());
                setTeachers(teachersSnap.docs.map(d => ({ id: d.id, ...d.data() })));
            } catch (err) {
                console.error('load school/teachers:', err);
                notify('Failed to load school data: ' + err.message, 'error');
            }
        })();
    }, [schoolId, notify]);

    const loadClassTimetable = useCallback(async () => {
        if (!schoolId || !selectedLevel || !selectedClass || !selectedTerm || !selectedYear) return;
        setClassLoading(true);
        try {
            const id = buildPeriodKey(selectedLevel, selectedClass, selectedTerm, selectedYear);
            const ref = doc(db, 'school_timetables', `${safeSlug(schoolId)}_${id}`);
            const snap = await getDoc(ref);
            setClassSchedule(snap.exists() ? (snap.data().schedule || {}) : {});
            setClassDirty(false);
        } catch (err) {
            console.error('load class timetable:', err);
            notify('Failed to load timetable: ' + err.message, 'error');
        } finally {
            setClassLoading(false);
        }
    }, [schoolId, selectedLevel, selectedClass, selectedTerm, selectedYear, notify]);

    useEffect(() => { loadClassTimetable(); }, [loadClassTimetable]);

    const loadAllSchedules = useCallback(async () => {
        if (!schoolId || !selectedLevel || !availableClasses.length) return;
        try {
            const results = {};
            await Promise.all(availableClasses.map(async cls => {
                const id = buildPeriodKey(selectedLevel, cls, selectedTerm, selectedYear);
                const ref = doc(db, 'school_timetables', `${safeSlug(schoolId)}_${id}`);
                const snap = await getDoc(ref);
                results[cls] = snap.exists() ? (snap.data().schedule || {}) : {};
            }));
            setAllSchedules(results);
        } catch (err) {
            console.error('load all schedules:', err);
        }
    }, [schoolId, selectedLevel, selectedTerm, selectedYear, availableClasses]);

    useEffect(() => {
        if (activeTab === 'teachers' || activeTab === 'master') loadAllSchedules();
    }, [activeTab, loadAllSchedules]);

    const loadDutyRoster = useCallback(async () => {
        if (!schoolId) return;
        try {
            const id = buildRosterKey(schoolId, selectedTerm, selectedYear);
            const ref = doc(db, 'duty_rosters', id);
            const snap = await getDoc(ref);
            setDutyRoster(snap.exists() ? (snap.data().roster || {}) : {});
            setDutyDirty(false);
        } catch (err) {
            console.error('load duty roster:', err);
        }
    }, [schoolId, selectedTerm, selectedYear]);

    useEffect(() => {
        if (activeTab === 'duty') loadDutyRoster();
    }, [activeTab, loadDutyRoster]);

    const detectClashes = useCallback((proposedSchedule, currentClass) => {
        const clashes = [];
        const otherClasses = Object.entries(allSchedules).filter(([cls]) => cls !== currentClass);
        for (const day of DAYS) {
            for (const period of CLASS_PERIODS) {
                const slot = proposedSchedule?.[day]?.[period.id];
                if (!slot?.teacherId) continue;
                for (const [otherCls, otherSchedule] of otherClasses) {
                    const otherSlot = otherSchedule?.[day]?.[period.id];
                    if (otherSlot?.teacherId === slot.teacherId) {
                        clashes.push({
                            day, periodId: period.id, periodName: period.name,
                            teacherId: slot.teacherId, teacherName: slot.teacherFullName || slot.teacherInitials,
                            otherClass: otherCls, otherSubject: otherSlot.subject
                        });
                    }
                }
            }
        }
        return clashes;
    }, [allSchedules]);

    const saveClassTimetable = async () => {
        if (!schoolId || !selectedClass) return;
        setSaving(true);
        try {
            const clashes = detectClashes(classSchedule, selectedClass);
            if (clashes.length > 0) {
                const proceed = window.confirm(
                    `Warning: ${clashes.length} teacher clash${clashes.length > 1 ? 'es' : ''} detected. Save anyway?`
                );
                if (!proceed) { setSaving(false); return; }
            }

            const id = buildPeriodKey(selectedLevel, selectedClass, selectedTerm, selectedYear);
            const ref = doc(db, 'school_timetables', `${safeSlug(schoolId)}_${id}`);
            await setDoc(ref, {
                schoolId, level: selectedLevel, class: selectedClass,
                term: selectedTerm, year: selectedYear,
                schedule: classSchedule,
                updatedAt: serverTimestamp(),
                updatedBy: currentUser?.uid || 'admin'
            }, { merge: true });

            setClassDirty(false);
            notify('Timetable saved.', 'success');
            setAllSchedules(prev => ({ ...prev, [selectedClass]: classSchedule }));
        } catch (err) {
            console.error('save class timetable:', err);
            notify('Failed to save: ' + err.message, 'error');
        } finally {
            setSaving(false);
        }
    };

    const saveDutyRoster = async () => {
        if (!schoolId) return;
        setSaving(true);
        try {
            const id = buildRosterKey(schoolId, selectedTerm, selectedYear);
            const ref = doc(db, 'duty_rosters', id);
            await setDoc(ref, {
                schoolId, term: selectedTerm, year: selectedYear,
                roster: dutyRoster,
                updatedAt: serverTimestamp(),
                updatedBy: currentUser?.uid || 'admin'
            }, { merge: true });
            setDutyDirty(false);
            notify('Duty roster saved.', 'success');
        } catch (err) {
            console.error('save duty roster:', err);
            notify('Failed to save duty roster: ' + err.message, 'error');
        } finally {
            setSaving(false);
        }
    };

    const generateScheduleForClass = useCallback((cls, subjects, externalSchedules = null) => {
        const pool = [];
        for (const sub of subjects) {
            const w = weightForSubject(sub);
            for (let i = 0; i < w; i++) pool.push(sub);
        }

        const workingAll = externalSchedules || allSchedules;
        const teacherBusy = {};
        for (const day of DAYS) {
            for (const p of CLASS_PERIODS) teacherBusy[`${day}|${p.id}`] = new Set();
        }
        for (const [otherCls, sched] of Object.entries(workingAll)) {
            if (otherCls === cls) continue;
            for (const day of DAYS) {
                for (const p of CLASS_PERIODS) {
                    const slot = sched?.[day]?.[p.id];
                    if (slot?.teacherId) teacherBusy[`${day}|${p.id}`].add(slot.teacherId);
                }
            }
        }

        const teacherLoad = {};
        const schedule = {};

        for (const day of DAYS) {
            schedule[day] = {};
            const dayPool = [...pool];
            for (let i = dayPool.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [dayPool[i], dayPool[j]] = [dayPool[j], dayPool[i]];
            }

            for (const period of CLASS_PERIODS) {
                const busyKey = `${day}|${period.id}`;
                let assigned = null;

                for (const candidateSubject of dayPool) {
                    const candidates = teachers
                        .filter(t => subjectsForTeacher(t, [candidateSubject]).length > 0)
                        .filter(t => !teacherBusy[busyKey].has(t.id))
                        .filter(t => (teacherLoad[t.id] || 0) < (t.maxPeriods || 30));

                    if (candidates.length === 0) continue;
                    candidates.sort((a, b) => (teacherLoad[a.id] || 0) - (teacherLoad[b.id] || 0));
                    const chosen = candidates[0];
                    assigned = {
                        subject: candidateSubject,
                        teacherId: chosen.id,
                        teacherInitials: teacherInitials(chosen),
                        teacherFullName: teacherFullName(chosen),
                        room: `${cls} Room`
                    };
                    break;
                }

                if (!assigned) {
                    const freeTeachers = teachers.filter(t => !teacherBusy[busyKey].has(t.id));
                    if (freeTeachers.length) {
                        const chosen = freeTeachers[Math.floor(Math.random() * freeTeachers.length)];
                        const fallbackSubject = dayPool[Math.floor(Math.random() * dayPool.length)];
                        assigned = {
                            subject: fallbackSubject,
                            teacherId: chosen.id,
                            teacherInitials: teacherInitials(chosen),
                            teacherFullName: teacherFullName(chosen),
                            room: `${cls} Room`
                        };
                    }
                }

                if (assigned) {
                    schedule[day][period.id] = assigned;
                    teacherBusy[busyKey].add(assigned.teacherId);
                    teacherLoad[assigned.teacherId] = (teacherLoad[assigned.teacherId] || 0) + 1;
                }
            }
        }
        return schedule;
    }, [teachers, allSchedules]);

    const handleGenerateCurrentClass = () => {
        if (!teachers.length) { notify('No teachers loaded. Add teachers first.', 'warning'); return; }
        setGenerating(true);
        try {
            const schedule = generateScheduleForClass(selectedClass, availableSubjects);
            setClassSchedule(schedule);
            setClassDirty(true);
            notify('Timetable generated. Review and click Save.', 'success');
        } catch (err) {
            console.error('generate:', err);
            notify('Failed to generate: ' + err.message, 'error');
        } finally {
            setGenerating(false);
        }
    };

    const handleGenerateAllClasses = async () => {
        if (!teachers.length) { notify('No teachers loaded.', 'warning'); return; }
        setBulkGenerating(true);
        try {
            const workingAll = { ...allSchedules };
            const newAll = { ...allSchedules };
            for (const cls of availableClasses) {
                const schedule = generateScheduleForClass(cls, availableSubjects, workingAll);
                newAll[cls] = schedule;
                workingAll[cls] = schedule;
            }

            await Promise.all(availableClasses.map(async cls => {
                const id = buildPeriodKey(selectedLevel, cls, selectedTerm, selectedYear);
                const ref = doc(db, 'school_timetables', `${safeSlug(schoolId)}_${id}`);
                await setDoc(ref, {
                    schoolId, level: selectedLevel, class: cls,
                    term: selectedTerm, year: selectedYear,
                    schedule: newAll[cls],
                    updatedAt: serverTimestamp(),
                    updatedBy: currentUser?.uid || 'admin'
                }, { merge: true });
            }));

            setAllSchedules(newAll);
            setClassSchedule(newAll[selectedClass] || {});
            setClassDirty(false);
            setShowBulkModal(false);
            notify(`Generated timetables for ${availableClasses.length} class${availableClasses.length === 1 ? '' : 'es'}.`, 'success');
        } catch (err) {
            console.error('bulk generate:', err);
            notify('Bulk generation failed: ' + err.message, 'error');
        } finally {
            setBulkGenerating(false);
        }
    };

    const openSlotEditor = (day, periodId) => {
        if (!isAdmin) return;
        const current = classSchedule[day]?.[periodId] || {
            subject: '', teacherId: '', teacherInitials: '', teacherFullName: '',
            room: `${selectedClass} Room`
        };
        setEditingSlot({ day, periodId, ...current });
        setShowSlotModal(true);
    };

    const saveSlot = (e) => {
        e.preventDefault();
        if (!editingSlot) return;
        const { day, periodId, subject, teacherId, room } = editingSlot;
        if (!subject) { notify('Please select a subject.', 'warning'); return; }

        if (teacherId) {
            for (const [otherCls, sched] of Object.entries(allSchedules)) {
                if (otherCls === selectedClass) continue;
                const slot = sched?.[day]?.[periodId];
                if (slot?.teacherId === teacherId) {
                    const proceed = window.confirm(
                        `Conflict: ${slot.teacherFullName || slot.teacherInitials} is already teaching ${slot.subject} in ${otherCls} at this time. Save anyway?`
                    );
                    if (!proceed) return;
                }
            }
        }

        const teacher = teachers.find(t => t.id === teacherId);
        const newSlot = {
            subject,
            teacherId: teacherId || '',
            teacherInitials: teacher ? teacherInitials(teacher) : 'TBA',
            teacherFullName: teacher ? teacherFullName(teacher) : '',
            room: room || `${selectedClass} Room`
        };

        setClassSchedule(prev => ({
            ...prev,
            [day]: { ...(prev[day] || {}), [periodId]: newSlot }
        }));
        setClassDirty(true);
        setShowSlotModal(false);
        setEditingSlot(null);
    };

    const clearSlot = (day, periodId) => {
        if (!isAdmin) return;
        setClassSchedule(prev => {
            const copy = { ...prev, [day]: { ...(prev[day] || {}) } };
            delete copy[day][periodId];
            return copy;
        });
        setClassDirty(true);
    };

    const assignDuty = (day, areaId, teacherId) => {
        if (!isAdmin) return;
        const teacher = teachers.find(t => t.id === teacherId);
        setDutyRoster(prev => ({
            ...prev,
            [day]: {
                ...(prev[day] || {}),
                [areaId]: teacherId ? {
                    teacherId,
                    teacherInitials: teacherInitials(teacher),
                    teacherFullName: teacherFullName(teacher)
                } : null
            }
        }));
        setDutyDirty(true);
    };

    const totalAssignedSlots = useMemo(() => {
        let c = 0;
        Object.values(classSchedule).forEach(dayObj => { c += Object.keys(dayObj || {}).length; });
        return c;
    }, [classSchedule]);

    const teacherStats = useMemo(() => {
        const load = {};
        for (const [clsName, sched] of Object.entries(allSchedules)) {
            for (const day of DAYS) {
                for (const p of CLASS_PERIODS) {
                    const slot = sched?.[day]?.[p.id];
                    if (slot?.teacherId) {
                        if (!load[slot.teacherId]) {
                            load[slot.teacherId] = {
                                teacherId: slot.teacherId,
                                initials: slot.teacherInitials,
                                fullName: slot.teacherFullName,
                                assignments: []
                            };
                        }
                        load[slot.teacherId].assignments.push({
                            day, period: p, subject: slot.subject, className: clsName
                        });
                    }
                }
            }
        }
        return Object.values(load).sort((a, b) => b.assignments.length - a.assignments.length);
    }, [allSchedules]);

    const clashCount = useMemo(
        () => detectClashes(classSchedule, selectedClass).length,
        [classSchedule, selectedClass, detectClashes]
    );

    const exportPDF = (suffix) => {
        const title = `${selectedClass || activeTab} Timetable (${suffix})`;
        downloadTimetablePDF(classSchedule, title, schoolInfo, selectedTerm, selectedYear);
    };

    // ---------- renderers ----------
    const BrandedHeader = ({ title, subtitle }) => (
        <div className="tt-branded-header">
            <div className="tt-branded-left">
                <div className="tt-branded-logo">
                    {schoolInfo?.logoUrl ? (
                        <img src={schoolInfo.logoUrl} alt="Logo" />
                    ) : (
                        <i className="fas fa-graduation-cap"></i>
                    )}
                </div>
                <div className="tt-branded-text">
                    <h2>{schoolInfo?.name || 'School Name'}</h2>
                    <p>{[schoolInfo?.address, schoolInfo?.phone, schoolInfo?.email].filter(Boolean).join(' · ')}</p>
                    {schoolInfo?.motto && <p className="tt-branded-motto">{schoolInfo.motto}</p>}
                </div>
            </div>
            <div className="tt-branded-right">
                <div className="tt-branded-title">{title}</div>
                <div className="tt-branded-sub">{subtitle}</div>
            </div>
        </div>
    );

    const BrandedFooter = () => (
        <div className="tt-branded-footer">
            <div>© {new Date().getFullYear()} {schoolInfo?.name || 'School'}. All rights reserved.</div>
            {schoolInfo?.motto && <div className="tt-branded-footer-motto">{schoolInfo.motto}</div>}
            <div>Generated {new Date().toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
        </div>
    );

    const renderClassTimetable = () => (
        <div ref={printRef} className="tt-print-root">
            <BrandedHeader
                title="Class Master Timetable"
                subtitle={`${selectedClass} · ${selectedTerm} ${selectedYear}`}
            />

            {classLoading ? (
                <div className="tt-loading"><LoadingSpinner /></div>
            ) : (
                <>
                    {clashCount > 0 && (
                        <div className="tt-clash-warn">
                            <i className="fas fa-exclamation-triangle"></i>
                            <strong>{clashCount} clash{clashCount > 1 ? 'es' : ''}</strong> detected with other classes.
                        </div>
                    )}
                    <div className="tt-table-wrap">
                        <table className="tt-grid">
                            <thead>
                                <tr>
                                    <th className="tt-period-th">Time / Day</th>
                                    {DAYS.map(d => <th key={d}>{d}</th>)}
                                </tr>
                            </thead>
                            <tbody>
                                {PERIODS.map(period => {
                                    if (period.type === 'break') {
                                        return (
                                            <tr key={period.id} className="tt-break-row">
                                                <td>{period.time}</td>
                                                <td colSpan={DAYS.length}>☕ {period.label}</td>
                                            </tr>
                                        );
                                    }
                                    return (
                                        <tr key={period.id}>
                                            <td className="tt-period-cell">
                                                <div className="tt-period-name">{period.name}</div>
                                                <div className="tt-period-time">{period.time}</div>
                                            </td>
                                            {DAYS.map(day => {
                                                const slot = classSchedule[day]?.[period.id];
                                                const colorCls = slot ? (SUBJECT_CLASS[slot.subject] || 'tt-sub-default') : '';
                                                return (
                                                    <td
                                                        key={day}
                                                        onClick={() => openSlotEditor(day, period.id)}
                                                        className={`tt-cell ${slot ? colorCls : 'tt-cell-empty'}`}
                                                    >
                                                        {slot ? (
                                                            <div className="tt-cell-inner">
                                                                <div className="tt-cell-subject">
                                                                    <span className="tt-cell-subject-name">{slot.subject}</span>
                                                                    {isAdmin && (
                                                                        <button
                                                                            className="tt-clear-btn"
                                                                            onClick={(e) => { e.stopPropagation(); clearSlot(day, period.id); }}
                                                                            title="Clear"
                                                                        >
                                                                            <i className="fas fa-times"></i>
                                                                        </button>
                                                                    )}
                                                                </div>
                                                                <div className="tt-cell-teacher">
                                                                    <span className="tt-teacher-chip">{slot.teacherInitials || 'TBA'}</span>
                                                                </div>
                                                                {slot.room && <div className="tt-cell-room">{slot.room}</div>}
                                                            </div>
                                                        ) : (
                                                            <div className="tt-cell-placeholder">{isAdmin ? '+ Assign' : '—'}</div>
                                                        )}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </>
            )}

            <BrandedFooter />
        </div>
    );

    const renderTeacherTimetables = () => (
        <div ref={printRef} className="tt-print-root">
            <BrandedHeader
                title="Teacher Timetables & Workload"
                subtitle={`${selectedLevel} · ${selectedTerm} ${selectedYear}`}
            />
            {!teacherStats.length ? (
                <div className="tt-empty">
                    <i className="fas fa-chalkboard-user"></i>
                    <p>No teachers assigned yet. Generate or edit a class timetable first.</p>
                </div>
            ) : (
                <div className="tt-teachers-stack">
                    <div className="tt-workload-table">
                        <div className="tt-section-label">Workload Summary</div>
                        <table>
                            <thead>
                                <tr>
                                    <th>Initials</th>
                                    <th>Teacher</th>
                                    <th className="tt-center">Periods / Week</th>
                                    <th className="tt-center">Classes Taught</th>
                                </tr>
                            </thead>
                            <tbody>
                                {teacherStats.map(t => {
                                    const classes = new Set(t.assignments.map(a => a.className));
                                    return (
                                        <tr key={t.teacherId}>
                                            <td className="tt-initials-cell">{t.initials}</td>
                                            <td>{t.fullName}</td>
                                            <td className="tt-center tt-bold">{t.assignments.length}</td>
                                            <td className="tt-center">{classes.size}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {teacherStats.map(t => (
                        <div key={t.teacherId} className="tt-teacher-card">
                            <div className="tt-teacher-card-header">
                                <span>{t.fullName} <span className="tt-muted">({t.initials})</span></span>
                                <span className="tt-teacher-count">{t.assignments.length} periods/week</span>
                            </div>
                            <table className="tt-teacher-grid">
                                <thead>
                                    <tr>
                                        <th>Time</th>
                                        {DAYS.map(d => <th key={d}>{d}</th>)}
                                    </tr>
                                </thead>
                                <tbody>
                                    {CLASS_PERIODS.map(p => (
                                        <tr key={p.id}>
                                            <td className="tt-teacher-period">
                                                <div className="tt-period-name">{p.name}</div>
                                                <div className="tt-period-time">{p.time}</div>
                                            </td>
                                            {DAYS.map(day => {
                                                const slot = t.assignments.find(a => a.day === day && a.period.id === p.id);
                                                return (
                                                    <td key={day} className="tt-teacher-cell">
                                                        {slot ? (
                                                            <>
                                                                <div className="tt-teacher-subject">{slot.subject}</div>
                                                                <div className="tt-teacher-class">{slot.className}</div>
                                                            </>
                                                        ) : <span className="tt-muted">·</span>}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ))}
                </div>
            )}
            <BrandedFooter />
        </div>
    );

    const renderMasterOverview = () => (
        <div ref={printRef} className="tt-print-root">
            <BrandedHeader
                title="Master Timetable Overview"
                subtitle={`All Classes · ${selectedLevel} · ${selectedTerm} ${selectedYear}`}
            />
            {!availableClasses.length ? (
                <div className="tt-empty">
                    <i className="fas fa-school"></i>
                    <p>No classes found for this level.</p>
                </div>
            ) : (
                <div className="tt-master-stack">
                    {availableClasses.map(cls => {
                        const sched = allSchedules[cls] || {};
                        return (
                            <div key={cls} className="tt-master-card">
                                <div className="tt-master-title">{cls}</div>
                                <table className="tt-master-grid">
                                    <thead>
                                        <tr>
                                            <th>Time</th>
                                            {DAYS.map(d => <th key={d}>{d.slice(0, 3)}</th>)}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {CLASS_PERIODS.map(p => (
                                            <tr key={p.id}>
                                                <td className="tt-master-period">{p.name.replace('Period ', 'P')}</td>
                                                {DAYS.map(day => {
                                                    const slot = sched?.[day]?.[p.id];
                                                    return (
                                                        <td key={day} className="tt-master-cell">
                                                            {slot ? (
                                                                <>
                                                                    <div className="tt-master-subject">{slot.subject}</div>
                                                                    <div className="tt-master-teacher">{slot.teacherInitials}</div>
                                                                </>
                                                            ) : <span className="tt-muted">·</span>}
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        );
                    })}
                </div>
            )}
            <BrandedFooter />
        </div>
    );

    const renderDutyRoster = () => (
        <div ref={printRef} className="tt-print-root">
            <BrandedHeader
                title="Weekly Duty Roster"
                subtitle={`${selectedTerm} ${selectedYear}`}
            />
            <div className="tt-table-wrap">
                <table className="tt-grid tt-duty-grid">
                    <thead>
                        <tr>
                            <th className="tt-duty-area-th">Duty Area / Time</th>
                            {DAYS.map(d => <th key={d}>{d}</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {DUTY_AREAS.map(area => (
                            <tr key={area.id}>
                                <td className="tt-period-cell">
                                    <div className="tt-period-name">{area.label}</div>
                                    <div className="tt-period-time">{area.time}</div>
                                </td>
                                {DAYS.map(day => {
                                    const entry = dutyRoster?.[day]?.[area.id];
                                    return (
                                        <td key={day} className="tt-duty-cell">
                                            {isAdmin ? (
                                                <select
                                                    className="tt-duty-select"
                                                    value={entry?.teacherId || ''}
                                                    onChange={e => assignDuty(day, area.id, e.target.value)}
                                                >
                                                    <option value="">—</option>
                                                    {teachers.map(t => (
                                                        <option key={t.id} value={t.id}>
                                                            {teacherInitials(t)} · {teacherFullName(t)}
                                                        </option>
                                                    ))}
                                                </select>
                                            ) : (
                                                entry ? (
                                                    <>
                                                        <div className="tt-initials-cell">{entry.teacherInitials}</div>
                                                        <div className="tt-muted-small">{entry.teacherFullName}</div>
                                                    </>
                                                ) : <span className="tt-muted">—</span>
                                            )}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <BrandedFooter />
        </div>
    );

    const renderSettings = () => (
        <div className="tt-settings">
            <section className="card">
                <h3 className="tt-settings-title"><i className="fas fa-clock"></i> Period Schedule</h3>
                <p className="tt-settings-desc">
                    Standard KICD period structure used across all classes. Edit constants in <code>Timetable.jsx</code> to customise.
                </p>
                <div className="tt-period-list">
                    {PERIODS.map(p => (
                        <div key={p.id} className={`tt-period-chip ${p.type === 'break' ? 'break' : ''}`}>
                            <div className="tt-period-chip-name">{p.name}</div>
                            <div className="tt-period-chip-time">{p.time}</div>
                        </div>
                    ))}
                </div>
            </section>

            <section className="card">
                <h3 className="tt-settings-title"><i className="fas fa-chalkboard-user"></i> Teacher Subject Mapping</h3>
                <p className="tt-settings-desc">
                    For best auto-generation results, each teacher profile should list subjects they can teach.
                    Teachers with no <code>subjects</code> array are treated as general-purpose.
                </p>
                {teachers.length ? (
                    <div className="tt-table-wrap">
                        <table className="tt-settings-table">
                            <thead>
                                <tr>
                                    <th>Initials</th>
                                    <th>Teacher</th>
                                    <th>Subjects Assigned</th>
                                    <th className="tt-center">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {teachers.map(t => {
                                    const hasSubs = Array.isArray(t.subjects) && t.subjects.length > 0;
                                    return (
                                        <tr key={t.id}>
                                            <td className="tt-initials-cell">{teacherInitials(t)}</td>
                                            <td>{teacherFullName(t)}</td>
                                            <td>
                                                {hasSubs ? t.subjects.join(', ') : <span className="tt-muted">Not restricted</span>}
                                            </td>
                                            <td className="tt-center">
                                                <span className={`tt-chip ${hasSubs ? 'tt-chip-ok' : 'tt-chip-neutral'}`}>
                                                    {hasSubs ? 'Configured' : 'General'}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="tt-empty">
                        <i className="fas fa-user-slash"></i>
                        <p>No teachers loaded.</p>
                    </div>
                )}
            </section>

            <section className="card">
                <h3 className="tt-settings-title"><i className="fas fa-list-check"></i> Curriculum Subjects ({availableSubjects.length})</h3>
                <div className="tt-subject-chips">
                    {availableSubjects.map(s => (
                        <span key={s} className="tt-chip tt-chip-primary">{s}</span>
                    ))}
                </div>
            </section>
        </div>
    );

    const tabs = [
        { id: 'class',    label: 'Class Timetable',     icon: 'fa-calendar-days' },
        { id: 'teachers', label: 'Teacher Timetables',  icon: 'fa-chalkboard-user' },
        { id: 'master',   label: 'Master Overview',     icon: 'fa-layer-group' },
        { id: 'duty',     label: 'Duty Roster',         icon: 'fa-clipboard-list' },
        { id: 'settings', label: 'Settings',            icon: 'fa-cog' }
    ];

    const handleTabChange = (tab) => {
        if (classDirty && !window.confirm('You have unsaved changes to the class timetable. Continue?')) return;
        if (dutyDirty && !window.confirm('You have unsaved changes to the duty roster. Continue?')) return;
        setActiveTab(tab);
    };

    return (
        <Layout title="Timetable Master">
            <div className="tt-page">

                {/* Header */}
                <div className="tt-page-header">
                    <div>
                        <div className="tt-header-badges">
                            <span className="tt-badge-primary">KICD Compliant</span>
                            <span className="tt-header-sub">CBC Master Scheduler</span>
                        </div>
                        <h1 className="tt-page-title">Timetable Master</h1>
                        <p className="tt-page-sub">Generate class timetables, teacher schedules, and duty rosters — clash-free.</p>
                    </div>

                    <div className="tt-header-actions">
                        {isAdmin && activeTab === 'class' && (
                            <>
                                <button className="btn btn-primary" onClick={handleGenerateCurrentClass} disabled={generating}>
                                    <i className={`fas ${generating ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles'}`}></i>
                                    {generating ? 'Generating…' : 'Smart Generate'}
                                </button>
                                <button className="btn btn-outline" onClick={() => setShowBulkModal(true)}>
                                    <i className="fas fa-layer-group"></i> All Classes
                                </button>
                                <button className="btn btn-success" onClick={saveClassTimetable} disabled={saving || !classDirty}>
                                    <i className={`fas ${saving ? 'fa-spinner fa-spin' : 'fa-save'}`}></i>
                                    {saving ? 'Saving…' : classDirty ? 'Save *' : 'Saved'}
                                </button>
                                <button className="btn btn-primary" onClick={() => exportPDF(`${selectedClass}_Timetable`)}>
                                    <i className="fas fa-file-pdf"></i> Export PDF
                                </button>
                            </>
                        )}
                        {isAdmin && activeTab === 'duty' && (
                            <>
                                <button className="btn btn-success" onClick={saveDutyRoster} disabled={saving || !dutyDirty}>
                                    <i className={`fas ${saving ? 'fa-spinner fa-spin' : 'fa-save'}`}></i>
                                    {saving ? 'Saving…' : dutyDirty ? 'Save *' : 'Saved'}
                                </button>
                                <button className="btn btn-primary" onClick={() => exportPDF('Duty_Roster')}>
                                    <i className="fas fa-file-pdf"></i> Export PDF
                                </button>
                            </>
                        )}
                        {(activeTab === 'teachers' || activeTab === 'master') && (
                            <button className="btn btn-primary" onClick={() => exportPDF(activeTab === 'teachers' ? 'Teacher_Timetables' : 'Master_Overview')}>
                                <i className="fas fa-file-pdf"></i> Export PDF
                            </button>
                        )}
                    </div>
                </div>

                {/* Feedback */}
                {feedback.message && (
                    <div className={`tt-feedback tt-feedback-${feedback.type}`}>
                        <i className={`fas ${
                            feedback.type === 'error' ? 'fa-circle-exclamation' :
                            feedback.type === 'warning' ? 'fa-triangle-exclamation' : 'fa-circle-check'
                        }`}></i>
                        <span>{feedback.message}</span>
                    </div>
                )}

                {/* Tabs */}
                <div className="tt-tabs">
                    {tabs.map(t => (
                        <button
                            key={t.id}
                            className={`tt-tab ${activeTab === t.id ? 'active' : ''}`}
                            onClick={() => handleTabChange(t.id)}
                        >
                            <i className={`fas ${t.icon}`}></i>
                            <span>{t.label}</span>
                        </button>
                    ))}
                </div>

                {/* Scope filters */}
                {activeTab !== 'settings' && (
                    <div className="tt-filters">
                        {activeTab !== 'duty' && (
                            <>
                                <div className="tt-filter-group">
                                    <label>School Level</label>
                                    <select value={selectedLevel} onChange={e => setSelectedLevel(e.target.value)}>
                                        {SCHOOL_LEVELS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                                    </select>
                                </div>
                                <div className="tt-filter-group">
                                    <label>Class / Stream</label>
                                    <select
                                        value={selectedClass}
                                        onChange={e => setSelectedClass(e.target.value)}
                                        disabled={activeTab === 'teachers' || activeTab === 'master'}
                                    >
                                        {availableClasses.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                            </>
                        )}
                        <div className="tt-filter-group">
                            <label>Term</label>
                            <select value={selectedTerm} onChange={e => setSelectedTerm(e.target.value)}>
                                <option>Term 1</option><option>Term 2</option><option>Term 3</option>
                            </select>
                        </div>
                        <div className="tt-filter-group">
                            <label>Academic Year</label>
                            <select value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))}>
                                {[new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1].map(y => (
                                    <option key={y} value={y}>{y}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                )}

                {/* Tab body */}
                {activeTab === 'class' && renderClassTimetable()}
                {activeTab === 'teachers' && renderTeacherTimetables()}
                {activeTab === 'master' && renderMasterOverview()}
                {activeTab === 'duty' && renderDutyRoster()}
                {activeTab === 'settings' && renderSettings()}

                {/* Slot editor */}
                {showSlotModal && editingSlot && (
                    <div className="modal-overlay active" onClick={(e) => e.target === e.currentTarget && setShowSlotModal(false)}>
                        <div className="modal" style={{ maxWidth: 460 }}>
                            <div className="modal-header">
                                <h2>
                                    {editingSlot.day} · {PERIODS.find(p => p.id === editingSlot.periodId)?.name}
                                </h2>
                                <button className="modal-close" onClick={() => setShowSlotModal(false)}>
                                    <i className="fas fa-times"></i>
                                </button>
                            </div>
                            <form onSubmit={saveSlot}>
                                <div className="form-group">
                                    <label>Subject <span className="required">*</span></label>
                                    <select
                                        value={editingSlot.subject || ''}
                                        onChange={e => setEditingSlot({ ...editingSlot, subject: e.target.value })}
                                        required
                                    >
                                        <option value="">— Select subject —</option>
                                        {availableSubjects.map(s => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label>Teacher <span style={{ fontWeight: 400, textTransform: 'none', color: 'var(--gray)' }}>(initials shown in grid)</span></label>
                                    <select
                                        value={editingSlot.teacherId || ''}
                                        onChange={e => setEditingSlot({ ...editingSlot, teacherId: e.target.value })}
                                    >
                                        <option value="">— Unassigned —</option>
                                        {teachers.map(t => (
                                            <option key={t.id} value={t.id}>
                                                {teacherInitials(t)} · {teacherFullName(t)}
                                                {Array.isArray(t.subjects) && t.subjects.length ? ` · ${t.subjects.join(', ')}` : ''}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label>Room / Location</label>
                                    <input
                                        type="text"
                                        value={editingSlot.room || ''}
                                        onChange={e => setEditingSlot({ ...editingSlot, room: e.target.value })}
                                        placeholder="e.g. Room 101, Science Lab"
                                    />
                                </div>
                                <div className="modal-footer">
                                    <button type="button" className="btn btn-outline" onClick={() => setShowSlotModal(false)}>Cancel</button>
                                    <button type="submit" className="btn btn-primary">Save Slot</button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

                {/* Bulk generate confirm */}
                {showBulkModal && (
                    <div className="modal-overlay active" onClick={(e) => e.target === e.currentTarget && !bulkGenerating && setShowBulkModal(false)}>
                        <div className="modal" style={{ maxWidth: 520 }}>
                            <div className="modal-header">
                                <h2><i className="fas fa-layer-group"></i> Generate All Classes</h2>
                                <button className="modal-close" onClick={() => setShowBulkModal(false)} disabled={bulkGenerating}>
                                    <i className="fas fa-times"></i>
                                </button>
                            </div>
                            <p style={{ fontSize: 14, color: 'var(--secondary)', marginBottom: 16 }}>
                                This will generate clash-free timetables for <strong>{availableClasses.length}</strong> classes
                                in <strong>{selectedLevel}</strong> and save them. Existing timetables for these classes will be <strong>overwritten</strong>.
                            </p>
                            <div className="tt-warn-box">
                                <i className="fas fa-triangle-exclamation"></i>
                                Teachers must have a <code>subjects</code> array on their profile for best results.
                            </div>
                            <div className="modal-footer">
                                <button className="btn btn-outline" onClick={() => setShowBulkModal(false)} disabled={bulkGenerating}>Cancel</button>
                                <button className="btn btn-primary" onClick={handleGenerateAllClasses} disabled={bulkGenerating}>
                                    {bulkGenerating ? <><i className="fas fa-spinner fa-spin"></i> Generating…</> : <><i className="fas fa-bolt"></i> Generate All</>}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <style>{TT_STYLES}</style>
        </Layout>
    );
}

// ---------- styles ----------
const TT_STYLES = `
.tt-page { padding: 0; }
.tt-page-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; flex-wrap: wrap; margin-bottom: 20px; }
.tt-header-badges { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.tt-badge-primary { padding: 4px 12px; background: #eef2ff; color: var(--primary); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; border-radius: 20px; border: 1px solid #c7d2fe; }
.tt-header-sub { font-size: 12px; color: var(--gray); font-weight: 500; }
.tt-page-title { font-size: 26px; font-weight: 700; color: var(--secondary); margin: 6px 0 4px; }
.tt-page-sub { font-size: 14px; color: var(--gray); margin: 0; }
.tt-header-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.tt-header-actions .btn { padding: 10px 18px; font-size: 13px; }

.tt-feedback { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-radius: 10px; font-size: 13px; font-weight: 500; margin-bottom: 16px; border: 1px solid; }
.tt-feedback-success { background: #f0fdf4; border-color: #a7f3d0; color: #166534; }
.tt-feedback-error { background: #fef2f2; border-color: #fecaca; color: #991b1b; }
.tt-feedback-warning { background: #fffbeb; border-color: #fde68a; color: #92400e; }

.tt-tabs { display: flex; gap: 4px; flex-wrap: wrap; background: white; border: 1px solid var(--border); border-radius: 14px; padding: 6px; margin-bottom: 20px; }
.tt-tab { flex: 1; min-width: 140px; padding: 10px 16px; border-radius: 10px; border: none; background: transparent; color: var(--gray); font-size: 13px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 8px; transition: all 0.15s; }
.tt-tab:hover { background: var(--light); color: var(--secondary); }
.tt-tab.active { background: var(--primary); color: white; box-shadow: 0 2px 6px rgba(79,70,229,0.25); }

.tt-filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; background: white; border: 1px solid var(--border); border-radius: 14px; padding: 16px; margin-bottom: 20px; }
.tt-filter-group { display: flex; flex-direction: column; gap: 6px; }
.tt-filter-group label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--gray); }
.tt-filter-group select { padding: 9px 12px; border: 2px solid var(--border); border-radius: 10px; background: var(--light); font-size: 13px; font-weight: 500; color: var(--secondary); }
.tt-filter-group select:focus { outline: none; border-color: var(--primary); }

.tt-loading { padding: 60px; text-align: center; }
.tt-empty { padding: 60px 20px; text-align: center; color: var(--gray); }
.tt-empty i { font-size: 44px; color: var(--border); display: block; margin-bottom: 12px; }
.tt-empty p { font-size: 13px; margin: 0; }

.tt-clash-warn { padding: 12px 16px; background: #fffbeb; border: 1px solid #fde68a; color: #92400e; border-radius: 10px; font-size: 13px; display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }

.tt-warn-box { padding: 12px 14px; background: #fffbeb; border: 1px solid #fde68a; color: #92400e; border-radius: 10px; font-size: 12px; margin-bottom: 14px; }
.tt-warn-box code { background: rgba(0,0,0,0.05); padding: 1px 6px; border-radius: 4px; font-size: 12px; }

/* Print root */
.tt-print-root { background: white; border: 1px solid var(--border); border-radius: 14px; padding: 24px; box-shadow: var(--shadow); }

/* Branded header */
.tt-branded-header { display: flex; justify-content: space-between; align-items: center; gap: 20px; border-bottom: 2px solid #1e293b; padding-bottom: 16px; margin-bottom: 20px; flex-wrap: wrap; }
.tt-branded-left { display: flex; align-items: center; gap: 16px; min-width: 0; }
.tt-branded-logo { width: 64px; height: 64px; border-radius: 14px; background: var(--primary); color: white; display: flex; align-items: center; justify-content: center; font-size: 28px; flex-shrink: 0; overflow: hidden; }
.tt-branded-logo img { width: 100%; height: 100%; object-fit: cover; }
.tt-branded-text h2 { font-size: 20px; font-weight: 800; color: var(--secondary); margin: 0; }
.tt-branded-text p { font-size: 11px; color: var(--gray); margin: 2px 0 0; }
.tt-branded-motto { font-style: italic; color: var(--primary) !important; font-weight: 600; }
.tt-branded-right { text-align: right; }
.tt-branded-title { font-size: 14px; font-weight: 700; color: var(--secondary); }
.tt-branded-sub { font-size: 12px; color: var(--gray); margin-top: 2px; }

.tt-branded-footer { margin-top: 24px; padding-top: 12px; border-top: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 10px; color: var(--gray); }
.tt-branded-footer-motto { font-style: italic; color: var(--primary); }

/* Timetable grid */
.tt-table-wrap { overflow-x: auto; }
.tt-grid { width: 100%; border-collapse: collapse; table-layout: fixed; }
.tt-grid th, .tt-grid td { border: 1px solid var(--border); padding: 8px; vertical-align: top; font-size: 12px; }
.tt-grid thead th { background: #1e293b; color: white; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px; font-weight: 700; text-align: center; padding: 12px 6px; }
.tt-period-th { width: 110px; }
.tt-period-cell { background: #f1f5f9; text-align: center; }
.tt-period-name { font-weight: 700; color: var(--secondary); font-size: 11px; }
.tt-period-time { font-size: 10px; color: var(--gray); margin-top: 2px; }
.tt-break-row td { background: #fef3c7; color: #78350f; text-align: center; font-weight: 700; letter-spacing: 1px; font-size: 11px; text-transform: uppercase; padding: 8px; }

.tt-cell { cursor: pointer; min-height: 70px; transition: background 0.15s; }
.tt-cell-empty { background: white; }
.tt-cell-empty:hover { background: #f8fafc; }
.tt-cell-inner { display: flex; flex-direction: column; gap: 4px; }
.tt-cell-subject { display: flex; justify-content: space-between; align-items: flex-start; gap: 4px; }
.tt-cell-subject-name { font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.3px; line-height: 1.2; }
.tt-clear-btn { background: none; border: none; color: #94a3b8; cursor: pointer; padding: 0; font-size: 11px; opacity: 0.4; }
.tt-cell:hover .tt-clear-btn { opacity: 1; }
.tt-clear-btn:hover { color: var(--danger); }
.tt-cell-teacher { display: flex; gap: 4px; }
.tt-teacher-chip { display: inline-block; padding: 1px 7px; border-radius: 5px; background: rgba(255,255,255,0.7); border: 1px solid currentColor; font-weight: 700; font-size: 10px; letter-spacing: 0.5px; }
.tt-cell-room { font-size: 9px; opacity: 0.75; }
.tt-cell-placeholder { display: flex; align-items: center; justify-content: center; height: 50px; color: #cbd5e1; font-size: 10px; font-style: italic; }

/* Subject colors */
.tt-sub-math       { background: #eff6ff; color: #1d4ed8; border-color: #bfdbfe !important; }
.tt-sub-english    { background: #eef2ff; color: #4338ca; border-color: #c7d2fe !important; }
.tt-sub-kiswahili  { background: #ecfdf5; color: #047857; border-color: #a7f3d0 !important; }
.tt-sub-science    { background: #f0fdfa; color: #0f766e; border-color: #99f6e4 !important; }
.tt-sub-social     { background: #fffbeb; color: #b45309; border-color: #fde68a !important; }
.tt-sub-cre        { background: #faf5ff; color: #7e22ce; border-color: #e9d5ff !important; }
.tt-sub-creative   { background: #fdf2f8; color: #be185d; border-color: #fbcfe8 !important; }
.tt-sub-tech       { background: #ecfeff; color: #0e7490; border-color: #a5f3fc !important; }
.tt-sub-agric      { background: #f7fee7; color: #4d7c0f; border-color: #d9f99d !important; }
.tt-sub-default    { background: #f8fafc; color: #475569; border-color: #e2e8f0 !important; }

/* Teacher workload table */
.tt-teachers-stack { display: flex; flex-direction: column; gap: 20px; }
.tt-workload-table { border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
.tt-section-label { padding: 10px 14px; background: #f1f5f9; color: var(--secondary); font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
.tt-workload-table table { width: 100%; border-collapse: collapse; font-size: 13px; }
.tt-workload-table th { padding: 10px 14px; text-align: left; background: #f8fafc; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--gray); border-bottom: 1px solid var(--border); }
.tt-workload-table td { padding: 10px 14px; border-bottom: 1px solid var(--border); }
.tt-workload-table tbody tr:last-child td { border-bottom: none; }
.tt-initials-cell { font-weight: 800; color: var(--primary); font-family: 'Courier New', monospace; letter-spacing: 0.5px; }
.tt-bold { font-weight: 700; }
.tt-center { text-align: center !important; }
.tt-muted { color: var(--gray); font-size: 11px; }
.tt-muted-small { color: var(--gray); font-size: 10px; }

/* Teacher card */
.tt-teacher-card { border: 1px solid var(--border); border-radius: 12px; overflow: hidden; break-inside: avoid; page-break-inside: avoid; }
.tt-teacher-card-header { padding: 10px 14px; background: var(--primary); color: white; font-size: 13px; font-weight: 700; display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
.tt-teacher-card-header .tt-muted { color: rgba(255,255,255,0.7); }
.tt-teacher-count { font-size: 11px; background: rgba(255,255,255,0.2); padding: 3px 10px; border-radius: 12px; }
.tt-teacher-grid { width: 100%; border-collapse: collapse; font-size: 11px; }
.tt-teacher-grid th, .tt-teacher-grid td { border: 1px solid var(--border); padding: 5px 6px; text-align: center; vertical-align: middle; }
.tt-teacher-grid thead th { background: #f1f5f9; color: var(--secondary); font-weight: 600; font-size: 11px; }
.tt-teacher-period { background: #f8fafc; }
.tt-teacher-cell { min-height: 32px; }
.tt-teacher-subject { font-weight: 700; color: var(--primary); font-size: 10px; }
.tt-teacher-class { font-size: 9px; color: var(--gray); margin-top: 1px; }

/* Master overview */
.tt-master-stack { display: flex; flex-direction: column; gap: 16px; }
.tt-master-card { border: 1px solid var(--border); border-radius: 12px; overflow: hidden; break-inside: avoid; page-break-inside: avoid; }
.tt-master-title { padding: 8px 14px; background: #f1f5f9; font-weight: 700; font-size: 12px; color: var(--secondary); text-transform: uppercase; letter-spacing: 0.5px; }
.tt-master-grid { width: 100%; border-collapse: collapse; font-size: 10px; }
.tt-master-grid th, .tt-master-grid td { border: 1px solid var(--border); padding: 4px; text-align: center; }
.tt-master-grid thead th { background: #f8fafc; font-weight: 600; }
.tt-master-period { background: #f8fafc; font-weight: 600; color: var(--gray); }
.tt-master-cell { min-height: 30px; }
.tt-master-subject { font-weight: 700; font-size: 10px; line-height: 1.15; }
.tt-master-teacher { font-size: 9px; color: var(--gray); margin-top: 1px; }

/* Duty grid */
.tt-duty-grid thead th { padding: 10px 6px; }
.tt-duty-area-th { width: 200px; text-align: left !important; }
.tt-duty-cell { padding: 6px !important; text-align: center; vertical-align: middle; }
.tt-duty-select { width: 100%; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; background: white; font-size: 12px; }
.tt-duty-select:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 2px rgba(79,70,229,0.15); }

/* Settings */
.tt-settings { display: flex; flex-direction: column; gap: 18px; }
.tt-settings .card { padding: 20px; }
.tt-settings-title { font-size: 15px; font-weight: 700; color: var(--secondary); margin: 0 0 6px; display: flex; align-items: center; gap: 8px; }
.tt-settings-title i { color: var(--primary); }
.tt-settings-desc { font-size: 12px; color: var(--gray); margin: 0 0 14px; }
.tt-settings-desc code { background: var(--light); padding: 1px 6px; border-radius: 4px; font-size: 11px; }

.tt-period-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
.tt-period-chip { padding: 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--light); }
.tt-period-chip.break { background: #fffbeb; border-color: #fde68a; }
.tt-period-chip-name { font-size: 11px; font-weight: 700; color: var(--secondary); }
.tt-period-chip-time { font-size: 10px; color: var(--gray); margin-top: 2px; }

.tt-subject-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.tt-chip { display: inline-block; padding: 4px 10px; border-radius: 8px; font-size: 11px; font-weight: 600; border: 1px solid; }
.tt-chip-primary { background: #eef2ff; color: var(--primary); border-color: #c7d2fe; }
.tt-chip-ok { background: #ecfdf5; color: #047857; border-color: #a7f3d0; }
.tt-chip-neutral { background: #f1f5f9; color: #475569; border-color: #e2e8f0; }

.tt-settings-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.tt-settings-table th { padding: 10px 14px; text-align: left; background: #f8fafc; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--gray); border-bottom: 1px solid var(--border); }
.tt-settings-table td { padding: 10px 14px; border-bottom: 1px solid var(--border); }
.tt-settings-table tbody tr:last-child td { border-bottom: none; }

/* Print */
@media print {
    .tt-page-header-actions, .tt-tabs, .tt-filters, .tt-feedback, .tt-header-actions { display: none !important; }
    .tt-print-root { box-shadow: none !important; border: none !important; padding: 0 !important; }
    .tt-teacher-card, .tt-master-card, .tt-grid { break-inside: avoid; page-break-inside: avoid; }
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
}
`;