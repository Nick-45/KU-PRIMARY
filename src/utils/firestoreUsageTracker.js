// utils/firestoreUsageTracker.js
import { db } from '../firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

export const initializeUsageTracker = async () => {
    try {
        const usageDoc = doc(db, '_usage_stats', 'daily_usage');
        await setDoc(usageDoc, {
            totalReads: 0,
            totalWrites: 0,
            initializedAt: serverTimestamp()
        }, { merge: true });
        console.log('Usage tracker initialized');
    } catch (error) {
        console.error('Error initializing usage tracker:', error);
    }
};

export const trackRead = async (count = 1) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const usageDoc = doc(db, '_usage_stats', 'daily_usage');
        const docSnap = await getDoc(usageDoc);
        const currentData = docSnap.exists() ? docSnap.data() : {};
        const todayData = currentData[today] || { reads: 0, writes: 0, deletes: 0 };
        
        await setDoc(usageDoc, {
            [today]: {
                ...todayData,
                reads: (todayData.reads || 0) + count,
                lastUpdated: serverTimestamp()
            },
            totalReads: (currentData.totalReads || 0) + count
        }, { merge: true });
    } catch (error) {
        console.warn('Failed to track read:', error);
    }
};
