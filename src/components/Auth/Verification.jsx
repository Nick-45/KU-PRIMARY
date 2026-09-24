import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { auth } from '../../firebase';
import { sendEmailVerification } from 'firebase/auth';

export default function Verification() {
    const navigate = useNavigate();
    const { currentUser } = useAuth();
    const [timer, setTimer] = useState(30);
    const [message, setMessage] = useState({ text: '', type: '' });
    const [resendDisabled, setResendDisabled] = useState(false);

    useEffect(() => {
        if (!currentUser) {
            navigate('/login');
            return;
        }

        if (currentUser.emailVerified) {
            navigate('/dashboard');
            return;
        }

        // Start timer
        const interval = setInterval(() => {
            setTimer(prev => {
                if (prev <= 1) {
                    clearInterval(interval);
                    checkVerification();
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        // Check verification every 30 seconds
        const checkInterval = setInterval(checkVerification, 30000);

        return () => {
            clearInterval(interval);
            clearInterval(checkInterval);
        };
    }, [currentUser, navigate]);

    const checkVerification = async () => {
        try {
            await currentUser.reload();
            if (currentUser.emailVerified) {
                navigate('/dashboard');
            }
        } catch (error) {
            console.error('Error checking verification:', error);
        }
    };

    const handleResend = async () => {
        if (resendDisabled) return;
        
        setResendDisabled(true);
        try {
            await sendEmailVerification(currentUser);
            setMessage({ text: '✅ Verification email resent! Check your inbox.', type: 'success' });
            setTimer(30);
            setTimeout(() => setResendDisabled(false), 60000);
        } catch (error) {
            setMessage({ text: 'Failed to resend verification email', type: 'error' });
            setResendDisabled(false);
        }
    };

    return (
        <div className="container">
            <div className="header">
                <div className="logo-container">
                    <div className="logo"></div>
                </div>
                <h1 className="system-title">TOPLINK EDU</h1>
                <div className="system-subtitle">School Management System</div>
            </div>
            
            <div className="form-container">
                <div className="verification-section">
                    <div className="verification-icon">
                        <i className="fas fa-envelope-circle-check"></i>
                    </div>
                    <div className="verification-content">
                        <h3>Verify Your Email Address</h3>
                        <p>We've sent a verification email to:</p>
                        <div className="email-display">{currentUser?.email}</div>
                        <p>Please check your inbox and click the verification link to activate your account.</p>
                        <p><strong>Important:</strong> You must verify your email before accessing the system.</p>
                        
                        <div className="verification-timer">
                            <p>Checking verification status automatically in <span className="timer">{timer}</span> seconds...</p>
                        </div>
                        
                        {message.text && (
                            <div className={`message ${message.type}`}>
                                {message.text}
                            </div>
                        )}
                        
                        <div className="resend-link">
                            Didn't receive the email? <span onClick={handleResend} style={{ opacity: resendDisabled ? 0.5 : 1 }}>
                                {resendDisabled ? 'Wait 60s' : 'Resend Verification Email'}
                            </span>
                        </div>
                        
                        <button 
                            type="button" 
                            className="btn warning" 
                            onClick={checkVerification}
                        >
                            <i className="fas fa-sync-alt"></i>
                            <span>Check Verification Status</span>
                        </button>
                        
                        <button 
                            type="button" 
                            className="btn danger" 
                            onClick={() => auth.signOut()}
                            style={{ marginTop: '10px' }}
                        >
                            <i className="fas fa-sign-out-alt"></i>
                            <span>Logout</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
