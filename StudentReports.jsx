// src/pages/StudentReports.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase';
import { 
    collection, query, where, getDocs, onSnapshot,
    doc, getDoc, orderBy 
} from 'firebase/firestore';
import Layout from '../components/Layout/Layout';
import LoadingSpinner from '../components/Common/LoadingSpinner';
import {
    LEVEL_CLASSES,
    LEVEL_DISPLAY_NAMES,
    LEVEL_BADGE_CLASSES,
    LEVEL_SUBJECTS,
    CBC_GRADING_SYSTEM,
    getCBCGrade
} from '../utils/constants';

// Utility function for time formatting
const formatTimeAgo = (date) => {
    if (!date) return 'Just now';
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' minutes ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' hours ago';
    if (diff < 604800000) return Math.floor(diff / 86400000) + ' days ago';
    return date.toLocaleDateString();
};

// Sample data for template
const sampleSubjects = [
    'English', 'Kiswahili', 'Mathematics', 'Integrated Science', 
    'Social Studies', 'Religious Education', 'Pre-Technical Studies', 'Agriculture & Nutrition'
];

const sampleStudent = {
    firstName: 'John',
    lastName: 'Doe',
    studentId: 'STU-2024-001',
    admissionNumber: 'ADM-001',
    class: 'Grade 7',
    scores: {
        'English': [85, 78, 92],
        'Kiswahili': [72, 68, 75],
        'Mathematics': [68, 72, 65],
        'Integrated Science': [90, 85, 88],
        'Social Studies': [75, 70, 80],
        'Religious Education': [80, 75, 85],
        'Pre-Technical Studies': [65, 70, 60],
        'Agriculture & Nutrition': [88, 82, 90]
    }
};

