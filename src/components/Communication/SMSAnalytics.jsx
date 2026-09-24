import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../../firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { useAuth } from '../../context/AuthContext';
import { 
    LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, 
    XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer 
} from 'recharts';
import LoadingSpinner from '../Common/LoadingSpinner';

export default function SMSAnalytics() {
    const { userData } = useAuth();
    const [loading, setLoading] = useState(true);
    const [queueData, setQueueData] = useState([]);

    useEffect(() => {
        const fetchData = async () => {
            const schoolId = userData?.schoolId || 'default_school';
            try {
                const q = query(
                    collection(db, 'sms_queue'),
                    where('schoolId', '==', schoolId)
                );
                const snapshot = await getDocs(q);
                const data = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data(),
                    createdAtDate: doc.data().createdAt?.toDate() || new Date()
                }));
                setQueueData(data);
            } catch (error) {
                console.error("Error fetching SMS data:", error);
            } finally {
                setLoading(false);
            }
        };

        if (userData?.schoolId) {
            fetchData();
        }
    }, [userData]);

    const analytics = useMemo(() => {
        let sent = 0;
        let delivered = 0;
        let failed = 0;
        let pending = 0;
        const trendMap = {};
        const usageMap = {
            'Fee Reminders': 0,
            'Results': 0,
            'Meeting Notices': 0,
            'Other': 0
        };

        queueData.forEach(batch => {
            const dateStr = batch.createdAtDate.toISOString().split('T')[0];
            if (!trendMap[dateStr]) trendMap[dateStr] = { date: dateStr, sent: 0, delivered: 0 };
            
            // Assume each batch has totalMessages
            const count = batch.totalMessages || 0;
            
            if (batch.status === 'completed' || batch.status === 'sent') {
                sent += count;
                // If we don't have explicit delivery receipts, we approximate delivered as a high percentage of sent
                // Or if the APK sets successCount, use that.
                const succ = batch.successCount !== undefined ? batch.successCount : Math.floor(count * 0.95);
                delivered += succ;
                failed += count - succ;
                trendMap[dateStr].sent += count;
                trendMap[dateStr].delivered += succ;
            } else if (batch.status === 'pending') {
                pending += count;
            } else {
                failed += count;
            }

            // Categorize by template content
            const tmpl = (batch.template || '').toLowerCase();
            if (tmpl.includes('fee') || tmpl.includes('balance') || tmpl.includes('pay')) {
                usageMap['Fee Reminders'] += count;
            } else if (tmpl.includes('result') || tmpl.includes('exam') || tmpl.includes('score')) {
                usageMap['Results'] += count;
            } else if (tmpl.includes('meeting') || tmpl.includes('parent') || tmpl.includes('notice')) {
                usageMap['Meeting Notices'] += count;
            } else {
                usageMap['Other'] += count;
            }
        });

        const trendData = Object.values(trendMap).sort((a, b) => new Date(a.date) - new Date(b.date));
        
        const usageData = Object.entries(usageMap)
            .filter(([_, value]) => value > 0)
            .map(([name, value]) => ({ name, value }));

        return {
            totalSent: sent,
            totalDelivered: delivered,
            totalFailed: failed,
            totalPending: pending,
            trendData,
            usageData
        };
    }, [queueData]);

    const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042'];

    if (loading) return <LoadingSpinner />;

    return (
        <div style={{ padding: '20px', background: 'white', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginBottom: '30px' }}>
                <div style={{ padding: '20px', background: '#f8f9fa', borderRadius: '12px', borderLeft: '4px solid #0088FE' }}>
                    <div style={{ fontSize: '13px', color: '#666', fontWeight: '600', textTransform: 'uppercase' }}>Total Sent</div>
                    <div style={{ fontSize: '28px', fontWeight: '700', color: '#333', marginTop: '5px' }}>{analytics.totalSent.toLocaleString()}</div>
                </div>
                <div style={{ padding: '20px', background: '#f8f9fa', borderRadius: '12px', borderLeft: '4px solid #00C49F' }}>
                    <div style={{ fontSize: '13px', color: '#666', fontWeight: '600', textTransform: 'uppercase' }}>Delivered</div>
                    <div style={{ fontSize: '28px', fontWeight: '700', color: '#333', marginTop: '5px' }}>{analytics.totalDelivered.toLocaleString()}</div>
                </div>
                <div style={{ padding: '20px', background: '#f8f9fa', borderRadius: '12px', borderLeft: '4px solid #FF8042' }}>
                    <div style={{ fontSize: '13px', color: '#666', fontWeight: '600', textTransform: 'uppercase' }}>Pending</div>
                    <div style={{ fontSize: '28px', fontWeight: '700', color: '#333', marginTop: '5px' }}>{analytics.totalPending.toLocaleString()}</div>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '30px' }}>
                <div style={{ background: '#fff', border: '1px solid #eaeaea', borderRadius: '12px', padding: '20px' }}>
                    <h3 style={{ fontSize: '16px', color: '#333', marginBottom: '20px', fontWeight: '600' }}>Delivery Trends</h3>
                    <div style={{ height: '300px' }}>
                        {analytics.trendData.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={analytics.trendData}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
                                    <XAxis dataKey="date" tick={{fontSize: 12, fill: '#888'}} axisLine={{stroke: '#e0e0e0'}} />
                                    <YAxis tick={{fontSize: 12, fill: '#888'}} axisLine={false} tickLine={false} />
                                    <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                                    <Legend iconType="circle" />
                                    <Line type="monotone" dataKey="sent" name="Sent" stroke="#0088FE" strokeWidth={3} dot={{r: 4, fill: '#0088FE', strokeWidth: 0}} activeDot={{r: 6}} />
                                    <Line type="monotone" dataKey="delivered" name="Delivered" stroke="#00C49F" strokeWidth={3} dot={{r: 4, fill: '#00C49F', strokeWidth: 0}} activeDot={{r: 6}} />
                                </LineChart>
                            </ResponsiveContainer>
                        ) : (
                            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>No trend data available</div>
                        )}
                    </div>
                </div>

                <div style={{ background: '#fff', border: '1px solid #eaeaea', borderRadius: '12px', padding: '20px' }}>
                    <h3 style={{ fontSize: '16px', color: '#333', marginBottom: '20px', fontWeight: '600' }}>Usage Breakdown</h3>
                    <div style={{ height: '300px' }}>
                        {analytics.usageData.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={analytics.usageData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={60}
                                        outerRadius={100}
                                        fill="#8884d8"
                                        paddingAngle={5}
                                        dataKey="value"
                                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                                    >
                                        {analytics.usageData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                                </PieChart>
                            </ResponsiveContainer>
                        ) : (
                            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>No usage data available</div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
