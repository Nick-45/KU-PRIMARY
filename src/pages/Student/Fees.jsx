// src/pages/Student/Fees.jsx
import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useFee } from '../../context/FeeContext';
import Layout from '../../components/Layout/Layout';
import LoadingSpinner from '../../components/Common/LoadingSpinner';

export default function StudentFees() {
    const { currentUser, userData } = useAuth();
    const { feeTransactions, getStudentBalance } = useFee();
    const [balance, setBalance] = useState(null);
    const [transactions, setTransactions] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (currentUser?.uid) {
            loadStudentData();
        }
    }, [currentUser]);

    const loadStudentData = () => {
        setLoading(true);
        try {
            // Get student balance
            const studentBalance = getStudentBalance(currentUser.uid);
            setBalance(studentBalance);
            
            // Get student transactions
            const studentTransactions = feeTransactions.filter(
                t => t.studentId === currentUser.uid
            );
            setTransactions(studentTransactions);
        } catch (error) {
            console.error('Error loading student data:', error);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return <LoadingSpinner fullScreen text="Loading fee details..." />;
    }

    return (
        <Layout title="My Fees">
            <div style={{ padding: '20px' }}>
                {/* Balance Summary */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: '20px',
                    marginBottom: '30px'
                }}>
                    <div style={{
                        background: 'white',
                        borderRadius: '12px',
                        padding: '20px',
                        boxShadow: 'var(--shadow)'
                    }}>
                        <div style={{ fontSize: '13px', color: 'var(--gray)', textTransform: 'uppercase', fontWeight: '500' }}>
                            Total Due
                        </div>
                        <div style={{ fontSize: '28px', fontWeight: '700', color: 'var(--secondary)', marginTop: '5px' }}>
                            KES {balance?.totalDue?.toLocaleString() || '0'}
                        </div>
                    </div>
                    <div style={{
                        background: 'white',
                        borderRadius: '12px',
                        padding: '20px',
                        boxShadow: 'var(--shadow)'
                    }}>
                        <div style={{ fontSize: '13px', color: 'var(--gray)', textTransform: 'uppercase', fontWeight: '500' }}>
                            Total Paid
                        </div>
                        <div style={{ fontSize: '28px', fontWeight: '700', color: 'var(--success)', marginTop: '5px' }}>
                            KES {balance?.totalPaid?.toLocaleString() || '0'}
                        </div>
                    </div>
                    <div style={{
                        background: 'white',
                        borderRadius: '12px',
                        padding: '20px',
                        boxShadow: 'var(--shadow)'
                    }}>
                        <div style={{ fontSize: '13px', color: 'var(--gray)', textTransform: 'uppercase', fontWeight: '500' }}>
                            Balance
                        </div>
                        <div style={{ 
                            fontSize: '28px', 
                            fontWeight: '700', 
                            color: balance?.balance > 0 ? 'var(--danger)' : 'var(--success)',
                            marginTop: '5px'
                        }}>
                            KES {balance?.balance?.toLocaleString() || '0'}
                        </div>
                    </div>
                    <div style={{
                        background: 'white',
                        borderRadius: '12px',
                        padding: '20px',
                        boxShadow: 'var(--shadow)'
                    }}>
                        <div style={{ fontSize: '13px', color: 'var(--gray)', textTransform: 'uppercase', fontWeight: '500' }}>
                            Status
                        </div>
                        <div style={{ 
                            fontSize: '28px', 
                            fontWeight: '700', 
                            color: balance?.status === 'paid' ? 'var(--success)' : 'var(--danger)',
                            marginTop: '5px'
                        }}>
                            {balance?.status === 'paid' ? '✅ Paid' : '⚠️ Pending'}
                        </div>
                    </div>
                </div>

                {/* Transaction History */}
                <div style={{
                    background: 'white',
                    borderRadius: '12px',
                    boxShadow: 'var(--shadow)',
                    overflow: 'hidden'
                }}>
                    <div style={{ padding: '20px', borderBottom: '1px solid var(--border)' }}>
                        <h3 style={{ fontSize: '18px', color: 'var(--secondary)' }}>
                            <i className="fas fa-history"></i> Transaction History
                        </h3>
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                        {transactions.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--gray)' }}>
                                <i className="fas fa-info-circle" style={{ fontSize: '48px', display: 'block', marginBottom: '15px', color: 'var(--border)' }}></i>
                                No transactions found
                            </div>
                        ) : (
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ background: 'var(--light)' }}>
                                        <th style={{ padding: '12px 20px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: 'var(--gray)' }}>Date</th>
                                        <th style={{ padding: '12px 20px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: 'var(--gray)' }}>Description</th>
                                        <th style={{ padding: '12px 20px', textAlign: 'right', fontSize: '12px', fontWeight: '600', color: 'var(--gray)' }}>Amount</th>
                                        <th style={{ padding: '12px 20px', textAlign: 'center', fontSize: '12px', fontWeight: '600', color: 'var(--gray)' }}>Method</th>
                                        <th style={{ padding: '12px 20px', textAlign: 'center', fontSize: '12px', fontWeight: '600', color: 'var(--gray)' }}>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {transactions.map(t => (
                                        <tr key={t.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                            <td style={{ padding: '12px 20px' }}>
                                                {t.paymentDate ? new Date(t.paymentDate).toLocaleDateString() : 'N/A'}
                                            </td>
                                            <td style={{ padding: '12px 20px' }}>{t.description || 'N/A'}</td>
                                            <td style={{ padding: '12px 20px', textAlign: 'right', fontWeight: '600' }}>
                                                KES {t.amount?.toLocaleString() || '0'}
                                            </td>
                                            <td style={{ padding: '12px 20px', textAlign: 'center' }}>
                                                <span style={{
                                                    padding: '2px 10px',
                                                    borderRadius: '12px',
                                                    fontSize: '11px',
                                                    background: t.paymentMethod === 'mpesa' ? '#d1ecf1' : 
                                                               t.paymentMethod === 'cash' ? '#d4edda' : '#fff3cd',
                                                    color: t.paymentMethod === 'mpesa' ? '#0c5460' : 
                                                           t.paymentMethod === 'cash' ? '#155724' : '#856404'
                                                }}>
                                                    {t.paymentMethod || 'N/A'}
                                                </span>
                                            </td>
                                            <td style={{ padding: '12px 20px', textAlign: 'center' }}>
                                                <span style={{
                                                    padding: '2px 10px',
                                                    borderRadius: '12px',
                                                    fontSize: '11px',
                                                    background: t.status === 'completed' ? '#d4edda' : 
                                                               t.status === 'pending' ? '#fff3cd' : '#f8d7da',
                                                    color: t.status === 'completed' ? '#155724' : 
                                                           t.status === 'pending' ? '#856404' : '#721c24'
                                                }}>
                                                    {t.status || 'N/A'}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>

                {/* Payment Methods Info */}
                <div style={{
                    marginTop: '30px',
                    padding: '20px',
                    background: 'white',
                    borderRadius: '12px',
                    boxShadow: 'var(--shadow)'
                }}>
                    <h3 style={{ fontSize: '18px', color: 'var(--secondary)', marginBottom: '15px' }}>
                        <i className="fas fa-credit-card"></i> Payment Methods
                    </h3>
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                        gap: '15px'
                    }}>
                        <div style={{ padding: '15px', background: 'var(--light)', borderRadius: '8px', textAlign: 'center' }}>
                            <i className="fas fa-money-bill-wave" style={{ fontSize: '32px', color: 'var(--primary)', display: 'block', marginBottom: '10px' }}></i>
                            <h4 style={{ fontSize: '14px', color: 'var(--secondary)' }}>Cash</h4>
                            <p style={{ fontSize: '12px', color: 'var(--gray)' }}>Pay at the school office</p>
                        </div>
                        <div style={{ padding: '15px', background: 'var(--light)', borderRadius: '8px', textAlign: 'center' }}>
                            <i className="fas fa-mobile-alt" style={{ fontSize: '32px', color: '#25D366', display: 'block', marginBottom: '10px' }}></i>
                            <h4 style={{ fontSize: '14px', color: 'var(--secondary)' }}>M-Pesa</h4>
                            <p style={{ fontSize: '12px', color: 'var(--gray)' }}>Pay via mobile money</p>
                        </div>
                        <div style={{ padding: '15px', background: 'var(--light)', borderRadius: '8px', textAlign: 'center' }}>
                            <i className="fas fa-university" style={{ fontSize: '32px', color: 'var(--primary)', display: 'block', marginBottom: '10px' }}></i>
                            <h4 style={{ fontSize: '14px', color: 'var(--secondary)' }}>Bank Transfer</h4>
                            <p style={{ fontSize: '12px', color: 'var(--gray)' }}>Direct bank deposit</p>
                        </div>
                        <div style={{ padding: '15px', background: 'var(--light)', borderRadius: '8px', textAlign: 'center' }}>
                            <i className="fas fa-credit-card" style={{ fontSize: '32px', color: 'var(--accent)', display: 'block', marginBottom: '10px' }}></i>
                            <h4 style={{ fontSize: '14px', color: 'var(--secondary)' }}>Card Payment</h4>
                            <p style={{ fontSize: '12px', color: 'var(--gray)' }}>Visa, Mastercard, etc.</p>
                        </div>
                    </div>
                </div>
            </div>
        </Layout>
    );
}