export default function StudentReports() {
    const navigate = useNavigate();
    const { currentUser, userData, userRole } = useAuth();
    
    // State for filters
    const [selectedLevel, setSelectedLevel] = useState('');
    const [selectedClass, setSelectedClass] = useState('');
    const [selectedTerm, setSelectedTerm] = useState('2');
    const [schoolData, setSchoolData] = useState(null);
    
    // State for data
    const [students, setStudents] = useState([]);
    const [studentScores, setStudentScores] = useState({});
    const [subjects, setSubjects] = useState([]);
    const [loading, setLoading] = useState(false);
    const [generating, setGenerating] = useState(false);
    
    // State for modal
    const [showModal, setShowModal] = useState(false);
    const [selectedStudent, setSelectedStudent] = useState(null);
    const [reportHTML, setReportHTML] = useState('');
    
    // Refs
    const reportContentRef = useRef(null);
    const classContainerRef = useRef(null);

    // Load school data on mount
    useEffect(() => {
        if (currentUser && userData) {
            loadSchoolData();
        }
    }, [currentUser, userData]);

    const loadSchoolData = async () => {
        try {
            if (userData?.schoolId) {
                const schoolDoc = await getDoc(doc(db, 'schools', userData.schoolId));
                if (schoolDoc.exists()) {
                    setSchoolData({
                        id: schoolDoc.id,
                        ...schoolDoc.data()
                    });
                }
            }
        } catch (error) {
            console.error('Error loading school data:', error);
        }
    };

    // Handle level change
    const handleLevelChange = (e) => {
        const level = e.target.value;
        setSelectedLevel(level);
        setSelectedClass('');
        
        // Update subjects based on level
        const levelSubjects = LEVEL_SUBJECTS[level] || [];
        setSubjects(levelSubjects);
    };

    // Handle class change
    const handleClassChange = (e) => {
        setSelectedClass(e.target.value);
    };

    // Handle term change
    const handleTermChange = (e) => {
        setSelectedTerm(e.target.value);
    };

    // Load students
    const loadStudents = async () => {
        if (!selectedLevel || !selectedClass) {
            showNotification('Please select level and class', 'warning');
            return;
        }

        setLoading(true);

        try {
            const schoolId = userData?.schoolId || 'default_school';
            
            // Get students
            const studentsQuery = query(
                collection(db, 'students'),
                where('schoolId', '==', schoolId),
                where('level', '==', selectedLevel),
                where('class', '==', selectedClass),
                orderBy('firstName')
            );
            const studentsSnapshot = await getDocs(studentsQuery);
            
            const studentsData = [];
            studentsSnapshot.forEach(doc => {
                studentsData.push({
                    id: doc.id,
                    ...doc.data()
                });
            });

            if (studentsData.length === 0) {
                showNotification('No students found for this class', 'warning');
                setStudents([]);
                setLoading(false);
                return;
            }

            setStudents(studentsData);
            
            // Load scores
            await loadScores(studentsData);
            
            showNotification(`Loaded ${studentsData.length} students`, 'success');

        } catch (error) {
            console.error('Error loading students:', error);
            showNotification('Failed to load students', 'error');
        } finally {
            setLoading(false);
        }
    };

    // Load scores
    const loadScores = async (studentsData) => {
        try {
            const schoolId = userData?.schoolId || 'default_school';
            const levelSubjects = LEVEL_SUBJECTS[selectedLevel] || [];
            setSubjects(levelSubjects);

            const scoresQuery = query(
                collection(db, 'student_scores'),
                where('schoolId', '==', schoolId),
                where('level', '==', selectedLevel),
                where('class', '==', selectedClass)
            );
            const scoresSnapshot = await getDocs(scoresQuery);
            
            const scoresMap = {};
            studentsData.forEach(student => {
                scoresMap[student.id] = {};
                levelSubjects.forEach(subject => {
                    scoresMap[student.id][subject] = [];
                });
            });

            scoresSnapshot.forEach(doc => {
                const data = doc.data();
                if (scoresMap[data.studentId] && scoresMap[data.studentId][data.subject]) {
                    scoresMap[data.studentId][data.subject].push(data.score || 0);
                }
            });

            // Calculate averages
            studentsData.forEach(student => {
                student.scores = {};
                student.averages = {};
                let totalScore = 0;
                let subjectCount = 0;
                
                levelSubjects.forEach(subject => {
                    const scores = scoresMap[student.id]?.[subject] || [];
                    if (scores.length > 0) {
                        student.scores[subject] = scores;
                        const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
                        student.averages[subject] = avg;
                        totalScore += avg;
                        subjectCount++;
                    } else {
                        student.scores[subject] = [];
                        student.averages[subject] = null;
                    }
                });
                
                student.overallAverage = subjectCount > 0 ? Math.round(totalScore / subjectCount) : 0;
            });

            setStudentScores(scoresMap);

        } catch (error) {
            console.error('Error loading scores:', error);
        }
    };

    // Clear students
    const clearStudents = () => {
        setStudents([]);
        setStudentScores({});
        showNotification('Students cleared', 'info');
    };

    // Generate report for a single student
    const generateReport = (studentId) => {
        const student = students.find(s => s.id === studentId);
        if (!student) {
            showNotification('Student not found', 'error');
            return;
        }

        setSelectedStudent(student);
        const html = createReportHTML(student);
        setReportHTML(html);
        setShowModal(true);
    };

    // Create report HTML
    const createReportHTML = (student, isTemplate = false) => {
        const schoolName = schoolData?.name || 'TOPLINK EDU School';
        const schoolMotto = schoolData?.motto || 'Excellence in Education';
        const logoUrl = schoolData?.logoUrl || 'https://via.placeholder.com/80';
        const termNames = ['', 'First Term', 'Second Term', 'Third Term'];
        const termName = termNames[parseInt(selectedTerm)] || 'Term';

        let performanceData;
        let overallAvg;
        let totalSubjects;
        let scoredCount;

        if (isTemplate) {
            const sampleSubjectScores = student.scores || {};
            const subjectList = Object.keys(sampleSubjectScores);
            totalSubjects = subjectList.length;
            
            performanceData = subjectList.map(subject => {
                const scores = sampleSubjectScores[subject] || [];
                const avg = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
                const cbcGrade = avg !== null ? getCBCGrade(avg) : { code: 'NA', level: 'NA', label: 'Not Assessed', points: 0, levelClass: 'na' };
                return { subject, scores, average: avg, cbcGrade };
            });

            const scoredSubjects = performanceData.filter(p => p.average !== null);
            scoredCount = scoredSubjects.length;
            const totalScore = scoredSubjects.reduce((sum, p) => sum + (p.average || 0), 0);
            overallAvg = scoredCount > 0 ? Math.round(totalScore / totalSubjects) : 0;
        } else {
            const levelSubjects = LEVEL_SUBJECTS[selectedLevel] || [];
            performanceData = levelSubjects.map(subject => {
                const scores = student.scores?.[subject] || [];
                const avg = student.averages?.[subject] || null;
                const cbcGrade = avg !== null ? getCBCGrade(avg) : { code: 'NA', level: 'NA', label: 'Not Assessed', points: 0, levelClass: 'na' };
                return { subject, scores, average: avg, cbcGrade };
            });

            const scoredSubjects = performanceData.filter(p => p.average !== null);
            totalSubjects = levelSubjects.length;
            scoredCount = scoredSubjects.length;
            overallAvg = student.overallAverage || 0;
        }

        const overallCBC = getCBCGrade(overallAvg);

        // Generate performance comments
        let comment = '';
        if (overallCBC.level === 'EE') {
            comment = 'The student is Exceeding Expectation. Outstanding performance demonstrating mastery of all competencies.';
        } else if (overallCBC.level === 'ME') {
            comment = 'The student is Meeting Expectation. Good performance showing competency in most areas.';
        } else if (overallCBC.level === 'AE') {
            comment = 'The student is Approaching Expectation. Needs additional support to meet required competencies.';
        } else if (overallCBC.level === 'BE') {
            comment = 'The student is Below Expectation. Significant intervention and support are required to achieve competencies.';
        } else {
            comment = 'The student has not been assessed in sufficient areas to determine competency level.';
        }

        const nextTermStart = schoolData?.nextTermStart ? new Date(schoolData.nextTermStart) : new Date();
        const currentTermEnd = schoolData?.currentTermEnd ? new Date(schoolData.currentTermEnd) : new Date();

        const displayStart = nextTermStart;
        const displayEnd = currentTermEnd;
        const watermarkHtml = isTemplate ? 
            `<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-45deg);font-size:100px;font-weight:900;color:rgba(200,200,200,0.12);pointer-events:none;z-index:0;letter-spacing:15px;">TEMPLATE</div>` : '';

        return `
            <div className="report-container active" id="reportContent" style="background:white;padding:20px 25px;max-width:210mm;min-height:297mm;margin:0 auto;font-family:'Times New Roman',serif;position:relative;font-size:11px;">
                ${watermarkHtml}
                <div style="position:relative;z-index:1;">
                    <!-- Header -->
                    <div style="text-align:center;border-bottom:2px double #1a237e;padding-bottom:10px;margin-bottom:10px;">
                        <div style="display:flex;align-items:center;justify-content:center;gap:12px;">
                            <img src="${logoUrl}" alt="School Logo" style="width:50px;height:50px;border-radius:50%;object-fit:cover;border:2px solid #1a237e;" onerror="this.src='https://via.placeholder.com/80'"/>
                            <div>
                                <div style="font-size:18px;font-weight:700;color:#1a237e;letter-spacing:1px;">${schoolName}</div>
                                <div style="font-size:10px;color:#95a5a6;font-style:italic;margin-top:1px;">"${schoolMotto}"</div>
                            </div>
                        </div>
                    </div>

                    <div style="text-align:center;font-size:14px;font-weight:700;color:#1a237e;margin:5px 0;letter-spacing:2px;text-transform:uppercase;">Student Report Form</div>

                    <!-- Student Info -->
                    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:3px 15px;margin:6px 0 10px;padding:6px 12px;background:#f8f9fa;border-radius:4px;font-size:11px;">
                        <div style="display:flex;gap:5px;">
                            <span style="font-weight:600;color:#2c3e50;min-width:70px;font-size:10px;">Student Name:</span>
                            <span style="color:#2c3e50;font-size:10px;font-weight:500;">${student.firstName || ''} ${student.lastName || ''}</span>
                        </div>
                        <div style="display:flex;gap:5px;">
                            <span style="font-weight:600;color:#2c3e50;min-width:70px;font-size:10px;">Admission No:</span>
                            <span style="color:#2c3e50;font-size:10px;font-weight:500;">${student.admissionNumber || student.studentId || 'N/A'}</span>
                        </div>
                        <div style="display:flex;gap:5px;">
                            <span style="font-weight:600;color:#2c3e50;min-width:70px;font-size:10px;">Level:</span>
                            <span style="color:#2c3e50;font-size:10px;font-weight:500;">${selectedLevel ? selectedLevel.replace('-', ' ').toUpperCase() : 'N/A'}</span>
                        </div>
                        <div style="display:flex;gap:5px;">
                            <span style="font-weight:600;color:#2c3e50;min-width:70px;font-size:10px;">Class:</span>
                            <span style="color:#2c3e50;font-size:10px;font-weight:500;">${student.class || selectedClass || 'N/A'}</span>
                        </div>
                        <div style="display:flex;gap:5px;">
                            <span style="font-weight:600;color:#2c3e50;min-width:70px;font-size:10px;">Term:</span>
                            <span style="color:#2c3e50;font-size:10px;font-weight:500;">${termName}</span>
                        </div>
                        <div style="display:flex;gap:5px;">
                            <span style="font-weight:600;color:#2c3e50;min-width:70px;font-size:10px;">Academic Year:</span>
                            <span style="color:#2c3e50;font-size:10px;font-weight:500;">${new Date().getFullYear()}</span>
                        </div>
                        <div style="display:flex;gap:5px;">
                            <span style="font-weight:600;color:#2c3e50;min-width:70px;font-size:10px;">Date Issued:</span>
                            <span style="color:#2c3e50;font-size:10px;font-weight:500;">${new Date().toLocaleDateString()}</span>
                        </div>
                        <div style="display:flex;gap:5px;">
                            <span style="font-weight:600;color:#2c3e50;min-width:70px;font-size:10px;">Overall CBC Level:</span>
                            <span style="color:#2c3e50;font-size:10px;font-weight:700;">
                                <span style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:9px;font-weight:700;min-width:30px;background:${overallCBC.level === 'EE' ? '#d4edda' : overallCBC.level === 'ME' ? '#d1ecf1' : overallCBC.level === 'AE' ? '#fff3cd' : '#f8d7da'};color:${overallCBC.level === 'EE' ? '#155724' : overallCBC.level === 'ME' ? '#0c5460' : overallCBC.level === 'AE' ? '#856404' : '#721c24'};border:1px solid ${overallCBC.level === 'EE' ? '#27ae60' : overallCBC.level === 'ME' ? '#2ecc71' : overallCBC.level === 'AE' ? '#f39c12' : '#e74c3c'};">
                                    ${overallCBC.code} (${overallCBC.points.toFixed(1)} pts)
                                    <span style="font-size:7px;color:#95a5a6;display:block;margin-top:0px;">${overallCBC.label}</span>
                                </span>
                            </span>
                        </div>
                    </div>

                    <!-- CBC Legend -->
                    <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin:4px 0 8px;font-size:8px;">
                        <span style="display:flex;align-items:center;gap:3px;"><span style="width:8px;height:8px;border-radius:50%;display:inline-block;background:#27ae60;"></span> EE - Exceeding Expectation</span>
                        <span style="display:flex;align-items:center;gap:3px;"><span style="width:8px;height:8px;border-radius:50%;display:inline-block;background:#2ecc71;"></span> ME - Meeting Expectation</span>
                        <span style="display:flex;align-items:center;gap:3px;"><span style="width:8px;height:8px;border-radius:50%;display:inline-block;background:#f39c12;"></span> AE - Approaching Expectation</span>
                        <span style="display:flex;align-items:center;gap:3px;"><span style="width:8px;height:8px;border-radius:50%;display:inline-block;background:#e74c3c;"></span> BE - Below Expectation</span>
                    </div>

                    <!-- Performance Table -->
                    <table style="width:100%;border-collapse:collapse;margin:8px 0;font-size:10px;border:2px solid #1a237e;border-radius:8px;overflow:hidden;">
                        <thead>
                            <tr>
                                <th style="background:#1a237e;color:white;padding:6px 8px;text-align:center;font-weight:700;font-size:9px;border:1px solid #0d1445;text-transform:uppercase;letter-spacing:0.5px;text-align:left;width:25%;">Subject</th>
                                <th style="background:#1a237e;color:white;padding:6px 8px;text-align:center;font-weight:700;font-size:9px;border:1px solid #0d1445;text-transform:uppercase;letter-spacing:0.5px;text-align:center;width:10%;">Ass 1</th>
                                <th style="background:#1a237e;color:white;padding:6px 8px;text-align:center;font-weight:700;font-size:9px;border:1px solid #0d1445;text-transform:uppercase;letter-spacing:0.5px;text-align:center;width:10%;">Ass 2</th>
                                <th style="background:#1a237e;color:white;padding:6px 8px;text-align:center;font-weight:700;font-size:9px;border:1px solid #0d1445;text-transform:uppercase;letter-spacing:0.5px;text-align:center;width:10%;">Ass 3</th>
                                <th style="background:#1a237e;color:white;padding:6px 8px;text-align:center;font-weight:700;font-size:9px;border:1px solid #0d1445;text-transform:uppercase;letter-spacing:0.5px;text-align:center;width:10%;">Avg</th>
                                <th style="background:#1a237e;color:white;padding:6px 8px;text-align:center;font-weight:700;font-size:9px;border:1px solid #0d1445;text-transform:uppercase;letter-spacing:0.5px;text-align:center;width:15%;">CBC Level</th>
                                <th style="background:#1a237e;color:white;padding:6px 8px;text-align:center;font-weight:700;font-size:9px;border:1px solid #0d1445;text-transform:uppercase;letter-spacing:0.5px;text-align:center;width:10%;">Points</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${performanceData.map((item, index) => {
                                const scores = item.scores || [];
                                const ass1 = scores[0] || null;
                                const ass2 = scores[1] || null;
                                const ass3 = scores[2] || null;
                                const avg = item.average;
                                const cbcGrade = item.cbcGrade;
                                
                                const avgClass = avg !== null ? (avg >= 75 ? 'color:#27ae60;' : (avg < 40 ? 'color:#e74c3c;' : '')) : '';
                                
                                return `
                                    <tr style="${index % 2 === 0 ? 'background:#ffffff;' : 'background:#f8f9fa;'}">
                                        <td style="padding:5px 8px;border:1px solid #2c3e50;text-align:center;font-size:10px;vertical-align:middle;font-weight:600;text-align:left;padding-left:12px;font-size:10px;color:#2c3e50;">${item.subject}</td>
                                        <td style="padding:5px 8px;border:1px solid #2c3e50;text-align:center;font-size:10px;vertical-align:middle;font-weight:600;text-align:center;font-size:11px;${ass1 !== null && ass1 >= 75 ? 'color:#27ae60;' : (ass1 !== null && ass1 < 40 ? 'color:#e74c3c;' : '')}">${ass1 !== null ? ass1 : '-'}</td>
                                        <td style="padding:5px 8px;border:1px solid #2c3e50;text-align:center;font-size:10px;vertical-align:middle;font-weight:600;text-align:center;font-size:11px;${ass2 !== null && ass2 >= 75 ? 'color:#27ae60;' : (ass2 !== null && ass2 < 40 ? 'color:#e74c3c;' : '')}">${ass2 !== null ? ass2 : '-'}</td>
                                        <td style="padding:5px 8px;border:1px solid #2c3e50;text-align:center;font-size:10px;vertical-align:middle;font-weight:600;text-align:center;font-size:11px;${ass3 !== null && ass3 >= 75 ? 'color:#27ae60;' : (ass3 !== null && ass3 < 40 ? 'color:#e74c3c;' : '')}">${ass3 !== null ? ass3 : '-'}</td>
                                        <td style="padding:5px 8px;border:1px solid #2c3e50;text-align:center;font-size:10px;vertical-align:middle;font-weight:700;text-align:center;font-size:11px;${avgClass}">${avg !== null ? avg : 'N/A'}</td>
                                        <td style="padding:5px 8px;border:1px solid #2c3e50;text-align:center;font-size:10px;vertical-align:middle;min-width:70px;">
                                            <span style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:9px;font-weight:700;min-width:30px;background:${cbcGrade.level === 'EE' ? '#d4edda' : cbcGrade.level === 'ME' ? '#d1ecf1' : cbcGrade.level === 'AE' ? '#fff3cd' : '#f8d7da'};color:${cbcGrade.level === 'EE' ? '#155724' : cbcGrade.level === 'ME' ? '#0c5460' : cbcGrade.level === 'AE' ? '#856404' : '#721c24'};border:1px solid ${cbcGrade.level === 'EE' ? '#27ae60' : cbcGrade.level === 'ME' ? '#2ecc71' : cbcGrade.level === 'AE' ? '#f39c12' : '#e74c3c'};font-size:10px;padding:2px 10px;">
                                                ${cbcGrade.code}
                                                <span style="font-size:7px;color:#95a5a6;display:block;margin-top:0px;">${cbcGrade.label}</span>
                                            </span>
                                        </td>
                                        <td style="padding:5px 8px;border:1px solid #2c3e50;text-align:center;font-size:10px;vertical-align:middle;font-weight:700;color:#1a237e;">${cbcGrade.points.toFixed(1)}</td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                        <tfoot>
                            <tr style="background:#f8f9fa;font-weight:700;border-top:2px solid #1a237e;">
                                <td colspan="4" style="padding:5px 8px;border:1px solid #2c3e50;text-align:center;font-size:10px;vertical-align:middle;text-align:right;padding-right:15px;font-size:11px;color:#2c3e50;">
                                    <i class="fas fa-calculator"></i> Totals:
                                </td>
                                <td style="padding:5px 8px;border:1px solid #2c3e50;text-align:center;font-size:10px;vertical-align:middle;font-weight:700;color:#1a237e;font-size:12px;">
                                    ${Math.round(performanceData.reduce((sum, item) => sum + (item.average || 0), 0) / performanceData.filter(p => p.average !== null).length) || 0}
                                </td>
                                <td style="padding:5px 8px;border:1px solid #2c3e50;text-align:center;font-size:10px;vertical-align:middle;font-weight:700;color:#1a237e;font-size:12px;">
                                    ${getCBCGrade(Math.round(performanceData.reduce((sum, item) => sum + (item.average || 0), 0) / performanceData.filter(p => p.average !== null).length)).code}
                                </td>
                                <td style="padding:5px 8px;border:1px solid #2c3e50;text-align:center;font-size:10px;vertical-align:middle;font-weight:700;color:#1a237e;font-size:12px;">
                                    ${getCBCGrade(Math.round(performanceData.reduce((sum, item) => sum + (item.average || 0), 0) / performanceData.filter(p => p.average !== null).length)).points.toFixed(1)}
                                </td>
                            </tr>
                        </tfoot>
                    </table>

                    <!-- Summary -->
                    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:8px 0;padding:6px 10px;background:#f8f9fa;border-radius:4px;">
                        <div style="text-align:center;">
                            <div style="font-size:8px;color:#95a5a6;text-transform:uppercase;letter-spacing:0.3px;">Subjects Offered</div>
                            <div style="font-size:13px;font-weight:700;color:#2c3e50;margin-top:1px;">${totalSubjects}</div>
                        </div>
                        <div style="text-align:center;">
                            <div style="font-size:8px;color:#95a5a6;text-transform:uppercase;letter-spacing:0.3px;">Subjects Assessed</div>
                            <div style="font-size:13px;font-weight:700;color:#2c3e50;margin-top:1px;">${scoredCount}</div>
                        </div>
                        <div style="text-align:center;">
                            <div style="font-size:8px;color:#95a5a6;text-transform:uppercase;letter-spacing:0.3px;">Overall CBC Level</div>
                            <div style="font-size:13px;font-weight:700;color:#2c3e50;margin-top:1px;">
                                <span style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:9px;font-weight:700;min-width:30px;background:${overallCBC.level === 'EE' ? '#d4edda' : overallCBC.level === 'ME' ? '#d1ecf1' : overallCBC.level === 'AE' ? '#fff3cd' : '#f8d7da'};color:${overallCBC.level === 'EE' ? '#155724' : overallCBC.level === 'ME' ? '#0c5460' : overallCBC.level === 'AE' ? '#856404' : '#721c24'};border:1px solid ${overallCBC.level === 'EE' ? '#27ae60' : overallCBC.level === 'ME' ? '#2ecc71' : overallCBC.level === 'AE' ? '#f39c12' : '#e74c3c'};font-size:12px;">
                                    ${overallCBC.code}
                                </span>
                            </div>
                        </div>
                        <div style="text-align:center;">
                            <div style="font-size:8px;color:#95a5a6;text-transform:uppercase;letter-spacing:0.3px;">Total Points</div>
                            <div style="font-size:13px;font-weight:700;color:#2c3e50;margin-top:1px;">${overallCBC.points.toFixed(1)}</div>
                        </div>
                    </div>

                    <!-- Comments -->
                    <div style="margin:8px 0;padding:6px 12px;border:1px solid #e0e6ed;border-radius:4px;font-size:10px;">
                        <div style="font-weight:600;color:#2c3e50;margin-bottom:2px;font-size:10px;">Teacher's Comments</div>
                        <div style="color:#2c3e50;line-height:1.4;font-size:10px;">${comment}</div>
                    </div>

                    <div style="text-align:center;font-size:10px;color:#2c3e50;margin:6px 0;padding:4px 8px;background:#e8f0fe;border-radius:4px;">
                        <strong>Current Term End:</strong> ${displayEnd.toLocaleDateString()} &nbsp;|&nbsp; 
                        <strong>Next Term Start:</strong> ${displayStart.toLocaleDateString()}
                    </div>

                    <!-- Footer -->
                    <div style="margin-top:10px;padding-top:10px;border-top:1px solid #e0e6ed;display:grid;grid-template-columns:1fr 1fr;gap:15px;">
                        <div style="text-align:center;">
                            <div style="width:120px;border-bottom:1px solid #2c3e50;margin:15px auto 3px;"></div>
                            <div style="font-size:8px;color:#95a5a6;">Head-Teacher/Principal Signature</div>
                        </div>
                        <div style="text-align:center;">
                            <div style="width:120px;border-bottom:1px solid #2c3e50;margin:15px auto 3px;"></div>
                            <div style="font-size:8px;color:#95a5a6;">Class Teacher Signature</div>
                        </div>
                    </div>

                    <div style="text-align:center;font-size:8px;color:#95a5a6;margin-top:8px;padding-top:5px;border-top:1px solid #e0e6ed;">
                        &copy; ${new Date().getFullYear()} ${schoolName} - All Rights Reserved
                    </div>
                </div>
            </div>
        `;
    };

    // Download single report PDF
    const downloadReportPDF = async () => {
        const content = document.getElementById('reportContent');
        if (!content) {
            showNotification('Report content not found', 'error');
            return;
        }

        setGenerating(true);

        try {
            const studentName = document.querySelector('.report-student-info .value')?.textContent || 'Student';
            const filename = `cbc_report_${studentName.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0,10)}.pdf`;

            // Use html2pdf if available, otherwise use window.print
            if (window.html2pdf) {
                const opt = {
                    margin: [8, 8, 8, 8],
                    filename: filename,
                    image: { type: 'jpeg', quality: 0.98 },
                    html2canvas: { 
                        scale: 2, 
                        useCORS: true,
                        logging: false
                    },
                    jsPDF: { 
                        unit: 'mm', 
                        format: 'a4', 
                        orientation: 'portrait' 
                    },
                    pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
                };

                await window.html2pdf().set(opt).from(content).save();
            } else {
                // Fallback to print
                window.print();
            }
            
            showNotification('PDF generated successfully!', 'success');

        } catch (error) {
            console.error('PDF generation error:', error);
            showNotification('Failed to generate PDF', 'error');
        } finally {
            setGenerating(false);
        }
    };

    // Generate all PDFs
    const generateAllPDFs = async () => {
        if (students.length === 0) {
            showNotification('Please load students first', 'warning');
            return;
        }

        setGenerating(true);
        let successCount = 0;
        let failCount = 0;

        try {
            for (const student of students) {
                try {
                    const reportHTML = createReportHTML(student);
                    
                    const tempContainer = document.createElement('div');
                    tempContainer.innerHTML = reportHTML;
                    tempContainer.style.cssText = `
                        position: absolute;
                        left: -9999px;
                        top: 0;
                        width: 900px;
                        padding: 40px;
                        background: white;
                    `;
                    document.body.appendChild(tempContainer);

                    const content = tempContainer.querySelector('.report-container');
                    const filename = `cbc_report_${student.firstName || ''}_${student.lastName || ''}_${new Date().toISOString().slice(0,10)}.pdf`;

                    if (window.html2pdf) {
                        const opt = {
                            margin: [8, 8, 8, 8],
                            filename: filename,
                            image: { type: 'jpeg', quality: 0.98 },
                            html2canvas: { 
                                scale: 2, 
                                useCORS: true,
                                logging: false
                            },
                            jsPDF: { 
                                unit: 'mm', 
                                format: 'a4', 
                                orientation: 'portrait' 
                            }
                        };

                        await window.html2pdf().set(opt).from(content).save();
                    }
                    
                    document.body.removeChild(tempContainer);
                    successCount++;

                } catch (error) {
                    console.error(`Error generating PDF for student ${student.id}:`, error);
                    failCount++;
                }
            }

            if (successCount > 0) {
                showNotification(`${successCount} PDFs generated successfully${failCount > 0 ? `, ${failCount} failed` : ''}`, 
                    failCount === 0 ? 'success' : 'warning');
            } else {
                showNotification('Failed to generate PDFs', 'error');
            }

        } catch (error) {
            console.error('Batch PDF generation error:', error);
            showNotification('Failed to generate PDFs', 'error');
        } finally {
            setGenerating(false);
        }
    };

    // Generate class PDF
    const generateClassPDF = async () => {
        if (students.length === 0) {
            showNotification('Please load students first', 'warning');
            return;
        }

        setGenerating(true);

        try {
            const classContainer = document.createElement('div');
            classContainer.style.cssText = `
                padding: 20px;
                background: white;
                max-width: 900px;
                margin: 0 auto;
            `;

            // Add title page
            classContainer.innerHTML = `
                <div style="text-align:center;padding:60px 20px;page-break-after:always;">
                    <div style="margin-bottom:40px;">
                        <img src="${schoolData?.logoUrl || 'https://via.placeholder.com/80'}" alt="School Logo" style="width:100px;height:100px;border-radius:50%;object-fit:cover;border:3px solid #1a237e;" onerror="this.style.display='none'"/>
                        <h1 style="font-size:32px;color:#1a237e;margin-top:20px;">${schoolData?.name || 'TOPLINK EDU School'}</h1>
                        <p style="font-size:16px;color:#95a5a6;font-style:italic;">"${schoolData?.motto || 'Excellence in Education'}"</p>
                    </div>
                    <h2 style="font-size:28px;color:#2c3e50;">CBC Class Report Cards</h2>
                    <p style="font-size:18px;color:#2c3e50;margin-top:10px;">
                        ${selectedLevel.replace('-', ' ').toUpperCase()} • ${selectedClass} • ${['', 'First Term', 'Second Term', 'Third Term'][parseInt(selectedTerm)]}
                    </p>
                    <p style="font-size:16px;color:#95a5a6;margin-top:20px;">
                        Generated: ${new Date().toLocaleString()}
                    </p>
                    <p style="font-size:14px;color:#95a5a6;margin-top:10px;">
                        Total Students: ${students.length}
                    </p>
                    <div style="margin-top:60px;border-top:1px solid #e0e6ed;padding-top:20px;color:#95a5a6;font-size:14px;">
                        &copy; ${new Date().getFullYear()} ${schoolData?.name || 'TOPLINK EDU School'} - All Rights Reserved
                    </div>
                </div>
            `;

            for (let i = 0; i < students.length; i++) {
                const student = students[i];
                const reportHTML = createReportHTML(student);
                
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = reportHTML;
                const reportContent = tempDiv.querySelector('.report-container');
                
                if (reportContent) {
                    if (i > 0) {
                        const pageBreak = document.createElement('div');
                        pageBreak.style.cssText = 'page-break-after: always;';
                        classContainer.appendChild(pageBreak);
                    }
                    
                    const clonedReport = reportContent.cloneNode(true);
                    clonedReport.style.display = 'block';
                    clonedReport.style.margin = '0 auto';
                    classContainer.appendChild(clonedReport);
                }
            }

            document.body.appendChild(classContainer);

            const filename = `cbc_class_reports_${selectedClass}_${selectedLevel}_${new Date().toISOString().slice(0,10)}.pdf`;

            if (window.html2pdf) {
                const opt = {
                    margin: [8, 8, 8, 8],
                    filename: filename,
                    image: { type: 'jpeg', quality: 0.98 },
                    html2canvas: { 
                        scale: 2, 
                        useCORS: true,
                        logging: false
                    },
                    jsPDF: { 
                        unit: 'mm', 
                        format: 'a4', 
                        orientation: 'portrait' 
                    },
                    pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
                };

                await window.html2pdf().set(opt).from(classContainer).save();
            }
            
            document.body.removeChild(classContainer);
            showNotification(`Class PDF generated successfully with ${students.length} students!`, 'success');

        } catch (error) {
            console.error('Class PDF generation error:', error);
            showNotification('Failed to generate class PDF', 'error');
        } finally {
            setGenerating(false);
        }
    };

    // Download template
    const downloadTemplate = async () => {
        setGenerating(true);

        try {
            const templateContainer = document.createElement('div');
            templateContainer.style.cssText = `
                padding: 20px;
                background: white;
                max-width: 900px;
                margin: 0 auto;
            `;

            const reportHTML = createReportHTML(sampleStudent, true);
            
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = reportHTML;
            const reportContent = tempDiv.querySelector('.report-container');
            
            if (reportContent) {
                const clonedReport = reportContent.cloneNode(true);
                clonedReport.style.display = 'block';
                clonedReport.style.margin = '0 auto';
                templateContainer.appendChild(clonedReport);
            }

            document.body.appendChild(templateContainer);

            const filename = `cbc_report_template_${new Date().toISOString().slice(0,10)}.pdf`;

            if (window.html2pdf) {
                const opt = {
                    margin: [8, 8, 8, 8],
                    filename: filename,
                    image: { type: 'jpeg', quality: 0.98 },
                    html2canvas: { 
                        scale: 2, 
                        useCORS: true,
                        logging: false
                    },
                    jsPDF: { 
                        unit: 'mm', 
                        format: 'a4', 
                        orientation: 'portrait' 
                    },
                    pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
                };

                await window.html2pdf().set(opt).from(templateContainer).save();
            }
            
            document.body.removeChild(templateContainer);
            showNotification('Template PDF generated successfully!', 'success');

        } catch (error) {
            console.error('Template generation error:', error);
            showNotification('Failed to generate template', 'error');
        } finally {
            setGenerating(false);
        }
    };

    // Show notification
    const showNotification = (message, type = 'info') => {
        const colors = {
            success: '#27ae60',
            error: '#e74c3c',
            warning: '#f39c12',
            info: '#3498db'
        };

        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${colors[type] || colors.info};
            color: white;
            padding: 15px 20px;
            border-radius: 8px;
            box-shadow: 0 5px 15px rgba(0,0,0,0.2);
            z-index: 10000;
            animation: slideIn 0.3s ease;
            max-width: 400px;
        `;
        notification.textContent = message;
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => notification.remove(), 300);
        }, 4000);
    };

    // Render students grid
    const renderStudents = () => {
        if (students.length === 0) {
            return (
                <div className="empty-state" style={{gridColumn: '1 / -1', textAlign: 'center', padding: '60px 20px', color: '#95a5a6'}}>
                    <i className="fas fa-users" style={{fontSize: '64px', color: '#e0e6ed', marginBottom: '20px', display: 'block'}}></i>
                    <h3 style={{fontSize: '20px', color: '#2c3e50', marginBottom: '10px'}}>No Students Loaded</h3>
                    <p style={{maxWidth: '400px', margin: '0 auto'}}>Select a level, class, and term, then click "Load Students" to view student report cards.</p>
                </div>
            );
        }

        const sortedStudents = [...students].sort((a, b) => (b.overallAverage || 0) - (a.overallAverage || 0));

        return sortedStudents.map((student) => {
            const avg = student.overallAverage || 0;
            const cbcGrade = getCBCGrade(avg);

            return (
                <div 
                    key={student.id} 
                    className="student-card"
                    style={{
                        background: 'white',
                        borderRadius: '12px',
                        padding: '20px',
                        boxShadow: '0 4px 6px rgba(0,0,0,0.07)',
                        transition: 'all 0.3s',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '15px'
                    }}
                    onClick={() => generateReport(student.id)}
                >
                    <div className="avatar" style={{
                        width: '50px',
                        height: '50px',
                        borderRadius: '50%',
                        background: '#1a237e',
                        color: 'white',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: '600',
                        fontSize: '20px',
                        flexShrink: '0'
                    }}>
                        {student.firstName?.[0] || 'S'}
                    </div>
                    <div className="info" style={{flex: '1'}}>
                        <div className="name" style={{fontWeight: '600', color: '#2c3e50', fontSize: '15px'}}>
                            {student.firstName || ''} {student.lastName || ''}
                        </div>
                        <div className="details" style={{fontSize: '13px', color: '#95a5a6'}}>
                            {student.admissionNumber || student.studentId || 'N/A'} • {student.class || ''}
                        </div>
                        <div className="average" style={{fontSize: '14px', fontWeight: '600', color: '#1a237e'}}>
                            Avg: {avg}% • CBC: {cbcGrade.code} ({cbcGrade.points.toFixed(1)} pts)
                        </div>
                    </div>
                    <div className="actions" style={{display: 'flex', gap: '8px'}}>
                        <button 
                            className="btn btn-primary btn-sm" 
                            style={{
                                padding: '6px 12px',
                                fontSize: '12px',
                                border: 'none',
                                borderRadius: '8px',
                                fontWeight: '600',
                                cursor: 'pointer',
                                transition: 'all 0.3s',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '8px',
                                background: '#1a237e',
                                color: 'white'
                            }}
                            onClick={(e) => {
                                e.stopPropagation();
                                generateReport(student.id);
                            }}
                        >
                            <i className="fas fa-file-alt"></i> Report
                        </button>
                    </div>
                </div>
            );
        });
    };

    if (loading) {
        return <LoadingSpinner fullScreen text="Loading students..." />;
    }

    return (
        <Layout title="Student Report Forms (CBC)">
            {/* Selection Area */}
            <div className="selection-area" style={{
                background: 'white',
                borderRadius: '12px',
                padding: '25px',
                boxShadow: '0 4px 6px rgba(0,0,0,0.07)',
                marginBottom: '25px',
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr auto auto',
                gap: '15px',
                alignItems: 'end'
            }}>
                <div className="form-group" style={{marginBottom: '0'}}>
                    <label style={{display: 'block', fontSize: '13px', fontWeight: '600', color: '#2c3e50', marginBottom: '5px'}}>
                        Select Level <span style={{color: '#e74c3c'}}>*</span>
                    </label>
                    <select 
                        value={selectedLevel} 
                        onChange={handleLevelChange}
                        style={{
                            width: '100%',
                            padding: '10px 15px',
                            border: '2px solid #e0e6ed',
                            borderRadius: '8px',
                            fontSize: '14px',
                            transition: 'all 0.3s',
                            background: 'white'
                        }}
                    >
                        <option value="">Select Level</option>
                        <option value="pre-primary">Pre-Primary</option>
                        <option value="lower-primary">Lower Primary</option>
                        <option value="upper-primary">Upper Primary</option>
                        <option value="junior-school">Junior School</option>
                        <option value="senior-school">Senior School</option>
                    </select>
                </div>
                <div className="form-group" style={{marginBottom: '0'}}>
                    <label style={{display: 'block', fontSize: '13px', fontWeight: '600', color: '#2c3e50', marginBottom: '5px'}}>
                        Select Class <span style={{color: '#e74c3c'}}>*</span>
                    </label>
                    <select 
                        value={selectedClass} 
                        onChange={handleClassChange}
                        style={{
                            width: '100%',
                            padding: '10px 15px',
                            border: '2px solid #e0e6ed',
                            borderRadius: '8px',
                            fontSize: '14px',
                            transition: 'all 0.3s',
                            background: 'white'
                        }}
                    >
                        <option value="">Select Class</option>
                        {(LEVEL_CLASSES[selectedLevel] || []).map(cls => (
                            <option key={cls} value={cls}>{cls}</option>
                        ))}
                    </select>
                </div>
                <div className="form-group" style={{marginBottom: '0'}}>
                    <label style={{display: 'block', fontSize: '13px', fontWeight: '600', color: '#2c3e50', marginBottom: '5px'}}>
                        Select Term <span style={{color: '#e74c3c'}}>*</span>
                    </label>
                    <select 
                        value={selectedTerm} 
                        onChange={handleTermChange}
                        style={{
                            width: '100%',
                            padding: '10px 15px',
                            border: '2px solid #e0e6ed',
                            borderRadius: '8px',
                            fontSize: '14px',
                            transition: 'all 0.3s',
                            background: 'white'
                        }}
                    >
                        <option value="1">Term 1</option>
                        <option value="2">Term 2</option>
                        <option value="3">Term 3</option>
                    </select>
                </div>
                <button 
                    className="btn btn-primary"
                    style={{
                        padding: '10px 20px',
                        border: 'none',
                        borderRadius: '8px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        transition: 'all 0.3s',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px',
                        fontSize: '14px',
                        background: '#1a237e',
                        color: 'white'
                    }}
                    onClick={loadStudents}
                    disabled={loading}
                >
                    <i className="fas fa-users"></i> Load Students
                </button>
                <button 
                    className="btn btn-outline"
                    style={{
                        padding: '10px 20px',
                        border: '2px solid #e0e6ed',
                        borderRadius: '8px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        transition: 'all 0.3s',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px',
                        fontSize: '14px',
                        background: 'transparent',
                        color: '#2c3e50'
                    }}
                    onClick={clearStudents}
                >
                    <i className="fas fa-times"></i> Clear
                </button>
            </div>

            {/* Action Buttons */}
            <div style={{display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap'}}>
                <button 
                    className="btn btn-info"
                    style={{
                        padding: '10px 20px',
                        border: 'none',
                        borderRadius: '8px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        transition: 'all 0.3s',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px',
                        fontSize: '14px',
                        background: '#3498db',
                        color: 'white'
                    }}
                    onClick={downloadTemplate}
                    disabled={generating}
                >
                    <i className="fas fa-file-pdf"></i> Download Template
                </button>
                <button 
                    className="btn btn-success"
                    style={{
                        padding: '10px 20px',
                        border: 'none',
                        borderRadius: '8px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        transition: 'all 0.3s',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px',
                        fontSize: '14px',
                        background: '#27ae60',
                        color: 'white'
                    }}
                    onClick={generateClassPDF}
                    disabled={generating || students.length === 0}
                >
                    <i className="fas fa-file-pdf"></i> Generate Class PDF
                </button>
                <button 
                    className="btn btn-primary"
                    style={{
                        padding: '10px 20px',
                        border: 'none',
                        borderRadius: '8px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        transition: 'all 0.3s',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px',
                        fontSize: '14px',
                        background: '#1a237e',
                        color: 'white'
                    }}
                    onClick={generateAllPDFs}
                    disabled={generating || students.length === 0}
                >
                    <i className="fas fa-file-pdf"></i> Generate All PDFs
                </button>
            </div>

            {/* Students Grid */}
            <div className="students-grid" style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: '20px',
                marginTop: '20px'
            }}>
                {renderStudents()}
            </div>

            {/* Report Modal */}
            {showModal && (
                <div className="modal-overlay active" style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'rgba(0,0,0,0.5)',
                    zIndex: 1000,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '20px'
                }}>
                    <div className="modal" style={{
                        background: 'white',
                        borderRadius: '16px',
                        maxWidth: '950px',
                        width: '100%',
                        maxHeight: '90vh',
                        overflowY: 'auto',
                        padding: '30px'
                    }}>
                        <div className="modal-header" style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: '25px'
                        }}>
                            <h2 style={{fontSize: '22px', color: '#2c3e50'}}>
                                CBC Report Card - {selectedStudent?.firstName || ''} {selectedStudent?.lastName || ''}
                            </h2>
                            <button 
                                className="modal-close"
                                style={{
                                    width: '40px',
                                    height: '40px',
                                    border: 'none',
                                    borderRadius: '50%',
                                    background: '#f8f9fa',
                                    cursor: 'pointer',
                                    fontSize: '18px',
                                    transition: 'all 0.3s'
                                }}
                                onClick={() => setShowModal(false)}
                            >
                                <i className="fas fa-times"></i>
                            </button>
                        </div>
                        <div id="reportModalContent" dangerouslySetInnerHTML={{ __html: reportHTML }} />
                        <div className="modal-footer" style={{
                            display: 'flex',
                            gap: '10px',
                            justifyContent: 'flex-end',
                            marginTop: '25px',
                            paddingTop: '20px',
                            borderTop: '1px solid #e0e6ed'
                        }}>
                            <button 
                                className="btn btn-outline"
                                style={{
                                    padding: '10px 20px',
                                    border: '2px solid #e0e6ed',
                                    borderRadius: '8px',
                                    fontWeight: '600',
                                    cursor: 'pointer',
                                    transition: 'all 0.3s',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    fontSize: '14px',
                                    background: 'transparent',
                                    color: '#2c3e50'
                                }}
                                onClick={() => setShowModal(false)}
                            >
                                Close
                            </button>
                            <button 
                                className="btn btn-success"
                                style={{
                                    padding: '10px 20px',
                                    border: 'none',
                                    borderRadius: '8px',
                                    fontWeight: '600',
                                    cursor: 'pointer',
                                    transition: 'all 0.3s',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    fontSize: '14px',
                                    background: '#27ae60',
                                    color: 'white'
                                }}
                                onClick={downloadReportPDF}
                                disabled={generating}
                            >
                                <i className="fas fa-file-pdf"></i> Download PDF
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Loading overlay for PDF generation */}
            {generating && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'rgba(255,255,255,0.8)',
                    zIndex: 9999,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexDirection: 'column',
                    gap: '20px'
                }}>
                    <div style={{
                        width: '50px',
                        height: '50px',
                        border: '3px solid #e0e6ed',
                        borderTopColor: '#1a237e',
                        borderRadius: '50%',
                        animation: 'spin 1s linear infinite'
                    }}></div>
                    <div style={{color: '#2c3e50', fontWeight: '500', fontSize: '16px'}}>
                        Generating PDFs...
                    </div>
                </div>
            )}

            {/* Add animation styles */}
            <style>{`
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
                @keyframes slideIn {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
                @keyframes slideOut {
                    from { transform: translateX(0); opacity: 1; }
                    to { transform: translateX(100%); opacity: 0; }
                }
                .student-card:hover {
                    transform: translateY(-3px);
                    box-shadow: 0 10px 25px rgba(0,0,0,0.1) !important;
                    border-color: #1a237e;
                }
                .btn:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 10px 25px rgba(0,0,0,0.1);
                }
                .btn-primary:hover {
                    background: #283593 !important;
                }
                .btn-success:hover {
                    opacity: 0.9;
                }
                .btn-info:hover {
                    opacity: 0.9;
                }
                .btn-outline:hover {
                    border-color: #1a237e;
                    color: #1a237e;
                }
                .modal-close:hover {
                    background: #e0e6ed;
                }
                select:focus, input:focus {
                    outline: none;
                    border-color: #1a237e !important;
                }
                @media print {
                    .no-print {
                        display: none !important;
                    }
                    body {
                        background: white !important;
                        padding: 0 !important;
                        margin: 0 !important;
                    }
                    .content {
                        padding: 0 !important;
                        max-width: 100% !important;
                    }
                    .students-grid {
                        display: none !important;
                    }
                    .selection-area {
                        display: none !important;
                    }
                    .report-container {
                        display: block !important;
                        page-break-after: always;
                    }
                }
                @media (max-width: 768px) {
                    .selection-area {
                        grid-template-columns: 1fr !important;
                    }
                    .students-grid {
                        grid-template-columns: 1fr !important;
                    }
                    .modal {
                        max-width: 100% !important;
                        margin: 10px !important;
                        padding: 15px !important;
                    }
                }
            `}</style>
        </Layout>
    );
}
