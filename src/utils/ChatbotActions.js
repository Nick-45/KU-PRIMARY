// src/utils/ChatbotActions.js
import { auth } from '../firebase'; // You might need to adjust imports based on project structure

/**
 * Executes API calls to actual Netlify functions
 */

export const triggerSTKPush = async (phone, amount, admissionNumber, schoolId) => {
    try {
        const token = await auth.currentUser.getIdToken();
        const response = await fetch('/.netlify/functions/mpesa-stk-push', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ 
                phoneNumber: phone, 
                amount, 
                studentId: admissionNumber, // Assuming studentId map
                admissionNumber,
                schoolId 
            })
        });
        const data = await response.json();
        return { success: data.success, message: data.message || 'STK Push sent.' };
    } catch (err) {
        return { success: false, message: 'Failed to initiate payment: ' + err.message };
    }
};

export const fetchFeeBalance = async (admissionNumber, schoolId) => {
    try {
        const token = await auth.currentUser.getIdToken();
        const response = await fetch('/.netlify/functions/get-student-balance', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ admissionNumber, schoolId })
        });
        const data = await response.json();
        return { success: data.success, balance: data.balance ? `KES ${Number(data.balance).toLocaleString()}` : 'Not found' };
    } catch (err) {
        return { success: false, balance: 'Error fetching balance' };
    }
};

export const fetchDailyCollections = async (schoolId) => {
    // Assuming a report generation endpoint exists
    try {
        const token = await auth.currentUser.getIdToken();
        // Placeholder, assuming this endpoint exists based on list of functions
        const response = await fetch('/.netlify/functions/reports-rollup', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ schoolId })
        });
        const data = await response.json();
        return { success: true, today: data.today || 'KES 0', week: data.week || 'KES 0' };
    } catch (err) {
        return { success: false, today: 'Error', week: 'Error' };
    }
};
