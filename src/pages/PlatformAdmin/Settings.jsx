// src/pages/PlatformAdmin/Settings.jsx
import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import Layout from '../../components/Layout/Layout';
import LoadingSpinner from '../../components/Common/LoadingSpinner';

export default function PlatformSettings() {
    const { userData, currentUser } = useAuth();
    const [loading, setLoading] = useState(false);
    const [settings, setSettings] = useState({
        systemName: 'EDUPRIVA',
        systemEmail: 'admin@edupriva.com',
        maintenanceMode: false,
        allowRegistration: true,
        defaultSubscriptionDays: 30
    });

    const handleSave = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            // Save settings logic here
            // This would typically save to Firestore
            console.log('Settings saved:', settings);
            alert('Settings saved successfully!');
        } catch (error) {
            console.error('Error saving settings:', error);
            alert('Failed to save settings');
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return <LoadingSpinner fullScreen text="Loading settings..." />;
    }

    return (
        <Layout title="Platform Settings">
            <div style={{ padding: '20px' }}>
                <div style={{
                    background: 'white',
                    borderRadius: '12px',
                    padding: '25px',
                    boxShadow: 'var(--shadow)',
                    maxWidth: '800px',
                    margin: '0 auto'
                }}>
                    <h2 style={{ marginBottom: '20px', color: 'var(--secondary)' }}>
                        <i className="fas fa-cog"></i> Platform Settings
                    </h2>
                    
                    <form onSubmit={handleSave}>
                        <div style={{ marginBottom: '20px' }}>
                            <label style={{ display: 'block', fontWeight: '600', marginBottom: '5px' }}>
                                System Name
                            </label>
                            <input
                                type="text"
                                value={settings.systemName}
                                onChange={(e) => setSettings({...settings, systemName: e.target.value})}
                                style={{
                                    width: '100%',
                                    padding: '10px 15px',
                                    border: '2px solid var(--border)',
                                    borderRadius: '8px',
                                    fontSize: '14px'
                                }}
                            />
                        </div>

                        <div style={{ marginBottom: '20px' }}>
                            <label style={{ display: 'block', fontWeight: '600', marginBottom: '5px' }}>
                                System Email
                            </label>
                            <input
                                type="email"
                                value={settings.systemEmail}
                                onChange={(e) => setSettings({...settings, systemEmail: e.target.value})}
                                style={{
                                    width: '100%',
                                    padding: '10px 15px',
                                    border: '2px solid var(--border)',
                                    borderRadius: '8px',
                                    fontSize: '14px'
                                }}
                            />
                        </div>

                        <div style={{ marginBottom: '20px' }}>
                            <label style={{ display: 'block', fontWeight: '600', marginBottom: '5px' }}>
                                Default Trial Days
                            </label>
                            <input
                                type="number"
                                value={settings.defaultSubscriptionDays}
                                onChange={(e) => setSettings({...settings, defaultSubscriptionDays: parseInt(e.target.value)})}
                                style={{
                                    width: '100%',
                                    padding: '10px 15px',
                                    border: '2px solid var(--border)',
                                    borderRadius: '8px',
                                    fontSize: '14px'
                                }}
                            />
                        </div>

                        <div style={{ marginBottom: '20px' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                                <input
                                    type="checkbox"
                                    checked={settings.maintenanceMode}
                                    onChange={(e) => setSettings({...settings, maintenanceMode: e.target.checked})}
                                    style={{ width: '18px', height: '18px' }}
                                />
                                <span style={{ fontWeight: '600' }}>Maintenance Mode</span>
                            </label>
                        </div>

                        <div style={{ marginBottom: '20px' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                                <input
                                    type="checkbox"
                                    checked={settings.allowRegistration}
                                    onChange={(e) => setSettings({...settings, allowRegistration: e.target.checked})}
                                    style={{ width: '18px', height: '18px' }}
                                />
                                <span style={{ fontWeight: '600' }}>Allow New School Registration</span>
                            </label>
                        </div>

                        <button
                            type="submit"
                            style={{
                                padding: '12px 24px',
                                background: 'var(--primary)',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                fontSize: '16px',
                                fontWeight: '600',
                                cursor: 'pointer',
                                transition: 'all 0.3s'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--primary-dark)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'var(--primary)'}
                        >
                            <i className="fas fa-save"></i> Save Settings
                        </button>
                    </form>
                </div>
            </div>
        </Layout>
    );
}
