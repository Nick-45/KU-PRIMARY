import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import LoadingSpinner from './LoadingSpinner';

export default function ProtectedRoute({ children, allowedRoles }) {
    let currentUser = null;
    let userRole = null;
    let loading = true;
    let authError = false;

    try {
        const auth = useAuth();
        currentUser = auth.currentUser;
        userRole = auth.userRole;
        loading = auth.loading || false;
    } catch (error) {
        // Auth context not available yet
        console.warn('Auth context not available:', error.message);
        authError = true;
    }

    if (authError || loading) {
        return <LoadingSpinner fullScreen text="Authenticating..." />;
    }

    if (!currentUser) {
        return <Navigate to="/login" replace />;
    }

    if (allowedRoles && !allowedRoles.includes(userRole)) {
        // Redirect to appropriate dashboard based on role
        const roleDashboards = {
            'admin': '/dashboard',
            'teacher': '/mydashboard',
            'student': '/student-dashboard',
            'super-admin': '/platformtower'
        };
        const redirectPath = roleDashboards[userRole] || '/dashboard';
        return <Navigate to={redirectPath} replace />;
    }

    return children;
}
