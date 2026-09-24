// src/pages/Communication.jsx
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSync } from '../context/SyncContext';
import { db } from '../firebase';
import {
    collection, query, where, getDocs, onSnapshot, doc, getDoc,
    updateDoc, deleteDoc, addDoc, orderBy, serverTimestamp,
    limit, startAfter, runTransaction, writeBatch
} from 'firebase/firestore';
import Layout from '../components/Layout/Layout';
import LoadingSpinner from '../components/Common/LoadingSpinner';

// Constants
const MESSAGE_TYPES = {
    results: 'Results Notification',
    meeting: 'Meeting Invitation',
    fee_reminder: 'Fee Reminder',
    general: 'General Announcement',
    emergency: 'Emergency Alert',
    custom: 'Custom Message'
};

const MESSAGE_PRIORITY = {
    normal: 'Normal',
    high: 'High',
    urgent: 'Urgent'
};

const DELIVERY_STATUS = {
    pending: 'Pending',
    sent: 'Sent',
    delivered: 'Delivered',
    failed: 'Failed'
};

const RECIPIENT_TYPES = {
    all_students: 'All Students',
    all_parents: 'All Parents',
    specific_students: 'Specific Students',
    specific_classes: 'Specific Classes',
    specific_levels: 'Specific Levels',
    individual: 'Individual'
};

