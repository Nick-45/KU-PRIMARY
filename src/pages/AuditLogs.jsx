// src/pages/AuditLogs.jsx
import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase';
import { collection, query, where, getDocs, orderBy, limit, addDoc, serverTimestamp } from 'firebase/firestore';
import Layout from '../components/Layout/Layout';
import LoadingSpinner from '../components/Common/LoadingSpinner';

export default function AuditLogs() {
    const { userData, userRole } = useAuth();
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [actionFilter, setActionFilter] = useState('');

    const isAdmin = userRole === 'admin' || userRole === 'user' || userRole === 'school_admin';

    useEffect(() => {
        if (userData?.schoolId && isAdmin) {
            loadAuditLogs();
        } else {
            setLoading(false);
        }
    }, [userData, isAdmin]);

    const loadAuditLogs = async () => {
        try {
            setLoading(true);
            const q = query(
                collection(db, 'audit_logs'),
                where('schoolId', '==', userData.schoolId),
                orderBy('timestamp', 'desc'),
                limit(100)
            );
            const snap = await getDocs(q);
            const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setLogs(list);
        } catch (err) {
            console.error('Error loading audit logs:', err);
            // Fallback if index missing or empty
            try {
                const fallbackQ = query(
                    collection(db, 'audit_logs'),
                    where('schoolId', '==', userData.schoolId),
                    limit(100)
                );
                const fallbackSnap = await getDocs(fallbackQ);
                const list = fallbackSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                list.sort((a, b) => {
                    const tA = a.timestamp?.toMillis ? a.timestamp.toMillis() : new Date(a.timestamp || 0).getTime();
                    const tB = b.timestamp?.toMillis ? b.timestamp.toMillis() : new Date(b.timestamp || 0).getTime();
                    return tB - tA;
                });
                setLogs(list);
            } catch (e) {
                console.error('Fallback audit logs error:', e);
                setLogs([]);
            }
        } finally {
            setLoading(false);
        }
    };

    const filteredLogs = logs.filter(log => {
        const matchesSearch = 
            (log.userName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
            (log.action || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
            (log.details || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
            (log.userEmail || '').toLowerCase().includes(searchTerm.toLowerCase());
        const matchesAction = !actionFilter || log.action === actionFilter;
        return matchesSearch && matchesAction;
    });

    const uniqueActions = [...new Set(logs.map(l => l.action).filter(Boolean))];

    if (!isAdmin) {
        return (
            <Layout>
                <div style={{ padding: '40px', textAlign: 'center' }}>
                    <h2>Access Denied</h2>
                    <p style={{ color: '#64748b' }}>Audit logs are only accessible to administrators.</p>
                </div>
            </Layout>
        );
    }

    if (loading) {
        return (
            <Layout>
                <LoadingSpinner fullScreen text="Loading audit logs..." />
            </Layout>
        );
    }

    return (
        <Layout>
            <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
                    <div>
                        <h1 style={{ fontSize: '24px', fontWeight: '700', color: '#1a237e', margin: '0 0 4px 0' }}>
                            System Audit Logs
                        </h1>
                        <p style={{ fontSize: '14px', color: '#64748b', margin: 0 }}>
                            Track user activities, security events, and administrative actions across the platform.
                        </p>
                    </div>
                    <button
                        onClick={loadAuditLogs}
                        style={{
                            background: '#1a237e',
                            color: '#fff',
                            border: 'none',
                            padding: '10px 18px',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            fontWeight: '600',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px'
                        }}
                    >
                        <i className="fas fa-sync-alt"></i> Refresh Logs
                    </button>
                </div>

                {/* Filters */}
                <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: '240px', position: 'relative' }}>
                        <i className="fas fa-search" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}></i>
                        <input
                            type="text"
                            placeholder="Search by user, action, or details..."
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
                    <select
                        value={actionFilter}
                        onChange={(e) => setActionFilter(e.target.value)}
                        style={{
                            padding: '10px 14px',
                            border: '1px solid #cbd5e1',
                            borderRadius: '8px',
                            fontSize: '14px',
                            outline: 'none',
                            background: '#fff',
                            minWidth: '180px'
                        }}
                    >
                        <option value="">All Actions</option>
                        {uniqueActions.map(act => (
                            <option key={act} value={act}>{act}</option>
                        ))}
                    </select>
                </div>

                {/* Table */}
                <div style={{ background: '#fff', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', overflow: 'hidden', border: '1px solid #e2e8f0' }}>
                    {filteredLogs.length === 0 ? (
                        <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
                            <i className="fas fa-clipboard-list" style={{ fontSize: '40px', color: '#cbd5e1', marginBottom: '12px' }}></i>
                            <p style={{ fontSize: '15px', fontWeight: '600', margin: '0 0 4px' }}>No audit logs found</p>
                            <p style={{ fontSize: '13px', margin: 0 }}>Activities will be recorded as actions are performed in the system.</p>
                        </div>
                    ) : (
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                                <thead>
                                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #cbd5e1', color: '#475569', fontWeight: '600' }}>
                                        <th style={{ padding: '12px 16px' }}>Timestamp</th>
                                        <th style={{ padding: '12px 16px' }}>User</th>
                                        <th style={{ padding: '12px 16px' }}>Role</th>
                                        <th style={{ padding: '12px 16px' }}>Action</th>
                                        <th style={{ padding: '12px 16px' }}>Details</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredLogs.map((log, idx) => {
                                        const ts = log.timestamp?.toDate ? log.timestamp.toDate().toLocaleString() : (log.timestamp ? new Date(log.timestamp).toLocaleString() : 'Just now');
                                        return (
                                            <tr key={log.id || idx} style={{ borderBottom: '1px solid #e2e8f0', background: idx % 2 === 0 ? '#fff' : '#fafafa' }}>
                                                <td style={{ padding: '12px 16px', color: '#64748b', whiteSpace: 'nowrap' }}>{ts}</td>
                                                <td style={{ padding: '12px 16px', fontWeight: '600', color: '#1e293b' }}>
                                                    {log.userName || 'System User'}
                                                    <div style={{ fontSize: '11px', fontWeight: 'normal', color: '#64748b' }}>{log.userEmail || ''}</div>
                                                </td>
                                                <td style={{ padding: '12px 16px' }}>
                                                    <span style={{ background: '#e0e7ff', color: '#3730a3', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>
                                                        {log.userRole || 'Admin'}
                                                    </span>
                                                </td>
                                                <td style={{ padding: '12px 16px', fontWeight: '600', color: '#1a237e' }}>{log.action}</td>
                                                <td style={{ padding: '12px 16px', color: '#334155', maxWidth: '400px', wordBreak: 'break-word' }}>{log.details || '-'}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </Layout>
    );
}

export async function logAuditAction(schoolId, user, action, details) {
    try {
        await addDoc(collection(db, 'audit_logs'), {
            schoolId: schoolId || 'global',
            userId: user?.uid || 'system',
            userName: user?.fullName || user?.firstName || user?.email || 'System',
            userEmail: user?.email || '',
            userRole: user?.role || 'admin',
            action,
            details,
            timestamp: serverTimestamp()
        });
    } catch (e) {
        console.error('Failed to log audit action:', e);
    }
}
