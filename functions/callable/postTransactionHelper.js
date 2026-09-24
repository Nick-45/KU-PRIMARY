const { db, FieldValue } = require('../lib/admin');

const slug = (s) => String(s).trim().replace(/\s+/g, '_').replace(/[\/\\.#$\[\]]/g, '');
const balanceId = (studentId, term, year) => `${slug(studentId)}__${slug(term)}__${slug(year)}`;

async function postTransaction(schoolId, txn, opts = {}) {
    const idemKey = txn.idempotencyKey ||
        `${slug(schoolId)}__${slug(txn.studentId)}__${slug(txn.amount)}__${slug(txn.paymentDate || '')}`;
    const txnRef = db.collection('fee_transactions').doc(idemKey);
    const balRef = db.collection('student_balances').doc(balanceId(txn.studentId, txn.term, txn.year));

    return db.runTransaction(async (trx) => {
        const existing = await trx.get(txnRef);
        if (existing.exists) return { id: idemKey, alreadyExisted: true };

        const balSnap = await trx.get(balRef);
        const cur = balSnap.exists ? balSnap.data() : {
            studentId: txn.studentId, studentName: txn.studentName,
            admissionNumber: txn.admissionNumber, studentClass: txn.class,
            level: txn.level, term: txn.term, year: txn.year, schoolId,
            totalInvoiced: 0, totalPaid: 0, totalDiscount: 0, totalWaived: 0,
            balance: 0, status: 'no_invoice'
        };

        const isPay = txn.type === 'payment' && (txn.status === 'completed' || txn.status === 'success');
        const isRefund = txn.type === 'refund' || txn.type === 'reversal';
        const isDisc = txn.type === 'discount';
        const isWaive = txn.type === 'waiver';

        const deltaPaid = isPay ? txn.amount : isRefund ? -Math.abs(txn.amount) : 0;
        const deltaDisc = isDisc ? txn.amount : 0;
        const deltaWaive = isWaive ? txn.amount : 0;

        const totalPaid = (cur.totalPaid || 0) + deltaPaid;
        const totalDiscount = (cur.totalDiscount || 0) + deltaDisc;
        const totalWaived = (cur.totalWaived || 0) + deltaWaive;
        const balance = (cur.totalInvoiced || 0) - totalPaid - totalDiscount - totalWaived;
        let status = 'pending';
        if ((cur.totalInvoiced || 0) === 0) status = 'no_invoice';
        else if (balance <= 0) status = 'paid';
        else if (totalPaid + totalDiscount + totalWaived > 0) status = 'partial';

        trx.set(txnRef, {
            ...txn, schoolId, idempotencyKey: idemKey,
            createdAt: FieldValue.serverTimestamp(),
            voided: false
        });

        trx.set(balRef, {
            ...cur, totalPaid, totalDiscount, totalWaived, balance, status,
            lastTransactionAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });

        // Update invoice if linked
        if (txn.invoiceId && isPay) {
            const invRef = db.collection('invoices').doc(txn.invoiceId);
            const invSnap = await trx.get(invRef);
            if (invSnap.exists) {
                const inv = invSnap.data();
                const newPaid = (inv.paidAmount || 0) + txn.amount;
                const remaining = Math.max(0, (inv.total || 0) - newPaid);
                const invStatus = remaining <= 0 ? 'paid'
                    : inv.status === 'overdue' ? 'overdue'
                    : newPaid > 0 ? 'partial' : 'pending';
                trx.update(invRef, {
                    paidAmount: newPaid, remainingBalance: remaining, status: invStatus,
                    payments: [...(inv.payments || []), {
                        amount: txn.amount, date: txn.paymentDate || new Date().toISOString(),
                        method: txn.paymentMethod, transactionId: idemKey, notes: txn.description || ''
                    }],
                    updatedAt: FieldValue.serverTimestamp(),
                    ...(invStatus === 'paid' ? { paidAt: FieldValue.serverTimestamp() } : {})
                });
            }
        }

        // Audit
        const auditRef = db.collection('fee_audit_log').doc();
        trx.set(auditRef, {
            schoolId, action: 'POST_TRANSACTION', transactionId: idemKey,
            studentId: txn.studentId, amount: txn.amount, type: txn.type,
            performedBy: opts.performedBy || txn.recordedBy || 'system',
            performedByName: opts.performedByName || txn.recordedByName || 'System',
            timestamp: FieldValue.serverTimestamp()
        });

        return { id: idemKey, alreadyExisted: false };
    });
}

module.exports = { postTransaction };
