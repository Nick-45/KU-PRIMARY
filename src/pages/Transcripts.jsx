// src/pages/Transcripts.jsx
import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import Layout from '../components/Layout/Layout';
import LoadingSpinner from '../components/Common/LoadingSpinner';
import { getYearOptions } from '../utils/constants';

export default function Transcripts() {
    const { userData, userRole } = useAuth();
    const [archivedStudents, setArchivedStudents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedYear, setSelectedYear] = useState(String(new Date().getFullYear()));
    const [selectedStudent, setSelectedStudent] = useState(null);

    const isAdmin = userRole === 'admin' || userRole === 'user' || userRole === 'school_admin';
    const yearOptions = getYearOptions();

    useEffect(() => {
        if (userData?.schoolId && isAdmin) {
            loadArchivedStudents();
        } else {
            setLoading(false);
        }
    }, [userData, isAdmin, selectedYear]);

    const loadArchivedStudents = async () => {
        try {
            setLoading(true);
            const q = query(
                collection(db, 'archived_students'),
                where('schoolId', '==', userData.schoolId)
            );
            const snap = await getDocs(q);
            let list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            // Filter by year if selected
            if (selectedYear) {
                list = list.filter(item => String(item.academicYear || item.year || '') === String(selectedYear));
            }

            setArchivedStudents(list);
        } catch (err) {
            console.error('Error loading archived students:', err);
            setArchivedStudents([]);
        } finally {
            setLoading(false);
        }
    };

    const filteredStudents = archivedStudents.filter(s => {
        const queryStr = searchTerm.toLowerCase();
        const fullName = `${s.firstName || ''} ${s.lastName || ''}`.toLowerCase();
        const admNo = String(s.admissionNumber || s.studentId || '').toLowerCase();
        return fullName.includes(queryStr) || admNo.includes(queryStr);
    });

    if (!isAdmin) {
        return (
            <Layout>
                <div style={{ padding: '40px', textAlign: 'center' }}>
                    <h2>Access Denied</h2>
                    <p style={{ color: '#64748b' }}>Student transcripts and archives are only accessible to administrators.</p>
                </div>
            </Layout>
        );
    }

    if (loading) {
        return (
            <Layout>
                <LoadingSpinner fullScreen text="Loading student archives & transcripts..." />
            </Layout>
        );
    }

    return (
        <Layout>
            <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
                    <div>
                        <h1 style={{ fontSize: '24px', fontWeight: '700', color: '#1a237e', margin: '0 0 4px 0' }}>
                            Student Transcripts & Archives
                        </h1>
                        <p style={{ fontSize: '14px', color: '#64748b', margin: 0 }}>
                            Access archived student academic records, promotions, and historical transcripts by academic year.
                        </p>
                    </div>
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                        <label style={{ fontSize: '13px', fontWeight: '600', color: '#334155' }}>Academic Year:</label>
                        <select
                            value={selectedYear}
                            onChange={(e) => setSelectedYear(e.target.value)}
                            style={{
                                padding: '8px 12px',
                                border: '1px solid #cbd5e1',
                                borderRadius: '8px',
                                fontSize: '14px',
                                background: '#fff',
                                fontWeight: '600',
                                color: '#1a237e'
                            }}
                        >
                            {yearOptions.map(y => (
                                <option key={y} value={y}>{y}</option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* Search & Overview */}
                <div style={{ marginBottom: '20px' }}>
                    <div style={{ position: 'relative', maxWidth: '400px' }}>
                        <i className="fas fa-search" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}></i>
                        <input
                            type="text"
                            placeholder="Search by student name or admission number..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            style={{
                                width: '100%',
                                padding: '10px 12px 10px 38px',
                                border: '1px solid #cbd5e1',
                                borderRadius: '8px',
                                fontSize: '14px',
                                outline: 'none',
                                boxSizing: 'border-box'
                            }}
                        />
                    </div>
                </div>

                {/* Grid / List of Archived Students */}
                <div style={{ display: 'grid', gridTemplateColumns: selectedStudent ? '1fr 1fr' : '1fr', gap: '24px' }}>
                    <div style={{ background: '#fff', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', overflow: 'hidden', border: '1px solid #e2e8f0' }}>
                        <div style={{ padding: '16px 20px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontWeight: '600', color: '#1e293b' }}>
                            Archived Students ({filteredStudents.length}) - Year {selectedYear}
                        </div>
                        {filteredStudents.length === 0 ? (
                            <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
                                <i className="fas fa-archive" style={{ fontSize: '40px', color: '#cbd5e1', marginBottom: '12px' }}></i>
                                <p style={{ fontSize: '15px', fontWeight: '600', margin: '0 0 4px' }}>No archived records found for {selectedYear}</p>
                                <p style={{ fontSize: '13px', margin: 0 }}>Student records are automatically archived upon bulk grade promotion.</p>
                            </div>
                        ) : (
                            <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                                    <thead>
                                        <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #cbd5e1', color: '#475569', fontWeight: '600' }}>
                                            <th style={{ padding: '12px 16px' }}>Adm No</th>
                                            <th style={{ padding: '12px 16px' }}>Student Name</th>
                                            <th style={{ padding: '12px 16px' }}>Class / Level</th>
                                            <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredStudents.map((s, idx) => (
                                            <tr key={s.id || idx} style={{ borderBottom: '1px solid #e2e8f0', background: selectedStudent?.id === s.id ? '#f0fdf4' : (idx % 2 === 0 ? '#fff' : '#fafafa') }}>
                                                <td style={{ padding: '12px 16px', fontWeight: '600', color: '#1a237e' }}>{s.admissionNumber || s.studentId || 'N/A'}</td>
                                                <td style={{ padding: '12px 16px', fontWeight: '600', color: '#1e293b' }}>{s.firstName} {s.lastName}</td>
                                                <td style={{ padding: '12px 16px', color: '#64748b' }}>{s.class || s.level || 'N/A'}</td>
                                                <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                                                    <button
                                                        onClick={() => setSelectedStudent(s)}
                                                        style={{
                                                            background: '#1a237e',
                                                            color: '#fff',
                                                            border: 'none',
                                                            padding: '6px 12px',
                                                            borderRadius: '6px',
                                                            cursor: 'pointer',
                                                            fontSize: '12px',
                                                            fontWeight: '600'
                                                        }}
                                                    >
                                                        View Transcript
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    {/* Transcript Detail Panel */}
                    {selectedStudent && (
                        <div style={{ background: '#fff', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', border: '1px solid #e2e8f0', padding: '24px', position: 'relative' }}>
                            <button
                                onClick={() => setSelectedStudent(null)}
                                style={{ position: 'absolute', top: '16px', right: '16px', background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#64748b' }}
                            >
                                <i className="fas fa-times"></i>
                            </button>

                            <div style={{ borderBottom: '2px solid #1a237e', paddingBottom: '12px', marginBottom: '20px' }}>
                                <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#1a237e', margin: '0 0 4px' }}>Official Academic Transcript</h2>
                                <p style={{ fontSize: '12px', color: '#64748b', margin: 0 }}>Academic Year: {selectedStudent.academicYear || selectedYear}</p>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px', fontSize: '13px' }}>
                                <div><strong>Student Name:</strong> {selectedStudent.firstName} {selectedStudent.lastName}</div>
                                <div><strong>Admission Number:</strong> {selectedStudent.admissionNumber || selectedStudent.studentId}</div>
                                <div><strong>Class / Level:</strong> {selectedStudent.class || selectedStudent.level || 'N/A'}</div>
                                <div><strong>Gender:</strong> {selectedStudent.gender || 'N/A'}</div>
                                <div><strong>Status:</strong> <span style={{ textTransform: 'uppercase', fontWeight: '600', color: '#059669' }}>{selectedStudent.status || 'Archived'}</span></div>
                                <div><strong>Archived Date:</strong> {selectedStudent.archivedAt ? new Date(selectedStudent.archivedAt).toLocaleDateString() : 'N/A'}</div>
                            </div>

                            <h3 style={{ fontSize: '14px', fontWeight: '700', color: '#1a237e', marginBottom: '10px' }}>Historical Academic Performance & Records</h3>
                            <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px', minHeight: '150px' }}>
                                {selectedStudent.historicalRecords && selectedStudent.historicalRecords.length > 0 ? (
                                    <ul>
                                        {selectedStudent.historicalRecords.map((rec, i) => (
                                            <li key={i}>{rec.title || rec.term}: {rec.score || rec.grade || 'Completed'}</li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p style={{ color: '#64748b', margin: 0, textAlign: 'center', paddingTop: '40px' }}>
                                        Personal information and promotion history retained. Full historical marks archived successfully for {selectedStudent.academicYear || selectedYear}.
                                    </p>
                                )}
                            </div>

                            <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end' }}>
                                <button
                                    onClick={() => window.print()}
                                    style={{
                                        background: '#0284c7',
                                        color: '#fff',
                                        border: 'none',
                                        padding: '8px 16px',
                                        borderRadius: '6px',
                                        cursor: 'pointer',
                                        fontWeight: '600',
                                        fontSize: '13px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px'
                                    }}
                                >
                                    <i className="fas fa-print"></i> Print Transcript
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </Layout>
    );
}
