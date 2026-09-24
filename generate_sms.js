const fs = require('fs');

const content = `import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase';
import { collection, query, where, getDocs, addDoc, serverTimestamp, orderBy, limit } from 'firebase/firestore';
import Layout from '../components/Layout/Layout';
import LoadingSpinner from '../components/Common/LoadingSpinner';

export default function BulkSMS() {
    const { currentUser, userData } = useAuth();

    // Data State
    const [students, setStudents] = useState([]);
    const [feeBalances, setFeeBalances] = useState({});
    const [loading, setLoading] = useState(true);
    const [history, setHistory] = useState([]);
    
    // SMS State
    const [messageTemplate, setMessageTemplate] = useState('');
    const [simSlot, setSimSlot] = useState('SIM 1');
    const [sending, setSending] = useState(false);
    const [messageNotification, setMessageNotification] = useState({ text: '', type: '' });
    const [showHistoryModal, setShowHistoryModal] = useState(false);
    
    // Filters
    const [searchTerm, setSearchTerm] = useState('');
    const [levelFilter, setLevelFilter] = useState('');
    const [classFilter, setClassFilter] = useState('');
    const [balanceFilter, setBalanceFilter] = useState(''); // 'all', 'with_balance'
    
    // Selection
    const [selectedStudentIds, setSelectedStudentIds] = useState(new Set());
    
    useEffect(() => {
        const loadData = async () => {
            setLoading(true);
            try {
                const schoolId = userData?.schoolId || 'default_school';
                
                // Fetch Students
                const stuQuery = query(collection(db, 'students'), where('schoolId', '==', schoolId));
                const stuSnap = await getDocs(stuQuery);
                const loadedStudents = [];
                stuSnap.forEach(doc => {
                    const data = doc.data();
                    if (data.status !== 'archived') {
                        loadedStudents.push({ id: doc.id, ...data });
                    }
                });
                setStudents(loadedStudents);
                
                // Fetch Fee Balances to help filtering
                const balQuery = query(collection(db, 'feeBalances'), where('schoolId', '==', schoolId));
                const balSnap = await getDocs(balQuery);
                const loadedBalances = {};
                balSnap.forEach(doc => {
                    loadedBalances[doc.data().studentId] = doc.data();
                });
                setFeeBalances(loadedBalances);
                
                // Fetch History
                loadHistory(schoolId);
                
            } catch (err) {
                console.error("Error loading sms data", err);
            } finally {
                setLoading(false);
            }
        };
        loadData();
    }, [userData]);
    
    const loadHistory = async (schoolId) => {
        try {
            const histQuery = query(collection(db, 'sms_queue'), where('schoolId', '==', schoolId), orderBy('createdAt', 'desc'), limit(15));
            const histSnap = await getDocs(histQuery);
            const loadedHistory = [];
            histSnap.forEach(doc => {
                loadedHistory.push({ id: doc.id, ...doc.data() });
            });
            setHistory(loadedHistory);
        } catch(err) {
            console.error("Failed to load history", err);
        }
    };
    
    const showNotification = (text, type = 'info') => {
        setMessageNotification({ text, type });
        setTimeout(() => setMessageNotification({ text: '', type: '' }), 4000);
    };

    // Computed filtered students
    const filteredStudents = useMemo(() => {
        return students.filter(s => {
            const name = \`\${s.firstName} \${s.lastName}\`.toLowerCase();
            const term = searchTerm.toLowerCase();
            const searchMatch = name.includes(term) || (s.admissionNumber || '').toLowerCase().includes(term);
            const levelMatch = levelFilter ? s.level === levelFilter : true;
            const classMatch = classFilter ? s.class === classFilter : true;
            
            let balanceMatch = true;
            if (balanceFilter === 'with_balance') {
                const bal = feeBalances[s.id]?.balance || 0;
                balanceMatch = bal > 0;
            }
            
            return searchMatch && levelMatch && classMatch && balanceMatch;
        });
    }, [students, searchTerm, levelFilter, classFilter, balanceFilter, feeBalances]);

    // Derived unique levels & classes
    const uniqueLevels = useMemo(() => [...new Set(students.map(s => s.level).filter(Boolean))], [students]);
    const uniqueClasses = useMemo(() => [...new Set(students.map(s => s.class).filter(Boolean))], [students]);

    // Handle Checkboxes
    const handleSelectAll = (e) => {
        if (e.target.checked) {
            setSelectedStudentIds(new Set(filteredStudents.map(s => s.id)));
        } else {
            setSelectedStudentIds(new Set());
        }
    };

    const handleSelectOne = (id) => {
        const newSet = new Set(selectedStudentIds);
        if (newSet.has(id)) {
            newSet.delete(id);
        } else {
            newSet.add(id);
        }
        setSelectedStudentIds(newSet);
    };

    // Insert Tag
    const insertTag = (tag) => {
        setMessageTemplate(prev => prev + tag);
    };
    
    const parseTemplate = (template, student) => {
        let msg = template;
        msg = msg.replace(/\\[Student Name\\]/gi, \`\${student.firstName} \${student.lastName}\`);
        msg = msg.replace(/\\[Admission Number\\]/gi, student.admissionNumber || 'N/A');
        msg = msg.replace(/\\[Parent Name\\]/gi, student.parentName || 'Parent');
        const bal = feeBalances[student.id]?.balance || 0;
        msg = msg.replace(/\\[Fee Balance\\]/gi, bal.toString());
        return msg;
    };

    const handleSend = async () => {
        if (selectedStudentIds.size === 0) {
            showNotification('Please select at least one student', 'error');
            return;
        }
        if (!messageTemplate.trim()) {
            showNotification('Please enter a message template', 'error');
            return;
        }

        setSending(true);
        try {
            const schoolId = userData?.schoolId || 'default_school';
            
            // Build individual messages
            const messages = [];
            filteredStudents.forEach(s => {
                if (selectedStudentIds.has(s.id) && s.phoneNumber) {
                    messages.push({
                        studentId: s.id,
                        phone: s.phoneNumber,
                        text: parseTemplate(messageTemplate, s),
                        status: 'pending'
                    });
                }
            });
            
            if (messages.length === 0) {
                showNotification('None of the selected students have a phone number.', 'warning');
                setSending(false);
                return;
            }

            // Create batch in sms_queue
            await addDoc(collection(db, 'sms_queue'), {
                schoolId,
                simSlot: simSlot,
                status: 'pending',
                totalMessages: messages.length,
                messages: messages, // Using an array for the APK to process
                createdAt: serverTimestamp(),
                sentBy: currentUser?.uid,
                sentByName: userData?.fullName || userData?.firstName || 'System',
                template: messageTemplate
            });

            showNotification(\`Queued \${messages.length} messages for sending!\`, 'success');
            setMessageTemplate('');
            setSelectedStudentIds(new Set());
            loadHistory(schoolId);
        } catch (err) {
            console.error("Failed to send sms", err);
            showNotification('Failed to send SMS: ' + err.message, 'error');
        } finally {
            setSending(false);
        }
    };

    if (loading) {
        return <Layout><LoadingSpinner fullScreen text="Loading Communication Module..." /></Layout>;
    }

    return (
        <Layout>
            <div className="module-header">
                <div>
                    <h1>Bulk SMS & Communication</h1>
                    <p>Send personalized messages to parents/guardians using your local Android APK.</p>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <button className="btn btn-outline" onClick={() => setShowHistoryModal(true)}>
                        <i className="fas fa-history"></i> Queue History
                    </button>
                </div>
            </div>
            
            {messageNotification.text && (
                <div className={\`alert alert-\${messageNotification.type}\`} style={{ marginBottom: '20px', padding: '15px', borderRadius: '8px', background: messageNotification.type === 'error' ? '#ffebee' : '#e8f5e9', color: messageNotification.type === 'error' ? '#c62828' : '#2e7d32' }}>
                    {messageNotification.text}
                </div>
            )}

            <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '20px' }}>
                <div className="card">
                    <h2 style={{ marginBottom: '15px', borderBottom: '1px solid #eee', paddingBottom: '10px' }}>Compose Message</h2>
                    
                    <div style={{ marginBottom: '15px' }}>
                        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>Select SIM for Sending</label>
                        <select className="form-control" value={simSlot} onChange={(e) => setSimSlot(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #ddd' }}>
                            <option value="SIM 1">SIM 1</option>
                            <option value="SIM 2">SIM 2</option>
                        </select>
                    </div>

                    <div style={{ marginBottom: '15px' }}>
                        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>Message Template</label>
                        <textarea 
                            className="form-control"
                            rows="6"
                            placeholder="Type your message here..."
                            value={messageTemplate}
                            onChange={(e) => setMessageTemplate(e.target.value)}
                            style={{ width: '100%', padding: '12px', borderRadius: '6px', border: '1px solid #ddd', resize: 'vertical' }}
                        ></textarea>
                        
                        <div style={{ marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '12px', color: '#666', marginRight: '10px', alignSelf: 'center' }}>Insert Tag:</span>
                            <button className="btn btn-sm btn-outline" onClick={() => insertTag('[Student Name]')}>[Student Name]</button>
                            <button className="btn btn-sm btn-outline" onClick={() => insertTag('[Admission Number]')}>[Admission Number]</button>
                            <button className="btn btn-sm btn-outline" onClick={() => insertTag('[Parent Name]')}>[Parent Name]</button>
                            <button className="btn btn-sm btn-outline" onClick={() => insertTag('[Fee Balance]')}>[Fee Balance]</button>
                        </div>
                    </div>

                    <div style={{ padding: '15px', background: '#f5f7fa', borderRadius: '6px', marginBottom: '20px' }}>
                        <strong>Preview (first selected student):</strong>
                        <p style={{ marginTop: '8px', color: '#444' }}>
                            {selectedStudentIds.size > 0 ? 
                                parseTemplate(messageTemplate, students.find(s => selectedStudentIds.has(s.id))) 
                                : 'Select a student to preview.'
                            }
                        </p>
                    </div>

                    <button 
                        className="btn btn-primary" 
                        onClick={handleSend} 
                        disabled={sending || selectedStudentIds.size === 0}
                        style={{ width: '100%', padding: '12px', fontSize: '16px' }}
                    >
                        {sending ? 'Queuing Messages...' : \`Send \${selectedStudentIds.size} Messages\`}
                    </button>
                </div>

                <div className="card">
                    <h2 style={{ marginBottom: '15px', borderBottom: '1px solid #eee', paddingBottom: '10px' }}>Recipients</h2>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
                        <input 
                            type="text" 
                            className="form-control" 
                            placeholder="Search..." 
                            value={searchTerm} 
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                        <select className="form-control" value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)}>
                            <option value="">All Levels</option>
                            {uniqueLevels.map(l => <option key={l} value={l}>{l.toUpperCase()}</option>)}
                        </select>
                        <select className="form-control" value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
                            <option value="">All Classes</option>
                            {uniqueClasses.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <select className="form-control" value={balanceFilter} onChange={(e) => setBalanceFilter(e.target.value)}>
                            <option value="">All Fee Statuses</option>
                            <option value="with_balance">Has Fee Balance > 0</option>
                        </select>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px', alignItems: 'center' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                            <input 
                                type="checkbox" 
                                checked={filteredStudents.length > 0 && selectedStudentIds.size === filteredStudents.length}
                                onChange={handleSelectAll}
                            />
                            <strong>Select All ({filteredStudents.length})</strong>
                        </label>
                    </div>

                    <div style={{ border: '1px solid #eee', borderRadius: '6px', maxHeight: '400px', overflowY: 'auto' }}>
                        {filteredStudents.length === 0 ? (
                            <div style={{ padding: '20px', textAlign: 'center', color: '#888' }}>No students match filters.</div>
                        ) : (
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <tbody>
                                    {filteredStudents.map(student => (
                                        <tr key={student.id} style={{ borderBottom: '1px solid #f5f5f5' }}>
                                            <td style={{ padding: '10px', width: '30px' }}>
                                                <input 
                                                    type="checkbox" 
                                                    checked={selectedStudentIds.has(student.id)}
                                                    onChange={() => handleSelectOne(student.id)}
                                                />
                                            </td>
                                            <td style={{ padding: '10px' }}>
                                                <div style={{ fontWeight: '500' }}>{student.firstName} {student.lastName}</div>
                                                <div style={{ fontSize: '12px', color: '#666' }}>
                                                    {student.phoneNumber || 'No phone'} | Bal: KES {feeBalances[student.id]?.balance || 0}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            </div>

            {showHistoryModal && (
                <div className="modal-overlay active" onClick={(e) => e.target === e.currentTarget && setShowHistoryModal(false)}>
                    <div className="modal" style={{ maxWidth: '800px', width: '90%' }}>
                        <div className="modal-header">
                            <h2>Message Queue History</h2>
                            <button className="modal-close" onClick={() => setShowHistoryModal(false)}><i className="fas fa-times"></i></button>
                        </div>
                        <div style={{ padding: '20px', maxHeight: '60vh', overflowY: 'auto' }}>
                            {history.length === 0 ? (
                                <p style={{ color: '#888', textAlign: 'center' }}>No history found.</p>
                            ) : (
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Date</th>
                                            <th>Template Used</th>
                                            <th>Total Msgs</th>
                                            <th>SIM</th>
                                            <th>Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {history.map(h => (
                                            <tr key={h.id}>
                                                <td>{h.createdAt ? new Date(h.createdAt.seconds * 1000).toLocaleString() : 'Just now'}</td>
                                                <td><div style={{ maxWidth: '250px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.template}</div></td>
                                                <td>{h.totalMessages}</td>
                                                <td>{h.simSlot || 'Default'}</td>
                                                <td>
                                                    <span className={\`status-badge \${h.status === 'completed' ? 'paid' : (h.status === 'processing' ? 'partial' : 'unpaid')}\`}>
                                                        {h.status?.toUpperCase() || 'PENDING'}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </Layout>
    );
}
`;

fs.writeFileSync('src/pages/BulkSMS.jsx', content);
console.log("Written new BulkSMS.jsx");
