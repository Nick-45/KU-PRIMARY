// netlify/functions/mpesa-callback.js
const { initAdmin } = require('./_lib/firebaseAdmin');

const slug = (s) => String(s || '').trim().replace(/\s+/g, '_').replace(/[/#$[\]\\]/g, '');
const makeBalanceId = (studentId, term, year) => `${slug(studentId)}__${slug(term)}__${slug(year)}`;

exports.handler = async (event) => {
    // Safaricom sends POST requests. Always return 200 OK so Safaricom doesn't endlessly retry.
    if (event.httpMethod !== 'POST') {
        return ok({ message: 'Method not allowed' });
    }

    let admin, db;
    try {
        admin = initAdmin();
        db = admin.firestore();
    } catch (e) {
        console.error('Firebase Admin init failed in callback handler:', e.message);
        return ok({ message: 'Server not ready' });
    }

    let body;
    try {
        body = JSON.parse(event.body || '{}');
    } catch (e) {
        console.error('Invalid callback JSON:', event.body);
        return ok({ message: 'Invalid JSON' });
    }

    const stkCallback = body?.Body?.stkCallback;
    if (!stkCallback) {
        console.error('Missing Body.stkCallback in payload');
        return ok({ message: 'Ignored — malformed payload' });
    }

    const {
        MerchantRequestID,
        CheckoutRequestID,
        ResultCode,
        ResultDesc
    } = stkCallback;

    console.log(
        `[M-PESA CALLBACK] CheckoutRequestID=${CheckoutRequestID} ` +
        `MerchantRequestID=${MerchantRequestID} Result=${ResultCode} (${ResultDesc})`
    );

    if (!CheckoutRequestID) {
        return ok({ message: 'Missing CheckoutRequestID' });
    }

    const deterministicTxnId = `MPESA_${CheckoutRequestID}`;
    const pendingRef = db.collection('mpesa_pending_transactions').doc(CheckoutRequestID);
    const txnRef = db.collection('fee_transactions').doc(deterministicTxnId);

    try {
        // -------------------------------------------------------------
        // 1. Race condition tolerance: pending doc might be writing
        // -------------------------------------------------------------
        let pendingSnap = await pendingRef.get();
        let attempts = 0;
        while (!pendingSnap.exists && attempts < 4) {
            await new Promise((r) => setTimeout(r, 600));
            attempts++;
            pendingSnap = await pendingRef.get();
            if (pendingSnap.exists) break;
        }

        const pending = pendingSnap.exists ? pendingSnap.data() : null;

        // -------------------------------------------------------------
        // 2. IDEMPOTENCY CHECK: Tolerates duplicate callbacks
        // NEVER create duplicate transactions because a callback is retried.
        // -------------------------------------------------------------
        const existingTxnSnap = await txnRef.get();
        if (existingTxnSnap.exists) {
            const existingTxn = existingTxnSnap.data();
            if (existingTxn.status === 'completed' || existingTxn.status === 'failed') {
                console.log(`[IDEMPOTENCY] Transaction ${deterministicTxnId} already finalized as status=${existingTxn.status}. Skipping duplicate callback.`);
                // Update pending doc retry count without touching financial records
                if (pendingSnap.exists) {
                    await pendingRef.update({
                        duplicateCallbackReceivedAt: admin.firestore.FieldValue.serverTimestamp(),
                        duplicateCount: (pending.duplicateCount || 0) + 1
                    }).catch(() => {});
                }
                return ok({ message: 'Already processed', duplicate: true });
            }
        }

        if (pending && (pending.status === 'completed' || pending.status === 'failed')) {
            console.log(`[IDEMPOTENCY] Pending doc ${CheckoutRequestID} already status=${pending.status}. Skipping duplicate callback.`);
            return ok({ message: 'Already processed', duplicate: true });
        }

        // -------------------------------------------------------------
        // 3. Process ResultCode
        // -------------------------------------------------------------
        if (ResultCode === 0) {
            // SUCCESS
            const items = stkCallback.CallbackMetadata?.Item || [];
            const getVal = (name) => items.find((i) => i.Name === name)?.Value;

            const receiptNumber = String(getVal('MpesaReceiptNumber') || '').trim();
            const paidAmount = Number(getVal('Amount') ?? (pending ? pending.amount : 0));
            const paidPhone = String(getVal('PhoneNumber') ?? (pending ? pending.phoneNumber : ''));
            const transactionDate = getVal('TransactionDate') ? String(getVal('TransactionDate')) : null;

            const schoolId = pending?.schoolId || existingTxnSnap.data()?.schoolId;
            const studentId = pending?.studentId || existingTxnSnap.data()?.studentId;
            const term = pending?.term || existingTxnSnap.data()?.term || 'Term 1';
            const year = Number(pending?.year || existingTxnSnap.data()?.year || new Date().getFullYear());
            const studentName = pending?.studentName || existingTxnSnap.data()?.studentName || '';
            const admissionNumber = pending?.admissionNumber || existingTxnSnap.data()?.admissionNumber || '';
            const studentClass = pending?.class || existingTxnSnap.data()?.class || '';
            const studentLevel = pending?.level || existingTxnSnap.data()?.level || '';
            const invoiceId = pending?.invoiceId || existingTxnSnap.data()?.invoiceId || null;

            if (!schoolId || !studentId) {
                console.error(`[M-PESA ERROR] Missing schoolId or studentId for CheckoutRequestID=${CheckoutRequestID}`);
                return ok({ message: 'Missing schoolId or studentId context' });
            }

            const balDocId = makeBalanceId(studentId, term, year);
            const balRef = db.collection('student_balances').doc(balDocId);
            const receiptDocId = `RCP_MPESA_${receiptNumber || CheckoutRequestID}`;
            const receiptRef = db.collection('receipts').doc(receiptDocId);
            const auditRef = db.collection('fee_audit_log').doc(`AUDIT_MPESA_${CheckoutRequestID}`);

            // ATOMIC LEDGER MUTATION
            await db.runTransaction(async (trx) => {
                const innerTxnSnap = await trx.get(txnRef);
                if (innerTxnSnap.exists && innerTxnSnap.data().status === 'completed') {
                    return; // Already completed in parallel
                }

                // A. Read current balance
                const balSnap = await trx.get(balRef);
                const curBal = balSnap.exists ? balSnap.data() : {
                    studentId,
                    studentName,
                    admissionNumber,
                    studentClass,
                    level: studentLevel,
                    term,
                    year,
                    schoolId,
                    totalInvoiced: 0,
                    totalPaid: 0,
                    totalDiscount: 0,
                    totalWaived: 0,
                    balance: 0,
                    status: 'no_invoice'
                };

                const totalInvoiced = curBal.totalInvoiced || 0;
                const totalPaid = (curBal.totalPaid || 0) + paidAmount;
                const totalDiscount = curBal.totalDiscount || 0;
                const totalWaived = curBal.totalWaived || 0;
                const newBalance = totalInvoiced - totalPaid - totalDiscount - totalWaived;

                let balStatus = 'pending';
                if (totalInvoiced === 0) balStatus = 'no_invoice';
                else if (newBalance <= 0) balStatus = 'paid';
                else if (totalPaid + totalDiscount + totalWaived > 0) balStatus = 'partial';

                // B. Update / Create fee_transactions (AUTHORITATIVE LEDGER)
                const txnData = {
                    idempotencyKey: deterministicTxnId,
                    reference: receiptNumber || CheckoutRequestID,
                    mpesaReceiptNumber: receiptNumber,
                    mpesaResultCode: ResultCode,
                    mpesaResultDesc: ResultDesc,
                    mpesaTransactionDate: transactionDate,
                    schoolId,
                    studentId,
                    studentName,
                    admissionNumber,
                    class: studentClass,
                    level: studentLevel,
                    term,
                    year,
                    amount: paidAmount,
                    type: 'payment',
                    status: 'completed',
                    paymentMethod: 'mpesa',
                    source: 'mpesa_stk',
                    checkoutRequestID: CheckoutRequestID,
                    merchantRequestID: MerchantRequestID || '',
                    phoneNumber: paidPhone,
                    description: pending?.description || `M-Pesa Fee Payment (Ref: ${receiptNumber})`,
                    invoiceId: invoiceId || null,
                    actor: {
                        uid: 'safaricom_callback',
                        name: 'M-Pesa Daraja Gateway',
                        source: 'mpesa_stk_callback'
                    },
                    recordedBy: 'system',
                    recordedByName: 'M-Pesa System',
                    voided: false,
                    completedAt: admin.firestore.FieldValue.serverTimestamp(),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                };
                trx.set(txnRef, txnData, { merge: true });

                // C. Update student_balances
                trx.set(balRef, {
                    ...curBal,
                    schoolId,
                    studentId,
                    studentName,
                    admissionNumber,
                    studentClass,
                    level: studentLevel,
                    term,
                    year,
                    totalInvoiced,
                    totalPaid,
                    totalDiscount,
                    totalWaived,
                    balance: newBalance,
                    status: balStatus,
                    lastPaymentDate: new Date().toISOString().split('T')[0],
                    lastPaymentAmount: paidAmount,
                    lastPaymentMethod: 'mpesa',
                    lastTransactionId: deterministicTxnId,
                    lastTransactionAt: admin.firestore.FieldValue.serverTimestamp(),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });

                // D. Allocate payment to invoice if applicable
                if (invoiceId) {
                    const invRef = db.collection('invoices').doc(invoiceId);
                    const invSnap = await trx.get(invRef);
                    if (invSnap.exists) {
                        const inv = invSnap.data();
                        const newPaidOnInv = (inv.paidAmount || 0) + paidAmount;
                        const remaining = Math.max(0, (inv.total || 0) - newPaidOnInv);
                        const invStatus = remaining <= 0 ? 'paid'
                            : inv.status === 'overdue' ? 'overdue'
                            : newPaidOnInv > 0 ? 'partial' : 'pending';

                        trx.update(invRef, {
                            paidAmount: newPaidOnInv,
                            remainingBalance: remaining,
                            status: invStatus,
                            payments: [
                                ...(inv.payments || []),
                                {
                                    amount: paidAmount,
                                    date: new Date().toISOString(),
                                    method: 'mpesa',
                                    transactionId: deterministicTxnId,
                                    reference: receiptNumber,
                                    notes: `M-Pesa Payment ${receiptNumber}`
                                }
                            ],
                            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                            ...(invStatus === 'paid' ? { paidAt: admin.firestore.FieldValue.serverTimestamp() } : {})
                        });
                    }
                }

                // E. Create formal immutable Receipt record
                trx.set(receiptRef, {
                    receiptNumber: receiptNumber ? `RCP-${receiptNumber}` : `RCP-${CheckoutRequestID.slice(-8)}`,
                    schoolId,
                    studentId,
                    studentName,
                    admissionNumber,
                    studentClass,
                    level: studentLevel,
                    amount: paidAmount,
                    paymentMethod: 'mpesa',
                    reference: receiptNumber,
                    mpesaReceiptNumber: receiptNumber,
                    transactionId: deterministicTxnId,
                    term,
                    year,
                    status: 'valid',
                    issuedBy: 'M-Pesa System',
                    issuedByName: 'M-Pesa Daraja Gateway',
                    issuedAt: admin.firestore.FieldValue.serverTimestamp(),
                    createdAt: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });

                // F. Append to fee_audit_log
                trx.set(auditRef, {
                    schoolId,
                    action: 'MPESA_PAYMENT_COMPLETED',
                    transactionId: deterministicTxnId,
                    receiptNumber: receiptNumber ? `RCP-${receiptNumber}` : `RCP-${CheckoutRequestID.slice(-8)}`,
                    studentId,
                    amount: paidAmount,
                    previousBalance: curBal.balance || 0,
                    newBalance,
                    actor: {
                        uid: 'safaricom_callback',
                        name: 'M-Pesa Daraja Gateway',
                        source: 'mpesa_stk'
                    },
                    source: 'mpesa_stk',
                    status: 'completed',
                    metadata: {
                        checkoutRequestId: CheckoutRequestID,
                        merchantRequestId: MerchantRequestID || '',
                        phoneNumber: paidPhone,
                        mpesaReceiptNumber: receiptNumber,
                        transactionDate
                    },
                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                });

                // G. Update pending transaction (NEVER DELETE - keeps state for idempotency)
                trx.set(pendingRef, {
                    status: 'completed',
                    mpesaReceiptNumber: receiptNumber,
                    mpesaResultCode: ResultCode,
                    mpesaResultDesc: ResultDesc,
                    amountPaid: paidAmount,
                    completedAt: admin.firestore.FieldValue.serverTimestamp(),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
            });

            console.log(`[M-PESA SUCCESS] Finalized payment ${receiptNumber} KES ${paidAmount} for student ${studentId}`);
        } else {
            // FAILURE or USER CANCELLED
            console.log(`[M-PESA FAILED] ${CheckoutRequestID} Result=${ResultCode}: ${ResultDesc}`);

            const auditRef = db.collection('fee_audit_log').doc(`AUDIT_MPESA_${CheckoutRequestID}_FAIL`);
            const schoolId = pending?.schoolId || existingTxnSnap.data()?.schoolId || 'unknown';
            const studentId = pending?.studentId || existingTxnSnap.data()?.studentId || 'unknown';

            const batch = db.batch();
                        let finalStatus = 'failed';
            if (ResultCode === 1032) finalStatus = 'Cancelled';
            else if (ResultCode === 1037) finalStatus = 'timeout';
            else if (ResultCode === 1) finalStatus = 'insufficient balance';
            batch.set(txnRef, {
                idempotencyKey: deterministicTxnId,
                schoolId,
                studentId,
                status: finalStatus,
                mpesaResultCode: ResultCode,
                mpesaResultDesc: ResultDesc,
                failedAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            batch.set(pendingRef, {
                status: finalStatus,
                mpesaResultCode: ResultCode,
                mpesaResultDesc: ResultDesc,
                failedAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            batch.set(auditRef, {
                schoolId,
                action: 'MPESA_PAYMENT_FAILED',
                transactionId: deterministicTxnId,
                studentId,
                status: 'failed',
                source: 'mpesa_stk',
                actor: {
                    uid: 'safaricom_callback',
                    name: 'M-Pesa Daraja Gateway',
                    source: 'mpesa_stk'
                },
                metadata: {
                    checkoutRequestId: CheckoutRequestID,
                    resultCode: ResultCode,
                    resultDesc: ResultDesc
                },
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });

            await batch.commit();
        }

        return ok({ message: 'Callback processed successfully' });
    } catch (err) {
        console.error('Unexpected error in mpesa-callback:', err);
        return ok({ message: 'Logged error' });
    }
};

function ok(body) {
    return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    };
}
