import React, { useState, useEffect } from 'react';

export default function LoadingSpinner({ fullScreen = false, text = 'Loading...' }) {
    const [progress, setProgress] = useState(0);

    useEffect(() => {
        const interval = setInterval(() => {
            setProgress(prev => {
                if (prev >= 100) {
                    clearInterval(interval);
                    return 100;
                }
                return prev + 2; // Increase progress by 2% every interval
            });
        }, 50);

        return () => clearInterval(interval);
    }, []);

    const style = fullScreen ? {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(255,255,255,0.95)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 9999
    } : {
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '40px',
        width: '100%'
    };

    return (
        <div style={style}>
            {/* Animated Logo */}
            <div className="logo-container">
                <img 
                    src="/Logo.png" 
                    alt="Logo" 
                    className="animated-logo"
                />
            </div>

            {/* Loading Bar */}
            <div className="loading-bar-container">
                <div 
                    className="loading-bar-fill" 
                    style={{ width: `${progress}%` }}
                ></div>
            </div>
            
            {text && <div className="loading-text">{text}</div>}
        </div>
    );
}
