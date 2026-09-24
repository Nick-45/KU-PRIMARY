const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { db } = require('../lib/admin');
const { postTransaction } = require('./postTransactionHelper');

exports.bulkFeeEntry = onCall({ memory: '1GiB', timeoutSeconds: 540 }, async (req) => {
    const auth = req.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Login required');
    const { schoolId, studentIds, amount, description, paymentMethod, term, year,
            recordedBy, recordedByName } = req.data || {};
    if (!schoolId || !Array.isArray(studentIds) || !amount) {
        throw new HttpsError('invalid-argument', 'schoolId, studentIds, amount required');
    }
    if (studentIds.length > 2000) throw new HttpsError('invalid-argument', 'Max 2000 students');

    const results = { success: 0, failed: 0, errors: [] };
    const CONCURRENCY = 20;
    const queue = [...studentIds];

    async function worker() {
        while (queue.length) {
            const sid = queue.shift();
            try {
                const sSnap = await db.collection('students').doc(sid).get();
                if (!sSnap.exists) { results.failed++; continue; }
                const s = sSnap.data();
                await postTransaction(schoolId, {
                    studentId: sid,
                    studentName: `${s.firstName || ''} ${s.lastName || ''}`.trim(),
                    admissionNumber: s.admissionNumber || s.studentId || '',
                    amount: Number(amount),
                    type: 'payment',
                    status: 'completed',
                    paymentMethod: paymentMethod || 'bulk',
                    paymentDate: new Date().toISOString().split('T')[0],
                    description: description || 'Bulk fee entry',
                    reference: `BULK-${Date.now()}`,
                    class: s.class, level: s.level,
                    term: term || 'Term 1', year: Number(year || new Date().getFullYear()),
                    recordedBy, recordedByName
                });
                results.success++;
            } catch (err) {
                results.failed++;
                results.errors.push({ studentId: sid, error: err.message });
            }
        }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    return results;
});
