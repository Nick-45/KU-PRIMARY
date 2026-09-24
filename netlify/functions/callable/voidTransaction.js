const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { db, FieldValue } = require('../lib/admin');
const { postTransaction } = require('./postTransactionHelper');

exports.voidTransaction = onCall(async (req) => {
    const auth = req.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Login required');
    const { schoolId, txnId, reason, performedByName } = req.data || {};
    if (!schoolId || !txnId || !reason) throw new HttpsError('invalid-argument', 'Missing fields');

    const txnRef = db.collection('fee_transactions').doc(txnId);
    const snap = await txnRef.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Transaction not found');
    const txn = snap.data();
    if (txn.schoolId !== schoolId) throw new HttpsError('permission-denied', 'Cross-tenant');
    if (txn.voided) throw new HttpsError('failed-precondition', 'Already voided');

    // Reversal entry (negative amount)
    await postTransaction(schoolId, {
        ...txn,
        amount: -Math.abs(txn.amount),
        type: 'reversal',
        description: `VOID: ${reason}`,
        idempotencyKey: `${txnId}__VOID__${Date.now()}`,
        reversalOf: txnId,
        recordedBy: auth.uid,
        recordedByName: performedByName || 'System'
    });

    await txnRef.update({
        voided: true,
        voidedAt: FieldValue.serverTimestamp(),
        voidedBy: auth.uid,
        voidReason: reason
    });

    return { success: true };
});