export default function Communication() {
    const navigate = useNavigate();
    const { currentUser, userData, userRole } = useAuth();
    const { isOnline, pendingCount, saveToIndexedDB, getFromIndexedDB, addToSyncQueue } = useSync();

    // State
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('compose');
    const [showModal, setShowModal] = useState(false);
    const [modalType, setModalType] = useState('');
    const [selectedMessage, setSelectedMessage] = useState(null);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [deleteItem, setDeleteItem] = useState(null);

    // Data states
    const [students, setStudents] = useState([]);
    const [teachers, setTeachers] = useState([]);
    const [messages, setMessages] = useState([]);
    const [templates, setTemplates] = useState([]);
    const [gatewayStatus, setGatewayStatus] = useState('disconnected');
    const [phoneBalance, setPhoneBalance] = useState(0);
    const [smsCount, setSmsCount] = useState(0);
    const [selectedStudents, setSelectedStudents] = useState([]);
    const [selectedClasses, setSelectedClasses] = useState([]);
    const [selectedLevels, setSelectedLevels] = useState([]);
    const [sending, setSending] = useState(false);
    const [progress, setProgress] = useState({ current: 0, total: 0 });

    // Filter states
    const [searchTerm, setSearchTerm] = useState('');
    const [filterType, setFilterType] = useState('');
    const [filterStatus, setFilterStatus] = useState('');
    const [filterDate, setFilterDate] = useState('');

    // Form states
    const [messageForm, setMessageForm] = useState({
        type: 'general',
        priority: 'normal',
        recipientType: 'all_parents',
        subject: '',
        message: '',
        scheduledDate: '',
        scheduledTime: '',
        attachResults: false,
        attachFeeStatement: false,
        selectedClass: '',
        selectedLevel: '',
        studentIds: [],
        parentNumbers: [],
        customNumbers: ''
    });

    const [templateForm, setTemplateForm] = useState({
        name: '',
        type: 'general',
        subject: '',
        message: '',
        variable1: '',
        variable2: '',
        variable3: ''
    });

    const [gatewayForm, setGatewayForm] = useState({
        apiUrl: '',
        apiKey: '',
        deviceId: '',
        phoneNumber: '',
        defaultSender: '',
        enabled: true
    });

    // Stats
    const [stats, setStats] = useState({
        totalSent: 0,
        totalDelivered: 0,
        totalFailed: 0,
        pendingMessages: 0,
        sentToday: 0
    });

    // Refs
    const unsubscribeRef = useRef(null);
    const fileInputRef = useRef(null);

    // Load data on mount
    useEffect(() => {
        if (currentUser && userData) {
            loadData();
            loadGatewayStatus();
        }
        return () => {
            if (unsubscribeRef.current) {
                unsubscribeRef.current();
            }
        };
    }, [currentUser, userData, isOnline]);

    // Role-based access
    const isAdmin = userRole === 'admin' || userRole === 'user';
    const isSuperAdmin = userRole === 'super-admin';
    const isTeacher = userRole === 'teacher';
    const isStudent = userRole === 'student';

    const loadData = async () => {
        setLoading(true);
        try {
            const schoolId = userData?.schoolId || 'default_school';

            const [
                studentsData,
                teachersData,
                messagesData,
                templatesData
            ] = await Promise.all([
                loadCollection('students', schoolId),
                loadCollection('teachers', schoolId),
                loadCollection('communications', schoolId),
                loadCollection('message_templates', schoolId)
            ]);

            setStudents(studentsData);
            setTeachers(teachersData);
            setMessages(messagesData);
            setTemplates(templatesData);

            calculateStats(messagesData);
            setLoading(false);

            if (isOnline) {
                setupRealtimeListeners(schoolId);
            }

        } catch (error) {
            console.error('Error loading communication data:', error);
            showNotification('Failed to load data', 'error');
            setLoading(false);
        }
    };

    const loadCollection = async (collectionName, schoolId) => {
        try {
            const cached = await getFromIndexedDB(`comm_${collectionName}`);
            if (cached && cached.length > 0) {
                return cached;
            }

            if (isOnline) {
                const q = query(
                    collection(db, collectionName),
                    where('schoolId', '==', schoolId),
                    orderBy('createdAt', 'desc')
                );
                const snapshot = await getDocs(q);
                const data = [];
                snapshot.forEach(doc => {
                    data.push({ id: doc.id, ...doc.data() });
                });
                await saveToIndexedDB(`comm_${collectionName}`, data);
                return data;
            }

            return [];
        } catch (error) {
            console.error(`Error loading ${collectionName}:`, error);
            return [];
        }
    };

    const setupRealtimeListeners = (schoolId) => {
        const collections = ['communications', 'message_templates'];
        collections.forEach(collectionName => {
            const q = query(
                collection(db, collectionName),
                where('schoolId', '==', schoolId),
                orderBy('createdAt', 'desc')
            );

            const unsubscribe = onSnapshot(q, async (snapshot) => {
                const data = [];
                snapshot.forEach(doc => {
                    data.push({ id: doc.id, ...doc.data() });
                });

                if (collectionName === 'communications') {
                    setMessages(data);
                    calculateStats(data);
                } else if (collectionName === 'message_templates') {
                    setTemplates(data);
                }

                await saveToIndexedDB(`comm_${collectionName}`, data);
            }, (error) => {
                console.error(`Listener error for ${collectionName}:`, error);
            });

            if (!unsubscribeRef.current) {
                unsubscribeRef.current = unsubscribe;
            }
        });
    };

    const loadGatewayStatus = async () => {
        try {
            const schoolId = userData?.schoolId || 'default_school';
            const gatewayDoc = await getDoc(doc(db, 'sms_gateway', schoolId));
            if (gatewayDoc.exists()) {
                const data = gatewayDoc.data();
                setGatewayStatus(data.status || 'disconnected');
                setPhoneBalance(data.balance || 0);
                setGatewayForm({
                    apiUrl: data.apiUrl || '',
                    apiKey: data.apiKey || '',
                    deviceId: data.deviceId || '',
                    phoneNumber: data.phoneNumber || '',
                    defaultSender: data.defaultSender || '',
                    enabled: data.enabled !== false
                });
            }
        } catch (error) {
            console.error('Error loading gateway status:', error);
        }
    };

    const calculateStats = (messagesData) => {
        const totalSent = messagesData.filter(m => m.status === 'sent' || m.status === 'delivered').length;
        const totalDelivered = messagesData.filter(m => m.status === 'delivered').length;
        const totalFailed = messagesData.filter(m => m.status === 'failed').length;
        const pendingMessages = messagesData.filter(m => m.status === 'pending').length;

        const today = new Date().toISOString().split('T')[0];
        const sentToday = messagesData.filter(m => 
            (m.status === 'sent' || m.status === 'delivered') && 
            m.sentAt?.toDate?.()?.toISOString().split('T')[0] === today
        ).length;

        setStats({
            totalSent,
            totalDelivered,
            totalFailed,
            pendingMessages,
            sentToday
        });
    };

    // Get unique classes and levels
    const getUniqueClasses = () => {
        const classes = new Set();
        students.forEach(s => {
            if (s.class) classes.add(s.class);
        });
        return [...classes].sort();
    };

    const getUniqueLevels = () => {
        const levels = new Set();
        students.forEach(s => {
            if (s.level) levels.add(s.level);
        });
        return [...levels].sort();
    };

    // Get parent contacts
    const getParentContacts = (student) => {
        const contacts = [];
        if (student.parentPhone) {
            contacts.push(student.parentPhone);
        }
        if (student.guardianPhone) {
            contacts.push(student.guardianPhone);
        }
        if (student.phone) {
            contacts.push(student.phone);
        }
        return contacts;
    };

    // SMS Gateway API functions
    const sendSMSViaGateway = async (phoneNumber, message, subject) => {
        try {
            const response = await fetch(gatewayForm.apiUrl || '/.netlify/functions/send-sms', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${gatewayForm.apiKey}`
                },
                body: JSON.stringify({
                    phoneNumber: phoneNumber,
                    message: message,
                    subject: subject,
                    deviceId: gatewayForm.deviceId,
                    sender: gatewayForm.defaultSender,
                    priority: 'normal'
                })
            });

            const result = await response.json();
            return result;
        } catch (error) {
            console.error('Error sending SMS:', error);
            return { success: false, error: error.message };
        }
    };

    const sendBulkSMS = async (numbers, message, subject, type) => {
        setSending(true);
        setProgress({ current: 0, total: numbers.length });

        const batchSize = 50;
        const batches = [];
        for (let i = 0; i < numbers.length; i += batchSize) {
            batches.push(numbers.slice(i, i + batchSize));
        }

        let successCount = 0;
        let failCount = 0;
        const results = [];
        const messageId = `msg_${Date.now()}`;

        for (const batch of batches) {
            const batchPromises = batch.map(async (number, index) => {
                try {
                    const result = await sendSMSViaGateway(number, message, subject);
                    if (result.success) {
                        successCount++;
                        results.push({ number, success: true, messageId: result.messageId || messageId });
                    } else {
                        failCount++;
                        results.push({ number, success: false, error: result.error });
                    }
                } catch (error) {
                    failCount++;
                    results.push({ number, success: false, error: error.message });
                }
                setProgress(prev => ({ ...prev, current: prev.current + 1 }));
            });

            await Promise.all(batchPromises);
            // Small delay between batches to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Save message record
        await saveMessageRecord({
            subject,
            message,
            type,
            recipients: numbers.length,
            sent: successCount,
            failed: failCount,
            results,
            messageId
        });

        setSending(false);
        return { success: successCount, failed: failCount, total: numbers.length };
    };

    const saveMessageRecord = async (data) => {
        try {
            const record = {
                ...data,
                schoolId: userData?.schoolId || 'default_school',
                sentBy: currentUser?.uid,
                sentByName: userData?.fullName || userData?.firstName || 'System',
                sentAt: serverTimestamp(),
                status: data.failed > 0 ? 'partial' : 'sent',
                createdAt: new Date().toISOString()
            };

            if (isOnline) {
                await addDoc(collection(db, 'communications'), record);
            } else {
                await addToSyncQueue('communications', 'add', record);
                const updatedMessages = [record, ...messages];
                setMessages(updatedMessages);
                await saveToIndexedDB('comm_communications', updatedMessages);
            }

            showNotification(`Message sent to ${data.sent} recipients${data.failed > 0 ? `, ${data.failed} failed` : ''}`, 
                data.failed > 0 ? 'warning' : 'success');
        } catch (error) {
            console.error('Error saving message record:', error);
        }
    };

    // Handle sending messages
    const handleSendMessage = async () => {
        // Validate form
        if (!messageForm.subject.trim()) {
            showNotification('Please enter a subject', 'warning');
            return;
        }

        if (!messageForm.message.trim()) {
            showNotification('Please enter a message', 'warning');
            return;
        }

        let recipients = [];

        switch (messageForm.recipientType) {
            case 'all_students':
                recipients = students.map(s => s.phone).filter(p => p);
                break;
            case 'all_parents':
                const parentPhones = new Set();
                students.forEach(s => {
                    if (s.parentPhone) parentPhones.add(s.parentPhone);
                    if (s.guardianPhone) parentPhones.add(s.guardianPhone);
                });
                recipients = [...parentPhones];
                break;
            case 'specific_students':
                const selectedStuds = students.filter(s => messageForm.studentIds.includes(s.id));
                selectedStuds.forEach(s => {
                    if (s.parentPhone) recipients.push(s.parentPhone);
                    if (s.guardianPhone) recipients.push(s.guardianPhone);
                });
                break;
            case 'specific_classes':
                const classStuds = students.filter(s => s.class === messageForm.selectedClass);
                classStuds.forEach(s => {
                    if (s.parentPhone) recipients.push(s.parentPhone);
                    if (s.guardianPhone) recipients.push(s.guardianPhone);
                });
                break;
            case 'specific_levels':
                const levelStuds = students.filter(s => s.level === messageForm.selectedLevel);
                levelStuds.forEach(s => {
                    if (s.parentPhone) recipients.push(s.parentPhone);
                    if (s.guardianPhone) recipients.push(s.guardianPhone);
                });
                break;
            case 'individual':
                if (messageForm.customNumbers) {
                    recipients = messageForm.customNumbers.split(',').map(n => n.trim()).filter(n => n);
                }
                break;
            default:
                recipients = [];
        }

        // Remove duplicates
        recipients = [...new Set(recipients)];

        if (recipients.length === 0) {
            showNotification('No recipients found', 'warning');
            return;
        }

        // Check if gateway is connected
        if (gatewayStatus !== 'connected') {
            showNotification('SMS gateway is not connected. Please check your configuration.', 'error');
            return;
        }

        // Build message with variables
        let finalMessage = messageForm.message;
        if (messageForm.attachResults) {
            finalMessage += '\n\n📊 Results attached. Check your email for details.';
        }
        if (messageForm.attachFeeStatement) {
            finalMessage += '\n💰 Fee statement attached. Please check your email.';
        }

        const confirmSend = window.confirm(
            `Send message to ${recipients.length} recipients?\n\nSubject: ${messageForm.subject}\n\nMessage: ${finalMessage.substring(0, 100)}...`
        );

        if (!confirmSend) return;

        // Send the message
        const result = await sendBulkSMS(
            recipients,
            finalMessage,
            messageForm.subject,
            messageForm.type
        );

        if (result.success > 0) {
            // Reset form
            setMessageForm({
                type: 'general',
                priority: 'normal',
                recipientType: 'all_parents',
                subject: '',
                message: '',
                scheduledDate: '',
                scheduledTime: '',
                attachResults: false,
                attachFeeStatement: false,
                selectedClass: '',
                selectedLevel: '',
                studentIds: [],
                parentNumbers: [],
                customNumbers: ''
            });
            setSelectedStudents([]);
            setSelectedClasses([]);
            setSelectedLevels([]);
        }
    };

    // Template functions
    const handleSaveTemplate = async () => {
        if (!templateForm.name.trim() || !templateForm.message.trim()) {
            showNotification('Please fill in template name and message', 'warning');
            return;
        }

        try {
            const data = {
                ...templateForm,
                schoolId: userData?.schoolId || 'default_school',
                createdBy: currentUser?.uid,
                createdAt: new Date().toISOString()
            };

            if (isOnline) {
                await addDoc(collection(db, 'message_templates'), data);
            } else {
                await addToSyncQueue('message_templates', 'add', data);
                const updatedTemplates = [data, ...templates];
                setTemplates(updatedTemplates);
                await saveToIndexedDB('comm_message_templates', updatedTemplates);
            }

            showNotification('Template saved successfully!', 'success');
            setShowModal(false);
            resetTemplateForm();
        } catch (error) {
            console.error('Error saving template:', error);
            showNotification('Failed to save template', 'error');
        }
    };

    const applyTemplate = (template) => {
        setMessageForm(prev => ({
            ...prev,
            subject: template.subject || prev.subject,
            message: template.message || prev.message,
            type: template.type || prev.type
        }));
        showNotification('Template applied!', 'success');
    };

    // Generate result message for a student
    const generateResultMessage = (student, results) => {
        const name = `${student.firstName || ''} ${student.lastName || ''}`.trim();
        const subject = `Results Report - ${name}`;
        let message = `Dear Parent/Guardian,\n\n`;
        message += `Here are the results for ${name} (${student.admissionNumber || student.studentId || 'N/A'}):\n\n`;
        
        results.forEach(result => {
            message += `📚 ${result.subject || result.examName}: ${result.score || result.marks} - ${result.grade || 'N/A'}\n`;
        });
        
        message += `\nAverage Score: ${results.reduce((sum, r) => sum + (r.score || 0), 0) / results.length}%\n`;
        message += `\nBest Regards,\nSchool Administration`;
        
        return { subject, message };
    };

    // Render tabs
    const getTabs = () => {
        const tabs = [
            { id: 'compose', label: 'Compose', icon: 'fa-pen' },
            { id: 'history', label: 'Message History', icon: 'fa-history' },
            { id: 'templates', label: 'Templates', icon: 'fa-file-alt' }
        ];

        if (isAdmin || isSuperAdmin) {
            tabs.push({ id: 'gateway', label: 'Gateway Settings', icon: 'fa-cog' });
        }

        return tabs;
    };

    // Reset forms
    const resetTemplateForm = () => {
        setTemplateForm({
            name: '',
            type: 'general',
            subject: '',
            message: '',
            variable1: '',
            variable2: '',
            variable3: ''
        });
    };

    // Show notification
    const showNotification = (message, type = 'info') => {
        const colors = {
            success: '#27ae60',
            error: '#e74c3c',
            warning: '#f39c12',
            info: '#3498db'
        };
        const iconMap = {
            success: 'check-circle',
            error: 'exclamation-circle',
            warning: 'exclamation-triangle',
            info: 'info-circle'
        };

        const notificationEl = document.createElement('div');
        notificationEl.className = 'custom-notification';
        notificationEl.style.backgroundColor = colors[type] || colors.info;
        notificationEl.innerHTML = `
            <i class="fas fa-${iconMap[type] || 'info-circle'}"></i>
            <span>${message}</span>
        `;
        document.body.appendChild(notificationEl);

        setTimeout(() => {
            notificationEl.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => {
                if (notificationEl.parentNode) {
                    notificationEl.parentNode.removeChild(notificationEl);
                }
            }, 300);
        }, 4000);
    };

    // Message history render
    const renderMessageHistory = () => (
        <div className="history-section">
            <div className="section-header">
                <h2>Message History</h2>
            </div>

            <div className="filters-section">
                <input
                    type="text"
                    className="search-input"
                    placeholder="Search messages..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
                <select
                    className="filter-select"
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value)}
                >
                    <option value="">All Types</option>
                    {Object.entries(MESSAGE_TYPES).map(([key, value]) => (
                        <option key={key} value={key}>{value}</option>
                    ))}
                </select>
                <select
                    className="filter-select"
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                >
                    <option value="">All Status</option>
                    {Object.entries(DELIVERY_STATUS).map(([key, value]) => (
                        <option key={key} value={key}>{value}</option>
                    ))}
                </select>
                <input
                    type="date"
                    className="filter-select"
                    value={filterDate}
                    onChange={(e) => setFilterDate(e.target.value)}
                />
            </div>

            <div className="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Subject</th>
                            <th>Type</th>
                            <th>Recipients</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {messages
                            .filter(m => {
                                const matchSearch = m.subject?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                                                  m.message?.toLowerCase().includes(searchTerm.toLowerCase());
                                const matchType = !filterType || m.type === filterType;
                                const matchStatus = !filterStatus || m.status === filterStatus;
                                const matchDate = !filterDate || m.sentAt?.toDate?.()?.toISOString().split('T')[0] === filterDate;
                                return matchSearch && matchType && matchStatus && matchDate;
                            })
                            .map(message => (
                                <tr key={message.id}>
                                    <td>{message.sentAt?.toDate?.()?.toLocaleDateString() || 'N/A'}</td>
                                    <td>{message.subject || 'N/A'}</td>
                                    <td>{MESSAGE_TYPES[message.type] || message.type}</td>
                                    <td>{message.recipients || 0}</td>
                                    <td>
                                        <span className={`status-badge ${message.status}`}>
                                            {DELIVERY_STATUS[message.status] || message.status}
                                        </span>
                                    </td>
                                    <td>
                                        <button className="btn btn-primary btn-sm" onClick={() => {
                                            setSelectedMessage(message);
                                            setModalType('view');
                                            setShowModal(true);
                                        }}>
                                            <i className="fas fa-eye"></i>
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        {messages.length === 0 && (
                            <tr>
                                <td colSpan="6">
                                    <div className="empty-state">
                                        <i className="fas fa-envelope"></i>
                                        <p>No messages sent yet</p>
                                    </div>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );

    // Templates render
    const renderTemplates = () => (
        <div className="templates-section">
            <div className="section-header">
                <h2>Message Templates</h2>
                <button className="btn btn-primary" onClick={() => {
                    setModalType('template');
                    resetTemplateForm();
                    setShowModal(true);
                }}>
                    <i className="fas fa-plus"></i> Add Template
                </button>
            </div>

            <div className="templates-grid">
                {templates.map(template => (
                    <div key={template.id} className="template-card">
                        <div className="template-header">
                            <h3>{template.name}</h3>
                            <span className="template-type">{MESSAGE_TYPES[template.type] || template.type}</span>
                        </div>
                        <div className="template-details">
                            <p><strong>Subject:</strong> {template.subject || 'N/A'}</p>
                            <p><strong>Message:</strong> {template.message?.substring(0, 100)}...</p>
                        </div>
                        <div className="template-actions">
                            <button className="btn btn-success btn-sm" onClick={() => applyTemplate(template)}>
                                <i className="fas fa-paste"></i> Apply
                            </button>
                            <button className="btn btn-danger btn-sm" onClick={() => {
                                setDeleteItem(template);
                                setShowDeleteModal(true);
                            }}>
                                <i className="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                ))}
                {templates.length === 0 && (
                    <div className="empty-state" style={{ gridColumn: '1 / -1' }}>
                        <i className="fas fa-file-alt"></i>
                        <p>No templates created yet</p>
                    </div>
                )}
            </div>
        </div>
    );

    // Gateway settings render
    const renderGatewaySettings = () => (
        <div className="gateway-section">
            <div className="section-header">
                <h2>SMS Gateway Settings</h2>
            </div>

            <div className="gateway-status">
                <div className="status-card">
                    <div className="status-indicator">
                        <span className={`status-dot ${gatewayStatus}`}></span>
                        <span className="status-text">
                            Gateway: {gatewayStatus === 'connected' ? 'Connected' : 'Disconnected'}
                        </span>
                    </div>
                    <div className="status-detail">
                        <span>Balance: {phoneBalance} SMS</span>
                    </div>
                </div>
            </div>

            <div className="settings-form">
                <div className="form-group">
                    <label>API URL</label>
                    <input
                        type="text"
                        value={gatewayForm.apiUrl}
                        onChange={(e) => setGatewayForm({ ...gatewayForm, apiUrl: e.target.value })}
                        placeholder="http://your-gateway-ip:8080/api/sms"
                    />
                    <div className="help-text">The URL where your SMS gateway APK is running</div>
                </div>

                <div className="form-group">
                    <label>API Key</label>
                    <input
                        type="text"
                        value={gatewayForm.apiKey}
                        onChange={(e) => setGatewayForm({ ...gatewayForm, apiKey: e.target.value })}
                        placeholder="Your API key"
                    />
                </div>

                <div className="form-row">
                    <div className="form-group">
                        <label>Device ID</label>
                        <input
                            type="text"
                            value={gatewayForm.deviceId}
                            onChange={(e) => setGatewayForm({ ...gatewayForm, deviceId: e.target.value })}
                            placeholder="Device ID from gateway"
                        />
                    </div>
                    <div className="form-group">
                        <label>Phone Number</label>
                        <input
                            type="text"
                            value={gatewayForm.phoneNumber}
                            onChange={(e) => setGatewayForm({ ...gatewayForm, phoneNumber: e.target.value })}
                            placeholder="Phone number registered in gateway"
                        />
                    </div>
                </div>

                <div className="form-group">
                    <label>Default Sender Name</label>
                    <input
                        type="text"
                        value={gatewayForm.defaultSender}
                        onChange={(e) => setGatewayForm({ ...gatewayForm, defaultSender: e.target.value })}
                        placeholder="Your school name"
                    />
                </div>

                <div className="form-group">
                    <label className="checkbox-label">
                        <input
                            type="checkbox"
                            checked={gatewayForm.enabled}
                            onChange={(e) => setGatewayForm({ ...gatewayForm, enabled: e.target.checked })}
                        />
                        Enable Gateway
                    </label>
                </div>

                <button className="btn btn-primary" onClick={async () => {
                    try {
                        const data = {
                            ...gatewayForm,
                            schoolId: userData?.schoolId || 'default_school',
                            updatedAt: new Date().toISOString()
                        };
                        await setDoc(doc(db, 'sms_gateway', userData?.schoolId || 'default_school'), data, { merge: true });
                        showNotification('Gateway settings saved!', 'success');
                        loadGatewayStatus();
                    } catch (error) {
                        console.error('Error saving gateway settings:', error);
                        showNotification('Failed to save gateway settings', 'error');
                    }
                }}>
                    <i className="fas fa-save"></i> Save Settings
                </button>
            </div>
        </div>
    );

    if (loading) {
        return <LoadingSpinner fullScreen text="Loading communication data..." />;
    }

    return (
        <Layout title="Communication">
            <style>{`
                .communication-container {
                    padding: 0;
                }

                .stats-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
                    gap: 20px;
                    margin-bottom: 30px;
                }

                .stat-card {
                    background: white;
                    border-radius: 12px;
                    padding: 20px;
                    box-shadow: var(--shadow);
                    transition: all 0.3s;
                }

                .stat-card:hover {
                    transform: translateY(-2px);
                    box-shadow: var(--shadow-lg);
                }

                .stat-card .stat-label {
                    font-size: 13px;
                    color: var(--gray);
                    font-weight: 500;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }

                .stat-card .stat-value {
                    font-size: 28px;
                    font-weight: 700;
                    color: var(--secondary);
                    margin-top: 5px;
                }

                .stat-card .stat-sub {
                    font-size: 12px;
                    color: var(--gray);
                    margin-top: 5px;
                }

                .tabs-container {
                    display: flex;
                    gap: 5px;
                    margin-bottom: 25px;
                    background: white;
                    padding: 5px;
                    border-radius: 12px;
                    box-shadow: var(--shadow);
                    overflow-x: auto;
                    flex-wrap: wrap;
                }

                .tab-btn {
                    padding: 10px 20px;
                    border: none;
                    border-radius: 8px;
                    cursor: pointer;
                    font-weight: 600;
                    font-size: 14px;
                    transition: all 0.3s;
                    background: transparent;
                    color: var(--gray);
                    white-space: nowrap;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .tab-btn:hover {
                    background: var(--light);
                    color: var(--secondary);
                }

                .tab-btn.active {
                    background: var(--primary);
                    color: white;
                }

                .tab-btn i {
                    font-size: 16px;
                }

                .section-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 20px;
                    flex-wrap: wrap;
                    gap: 10px;
                }

                .section-header h2 {
                    font-size: 18px;
                    font-weight: 700;
                    color: var(--secondary);
                }

                .filters-section {
                    background: white;
                    border-radius: 12px;
                    padding: 15px;
                    box-shadow: var(--shadow);
                    margin-bottom: 20px;
                    display: flex;
                    flex-wrap: wrap;
                    gap: 15px;
                    align-items: center;
                }

                .search-input {
                    flex: 1;
                    min-width: 200px;
                    padding: 10px 15px;
                    border: 2px solid var(--border);
                    border-radius: 8px;
                    font-size: 14px;
                    transition: all 0.3s;
                    background: white;
                    color: var(--secondary);
                }

                .search-input:focus {
                    outline: none;
                    border-color: var(--primary);
                }

                .filter-select {
                    padding: 10px 15px;
                    border: 2px solid var(--border);
                    border-radius: 8px;
                    font-size: 14px;
                    background: white;
                    cursor: pointer;
                    min-width: 150px;
                    color: var(--secondary);
                }

                .filter-select:focus {
                    outline: none;
                    border-color: var(--primary);
                }

                .btn {
                    padding: 10px 20px;
                    border: none;
                    border-radius: 8px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.3s;
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 14px;
                }

                .btn-primary {
                    background: var(--primary);
                    color: white;
                }

                .btn-primary:hover {
                    background: var(--primary-dark);
                    transform: translateY(-2px);
                    box-shadow: var(--shadow-lg);
                }

                .btn-success {
                    background: var(--success);
                    color: white;
                }

                .btn-success:hover {
                    opacity: 0.9;
                    transform: translateY(-2px);
                }

                .btn-danger {
                    background: var(--danger);
                    color: white;
                }

                .btn-danger:hover {
                    opacity: 0.9;
                    transform: translateY(-2px);
                }

                .btn-outline {
                    background: transparent;
                    border: 2px solid var(--border);
                    color: var(--secondary);
                }

                .btn-outline:hover {
                    border-color: var(--primary);
                    color: var(--primary);
                }

                .btn-sm {
                    padding: 6px 12px;
                    font-size: 12px;
                }

                .compose-section {
                    background: white;
                    border-radius: 12px;
                    padding: 25px;
                    box-shadow: var(--shadow);
                }

                .compose-section .form-group {
                    margin-bottom: 20px;
                }

                .compose-section .form-group label {
                    display: block;
                    font-size: 14px;
                    font-weight: 600;
                    color: var(--secondary);
                    margin-bottom: 5px;
                }

                .compose-section .form-group label .required {
                    color: var(--danger);
                }

                .compose-section .form-group input,
                .compose-section .form-group select,
                .compose-section .form-group textarea {
                    width: 100%;
                    padding: 10px 15px;
                    border: 2px solid var(--border);
                    border-radius: 8px;
                    font-size: 14px;
                    transition: all 0.3s;
                    background: white;
                    color: var(--secondary);
                }

                .compose-section .form-group input:focus,
                .compose-section .form-group select:focus,
                .compose-section .form-group textarea:focus {
                    outline: none;
                    border-color: var(--primary);
                }

                .compose-section .form-row {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 20px;
                }

                .compose-section .checkbox-group {
                    display: flex;
                    gap: 20px;
                    flex-wrap: wrap;
                }

                .compose-section .checkbox-group label {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-weight: 400;
                }

                .compose-section .checkbox-group input[type="checkbox"] {
                    width: 18px;
                    height: 18px;
                    cursor: pointer;
                }

                .recipient-counter {
                    padding: 10px 15px;
                    background: var(--light);
                    border-radius: 8px;
                    font-size: 14px;
                    color: var(--secondary);
                }

                .recipient-counter strong {
                    color: var(--primary);
                }

                .student-select-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
                    gap: 10px;
                    max-height: 300px;
                    overflow-y: auto;
                    padding: 10px;
                    border: 1px solid var(--border);
                    border-radius: 8px;
                }

                .student-select-item {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 5px 10px;
                    border-radius: 6px;
                    cursor: pointer;
                    transition: all 0.3s;
                }

                .student-select-item:hover {
                    background: var(--light);
                }

                .student-select-item input[type="checkbox"] {
                    width: 16px;
                    height: 16px;
                    cursor: pointer;
                }

                .progress-container {
                    margin: 15px 0;
                    padding: 15px;
                    background: var(--light);
                    border-radius: 8px;
                }

                .progress-bar {
                    width: 100%;
                    height: 8px;
                    background: var(--border);
                    border-radius: 4px;
                    overflow: hidden;
                }

                .progress-bar .progress-fill {
                    height: 100%;
                    background: var(--success);
                    border-radius: 4px;
                    transition: width 0.3s;
                }

                .progress-text {
                    display: flex;
                    justify-content: space-between;
                    font-size: 13px;
                    color: var(--gray);
                    margin-top: 5px;
                }

                .table-container {
                    background: white;
                    border-radius: 12px;
                    box-shadow: var(--shadow);
                    overflow: hidden;
                }

                .table-wrapper {
                    overflow-x: auto;
                }

                table {
                    width: 100%;
                    border-collapse: collapse;
                }

                thead {
                    background: var(--light);
                }

                th {
                    padding: 12px 20px;
                    text-align: left;
                    font-size: 12px;
                    font-weight: 600;
                    color: var(--gray);
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }

                td {
                    padding: 12px 20px;
                    border-bottom: 1px solid var(--border);
                    font-size: 14px;
                }

                tr:hover {
                    background: var(--light);
                }

                .status-badge {
                    padding: 3px 12px;
                    border-radius: 20px;
                    font-size: 12px;
                    font-weight: 600;
                }

                .status-badge.sent {
                    background: #d4edda;
                    color: #155724;
                }

                .status-badge.pending {
                    background: #fff3cd;
                    color: #856404;
                }

                .status-badge.delivered {
                    background: #d4edda;
                    color: #155724;
                }

                .status-badge.failed {
                    background: #f8d7da;
                    color: #721c24;
                }

                .status-badge.partial {
                    background: #fff3cd;
                    color: #856404;
                }

                .templates-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
                    gap: 20px;
                }

                .template-card {
                    background: white;
                    border-radius: 12px;
                    padding: 20px;
                    box-shadow: var(--shadow);
                    transition: all 0.3s;
                }

                .template-card:hover {
                    transform: translateY(-2px);
                    box-shadow: var(--shadow-lg);
                }

                .template-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 10px;
                }

                .template-header h3 {
                    font-size: 16px;
                    font-weight: 600;
                    color: var(--secondary);
                    margin: 0;
                }

                .template-type {
                    padding: 2px 10px;
                    border-radius: 12px;
                    font-size: 11px;
                    font-weight: 600;
                    background: var(--light);
                    color: var(--gray);
                }

                .template-details {
                    font-size: 13px;
                    color: var(--gray);
                    margin-bottom: 15px;
                }

                .template-details p {
                    margin: 5px 0;
                }

                .template-actions {
                    display: flex;
                    gap: 8px;
                    padding-top: 10px;
                    border-top: 1px solid var(--border);
                }

                .gateway-status {
                    background: white;
                    border-radius: 12px;
                    padding: 20px;
                    box-shadow: var(--shadow);
                    margin-bottom: 20px;
                }

                .status-card {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    flex-wrap: wrap;
                    gap: 15px;
                }

                .status-indicator {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }

                .status-dot {
                    width: 12px;
                    height: 12px;
                    border-radius: 50%;
                    display: inline-block;
                }

                .status-dot.connected {
                    background: #27ae60;
                }

                .status-dot.disconnected {
                    background: #e74c3c;
                }

                .status-dot.connecting {
                    background: #f39c12;
                }

                .status-text {
                    font-weight: 600;
                    color: var(--secondary);
                }

                .status-detail {
                    font-size: 14px;
                    color: var(--gray);
                }

                .settings-form {
                    background: white;
                    border-radius: 12px;
                    padding: 25px;
                    box-shadow: var(--shadow);
                }

                .checkbox-label {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    cursor: pointer;
                }

                .checkbox-label input {
                    width: 18px;
                    height: 18px;
                    cursor: pointer;
                }

                .empty-state {
                    text-align: center;
                    padding: 40px 20px;
                    color: var(--gray);
                }

                .empty-state i {
                    font-size: 48px;
                    color: var(--border);
                    margin-bottom: 15px;
                }

                .modal-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0, 0, 0, 0.5);
                    z-index: 1000;
                    display: none;
                    align-items: center;
                    justify-content: center;
                    padding: 20px;
                }

                .modal-overlay.active {
                    display: flex;
                }

                .modal {
                    background: white;
                    border-radius: 16px;
                    max-width: 700px;
                    width: 100%;
                    max-height: 90vh;
                    overflow-y: auto;
                    padding: 30px;
                }

                .modal-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 25px;
                }

                .modal-header h2 {
                    font-size: 22px;
                    color: var(--secondary);
                }

                .modal-close {
                    width: 40px;
                    height: 40px;
                    border: none;
                    border-radius: 50%;
                    background: var(--light);
                    cursor: pointer;
                    font-size: 18px;
                    transition: all 0.3s;
                }

                .modal-close:hover {
                    background: var(--border);
                }

                .modal-footer {
                    display: flex;
                    gap: 10px;
                    justify-content: flex-end;
                    margin-top: 25px;
                    padding-top: 20px;
                    border-top: 1px solid var(--border);
                }

                .help-text {
                    font-size: 12px;
                    color: var(--gray);
                    margin-top: 5px;
                }

                @media (max-width: 768px) {
                    .stats-grid {
                        grid-template-columns: repeat(2, 1fr);
                    }

                    .compose-section .form-row {
                        grid-template-columns: 1fr;
                    }

                    .tabs-container {
                        flex-wrap: nowrap;
                        overflow-x: auto;
                    }

                    .tab-btn {
                        padding: 8px 14px;
                        font-size: 12px;
                    }

                    .filters-section {
                        flex-direction: column;
                        align-items: stretch;
                    }

                    .search-input,
                    .filter-select {
                        width: 100%;
                    }

                    .templates-grid {
                        grid-template-columns: 1fr;
                    }

                    .status-card {
                        flex-direction: column;
                        align-items: flex-start;
                    }
                }

                @media (max-width: 480px) {
                    .stats-grid {
                        grid-template-columns: 1fr;
                    }

                    .section-header {
                        flex-direction: column;
                        align-items: stretch;
                    }

                    .checkbox-group {
                        flex-direction: column;
                    }
                }

                @keyframes slideOut {
                    from { transform: translateX(0); opacity: 1; }
                    to { transform: translateX(100%); opacity: 0; }
                }

                .custom-notification {
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    padding: 15px 20px;
                    border-radius: 8px;
                    box-shadow: 0 5px 15px rgba(0,0,0,0.2);
                    z-index: 10000;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    animation: slideIn 0.3s ease;
                    max-width: 400px;
                    word-wrap: break-word;
                    color: white;
                    font-family: 'Poppins', sans-serif;
                }
            `}</style>

            <div className="communication-container">
                {/* Stats */}
                <div className="stats-grid">
                    <div className="stat-card">
                        <div className="stat-label">Total Sent</div>
                        <div className="stat-value">{stats.totalSent}</div>
                        <div className="stat-sub">{stats.sentToday} Today</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-label">Delivered</div>
                        <div className="stat-value" style={{ color: '#27ae60' }}>{stats.totalDelivered}</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-label">Failed</div>
                        <div className="stat-value" style={{ color: '#e74c3c' }}>{stats.totalFailed}</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-label">Pending</div>
                        <div className="stat-value" style={{ color: '#f39c12' }}>{stats.pendingMessages}</div>
                    </div>
                </div>

                {/* Tabs */}
                <div className="tabs-container">
                    {getTabs().map(tab => (
                        <button
                            key={tab.id}
                            className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
                            onClick={() => setActiveTab(tab.id)}
                        >
                            <i className={`fas ${tab.icon}`}></i>
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Compose Tab */}
                {activeTab === 'compose' && (
                    <div className="compose-section">
                        <div className="section-header">
                            <h2>Compose Message</h2>
                            <div className="recipient-counter">
                                <i className="fas fa-users"></i> Recipients: <strong id="recipientCount">0</strong>
                            </div>
                        </div>

                        <div className="form-row">
                            <div className="form-group">
                                <label>Message Type <span className="required">*</span></label>
                                <select
                                    value={messageForm.type}
                                    onChange={(e) => setMessageForm({ ...messageForm, type: e.target.value })}
                                >
                                    {Object.entries(MESSAGE_TYPES).map(([key, value]) => (
                                        <option key={key} value={key}>{value}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="form-group">
                                <label>Priority</label>
                                <select
                                    value={messageForm.priority}
                                    onChange={(e) => setMessageForm({ ...messageForm, priority: e.target.value })}
                                >
                                    {Object.entries(MESSAGE_PRIORITY).map(([key, value]) => (
                                        <option key={key} value={key}>{value}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="form-group">
                            <label>Recipient Type <span className="required">*</span></label>
                            <select
                                value={messageForm.recipientType}
                                onChange={(e) => {
                                    const type = e.target.value;
                                    setMessageForm({ ...messageForm, recipientType: type });
                                    if (type === 'all_students' || type === 'all_parents') {
                                        setSelectedStudents([]);
                                        setSelectedClasses([]);
                                        setSelectedLevels([]);
                                    }
                                }}
                            >
                                {Object.entries(RECIPIENT_TYPES).map(([key, value]) => (
                                    <option key={key} value={key}>{value}</option>
                                ))}
                            </select>
                        </div>

                        {/* Dynamic recipient selection */}
                        {messageForm.recipientType === 'specific_students' && (
                            <div className="form-group">
                                <label>Select Students</label>
                                <div className="student-select-grid">
                                    {students.map(s => (
                                        <label key={s.id} className="student-select-item">
                                            <input
                                                type="checkbox"
                                                checked={messageForm.studentIds.includes(s.id)}
                                                onChange={(e) => {
                                                    if (e.target.checked) {
                                                        setMessageForm({
                                                            ...messageForm,
                                                            studentIds: [...messageForm.studentIds, s.id]
                                                        });
                                                    } else {
                                                        setMessageForm({
                                                            ...messageForm,
                                                            studentIds: messageForm.studentIds.filter(id => id !== s.id)
                                                        });
                                                    }
                                                }}
                                            />
                                            {s.firstName} {s.lastName} - {s.class}
                                        </label>
                                    ))}
                                </div>
                                <div className="help-text">Selected: {messageForm.studentIds.length} students</div>
                            </div>
                        )}

                        {messageForm.recipientType === 'specific_classes' && (
                            <div className="form-group">
                                <label>Select Class</label>
                                <select
                                    value={messageForm.selectedClass}
                                    onChange={(e) => setMessageForm({ ...messageForm, selectedClass: e.target.value })}
                                >
                                    <option value="">Select Class</option>
                                    {getUniqueClasses().map(cls => (
                                        <option key={cls} value={cls}>{cls}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {messageForm.recipientType === 'specific_levels' && (
                            <div className="form-group">
                                <label>Select Level</label>
                                <select
                                    value={messageForm.selectedLevel}
                                    onChange={(e) => setMessageForm({ ...messageForm, selectedLevel: e.target.value })}
                                >
                                    <option value="">Select Level</option>
                                    {getUniqueLevels().map(level => (
                                        <option key={level} value={level}>{level}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {messageForm.recipientType === 'individual' && (
                            <div className="form-group">
                                <label>Phone Numbers (comma separated)</label>
                                <textarea
                                    value={messageForm.customNumbers}
                                    onChange={(e) => setMessageForm({ ...messageForm, customNumbers: e.target.value })}
                                    rows="3"
                                    placeholder="0712345678, 0723456789, 0734567890"
                                />
                                <div className="help-text">Enter phone numbers separated by commas</div>
                            </div>
                        )}

                        <div className="form-group">
                            <label>Subject <span className="required">*</span></label>
                            <input
                                type="text"
                                value={messageForm.subject}
                                onChange={(e) => setMessageForm({ ...messageForm, subject: e.target.value })}
                                placeholder="Message subject"
                            />
                        </div>

                        <div className="form-group">
                            <label>Message <span className="required">*</span></label>
                            <textarea
                                value={messageForm.message}
                                onChange={(e) => {
                                    const text = e.target.value;
                                    setMessageForm({ ...messageForm, message: text });
                                    // Calculate SMS count (160 chars per SMS)
                                    const count = Math.ceil(text.length / 160);
                                    setSmsCount(count);
                                }}
                                rows="6"
                                placeholder="Type your message here..."
                            />
                            <div style={{ fontSize: '12px', color: 'var(--gray)', marginTop: '5px' }}>
                                {messageForm.message.length} characters • {smsCount} SMS part(s)
                            </div>
                        </div>

                        <div className="form-group">
                            <label>Attachments</label>
                            <div className="checkbox-group">
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={messageForm.attachResults}
                                        onChange={(e) => setMessageForm({ ...messageForm, attachResults: e.target.checked })}
                                    />
                                    Attach Results
                                </label>
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={messageForm.attachFeeStatement}
                                        onChange={(e) => setMessageForm({ ...messageForm, attachFeeStatement: e.target.checked })}
                                    />
                                    Attach Fee Statement
                                </label>
                            </div>
                        </div>

                        <div className="form-row">
                            <div className="form-group">
                                <label>Schedule Date</label>
                                <input
                                    type="date"
                                    value={messageForm.scheduledDate}
                                    onChange={(e) => setMessageForm({ ...messageForm, scheduledDate: e.target.value })}
                                />
                            </div>
                            <div className="form-group">
                                <label>Schedule Time</label>
                                <input
                                    type="time"
                                    value={messageForm.scheduledTime}
                                    onChange={(e) => setMessageForm({ ...messageForm, scheduledTime: e.target.value })}
                                />
                            </div>
                        </div>

                        {sending && (
                            <div className="progress-container">
                                <div className="progress-bar">
                                    <div
                                        className="progress-fill"
                                        style={{ width: `${(progress.current / progress.total) * 100}%` }}
                                    ></div>
                                </div>
                                <div className="progress-text">
                                    <span>Sending... {progress.current} of {progress.total}</span>
                                    <span>{Math.round((progress.current / progress.total) * 100)}%</span>
                                </div>
                            </div>
                        )}

                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '20px' }}>
                            <button
                                className="btn btn-success"
                                onClick={handleSendMessage}
                                disabled={sending || gatewayStatus !== 'connected'}
                            >
                                {sending ? (
                                    <><i className="fas fa-spinner fa-spin"></i> Sending...</>
                                ) : (
                                    <><i className="fas fa-paper-plane"></i> Send Message</>
                                )}
                            </button>
                            <button
                                className="btn btn-outline"
                                onClick={() => {
                                    setMessageForm({
                                        type: 'general',
                                        priority: 'normal',
                                        recipientType: 'all_parents',
                                        subject: '',
                                        message: '',
                                        scheduledDate: '',
                                        scheduledTime: '',
                                        attachResults: false,
                                        attachFeeStatement: false,
                                        selectedClass: '',
                                        selectedLevel: '',
                                        studentIds: [],
                                        parentNumbers: [],
                                        customNumbers: ''
                                    });
                                    setSelectedStudents([]);
                                    setSelectedClasses([]);
                                    setSelectedLevels([]);
                                }}
                            >
                                <i className="fas fa-undo"></i> Reset
                            </button>
                        </div>

                        {gatewayStatus !== 'connected' && (
                            <div style={{
                                marginTop: '15px',
                                padding: '12px 16px',
                                background: '#fff3cd',
                                borderRadius: '8px',
                                border: '1px solid #ffc107',
                                color: '#856404'
                            }}>
                                <i className="fas fa-exclamation-triangle"></i>
                                <span style={{ marginLeft: '8px' }}>
                                    SMS gateway is not connected. Please configure the gateway settings.
                                </span>
                            </div>
                        )}
                    </div>
                )}

                {/* History Tab */}
                {activeTab === 'history' && renderMessageHistory()}

                {/* Templates Tab */}
                {activeTab === 'templates' && renderTemplates()}

                {/* Gateway Tab */}
                {activeTab === 'gateway' && (isAdmin || isSuperAdmin) && renderGatewaySettings()}
            </div>

            {/* Template Modal */}
            {showModal && modalType === 'template' && (
                <div className="modal-overlay active" onClick={(e) => {
                    if (e.target === e.currentTarget) setShowModal(false);
                }}>
                    <div className="modal">
                        <div className="modal-header">
                            <h2>Save Template</h2>
                            <button className="modal-close" onClick={() => setShowModal(false)}>
                                <i className="fas fa-times"></i>
                            </button>
                        </div>
                        <form onSubmit={(e) => { e.preventDefault(); handleSaveTemplate(); }}>
                            <div className="form-group">
                                <label>Template Name <span className="required">*</span></label>
                                <input
                                    type="text"
                                    value={templateForm.name}
                                    onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })}
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label>Type</label>
                                <select
                                    value={templateForm.type}
                                    onChange={(e) => setTemplateForm({ ...templateForm, type: e.target.value })}
                                >
                                    {Object.entries(MESSAGE_TYPES).map(([key, value]) => (
                                        <option key={key} value={key}>{value}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="form-group">
                                <label>Subject</label>
                                <input
                                    type="text"
                                    value={templateForm.subject}
                                    onChange={(e) => setTemplateForm({ ...templateForm, subject: e.target.value })}
                                />
                            </div>
                            <div className="form-group">
                                <label>Message <span className="required">*</span></label>
                                <textarea
                                    value={templateForm.message}
                                    onChange={(e) => setTemplateForm({ ...templateForm, message: e.target.value })}
                                    rows="6"
                                    required
                                />
                            </div>
                            <div className="help-text">
                                You can use variables: { '{student_name}', '{student_class}', '{parent_name}', '{school_name}' }
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>
                                    Cancel
                                </button>
                                <button type="submit" className="btn btn-primary">
                                    Save Template
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* View Message Modal */}
            {showModal && modalType === 'view' && selectedMessage && (
                <div className="modal-overlay active" onClick={(e) => {
                    if (e.target === e.currentTarget) setShowModal(false);
                }}>
                    <div className="modal">
                        <div className="modal-header">
                            <h2>Message Details</h2>
                            <button className="modal-close" onClick={() => setShowModal(false)}>
                                <i className="fas fa-times"></i>
                            </button>
                        </div>
                        <div style={{ padding: '10px 0' }}>
                            <div className="detail-item">
                                <strong>Subject:</strong> {selectedMessage.subject || 'N/A'}
                            </div>
                            <div className="detail-item" style={{ marginTop: '10px' }}>
                                <strong>Type:</strong> {MESSAGE_TYPES[selectedMessage.type] || selectedMessage.type}
                            </div>
                            <div className="detail-item" style={{ marginTop: '10px' }}>
                                <strong>Recipients:</strong> {selectedMessage.recipients || 0}
                            </div>
                            <div className="detail-item" style={{ marginTop: '10px' }}>
                                <strong>Status:</strong> {DELIVERY_STATUS[selectedMessage.status] || selectedMessage.status}
                            </div>
                            <div className="detail-item" style={{ marginTop: '10px' }}>
                                <strong>Sent At:</strong> {selectedMessage.sentAt?.toDate?.()?.toLocaleString() || 'N/A'}
                            </div>
                            {selectedMessage.message && (
                                <div className="detail-item" style={{ marginTop: '10px' }}>
                                    <strong>Message:</strong>
                                    <div style={{
                                        marginTop: '5px',
                                        padding: '10px',
                                        background: 'var(--light)',
                                        borderRadius: '8px',
                                        whiteSpace: 'pre-wrap'
                                    }}>
                                        {selectedMessage.message}
                                    </div>
                                </div>
                            )}
                            {selectedMessage.results && selectedMessage.results.length > 0 && (
                                <div className="detail-item" style={{ marginTop: '10px' }}>
                                    <strong>Delivery Report:</strong>
                                    <div style={{
                                        marginTop: '5px',
                                        padding: '10px',
                                        background: 'var(--light)',
                                        borderRadius: '8px',
                                        maxHeight: '200px',
                                        overflowY: 'auto'
                                    }}>
                                        <div>Sent: {selectedMessage.sent || 0}</div>
                                        <div style={{ color: '#e74c3c' }}>Failed: {selectedMessage.failed || 0}</div>
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-outline" onClick={() => setShowModal(false)}>
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Modal */}
            {showDeleteModal && deleteItem && (
                <div className="modal-overlay active" onClick={(e) => {
                    if (e.target === e.currentTarget) setShowDeleteModal(false);
                }}>
                    <div className="modal" style={{ maxWidth: '450px' }}>
                        <div className="modal-header">
                            <h2>Confirm Delete</h2>
                            <button className="modal-close" onClick={() => setShowDeleteModal(false)}>
                                <i className="fas fa-times"></i>
                            </button>
                        </div>
                        <div style={{ padding: '20px 0' }}>
                            <p style={{ marginBottom: '20px' }}>
                                Are you sure you want to delete this template?
                            </p>
                            <div className="modal-footer">
                                <button className="btn btn-outline" onClick={() => setShowDeleteModal(false)}>
                                    Cancel
                                </button>
                                <button className="btn btn-danger" onClick={async () => {
                                    try {
                                        if (isOnline) {
                                            await deleteDoc(doc(db, 'message_templates', deleteItem.id));
                                        } else {
                                            await addToSyncQueue('message_templates', 'delete', { id: deleteItem.id });
                                        }
                                        const updatedTemplates = templates.filter(t => t.id !== deleteItem.id);
                                        setTemplates(updatedTemplates);
                                        await saveToIndexedDB('comm_message_templates', updatedTemplates);
                                        showNotification('Template deleted successfully!', 'success');
                                        setShowDeleteModal(false);
                                        setDeleteItem(null);
                                    } catch (error) {
                                        console.error('Error deleting template:', error);
                                        showNotification('Failed to delete template', 'error');
                                    }
                                }}>
                                    <i className="fas fa-trash"></i> Delete
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </Layout>
    );
}
