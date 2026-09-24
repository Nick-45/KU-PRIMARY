const { db, FieldValue } = require('../lib/admin');

const slug = (s) => String(s).trim().replace(/\s+/g, '_').replace(/[\/\\.#$\[\]]/g, '');
const summaryId = (schoolId, term, year) => `${slug(schoolId)}__${slug(term)}__${slug(year)}`;

exports.onInvoiceWrite = require('firebase-functions/v2/firestore')
    .onDocumentWritten('invoices/{invoiceId}', async (event) => {
        const before = event.data?.before?.data();
        const after = event.data?.after?.data();
        const inv = after || before;
        if (!inv) return;

        const { schoolId, term, academicYear } = inv;
        if (!schoolId || !term || !academicYear) return;

        const id = summaryId(schoolId, term, academicYear);
        const ref = db.collection('invoice_summaries').doc(id);

        const bucket = (x) => {
            if (!x) return { total: 0, paid: 0, pending: 0, overdue: 0, amount: 0, paidAmount: 0 };
            const paid = x.status === 'paid';
            const overdue = x.status === 'overdue';
            const pending = x.status === 'pending' || x.status === 'partial';
            return {
                total: 1,
                paid: paid ? 1 : 0,
                pending: pending ? 1 : 0,
                overdue: overdue ? 1 : 0,
                amount: x.total || 0,
                paidAmount: x.paidAmount || 0
            };
        };
        const b = bucket(before);
        const a = bucket(after);

        const delta = {
            totalInvoices: a.total - b.total,
            paidCount: a.paid - b.paid,
            pendingCount: a.pending - b.pending,
            overdueCount: a.overdue - b.overdue,
            totalInvoiced: a.amount - b.amount,
            totalPaid: a.paidAmount - b.paidAmount
        };

        await db.runTransaction(async (trx) => {
            const snap = await trx.get(ref);
            const cur = snap.exists() ? snap.data() : {
                schoolId, term, year: Number(academicYear),
                totalInvoices: 0, paidCount: 0, pendingCount: 0, overdueCount: 0,
                totalInvoiced: 0, totalPaid: 0, totalOutstanding: 0,
                totalCollected: 0, totalDiscount: 0, txnCount: 0,
                updatedAt: FieldValue.serverTimestamp()
            };
            const next = {
                ...cur,
                totalInvoices: Math.max(0, (cur.totalInvoices || 0) + delta.totalInvoices),
                paidCount: Math.max(0, (cur.paidCount || 0) + delta.paidCount),
                pendingCount: Math.max(0, (cur.pendingCount || 0) + delta.pendingCount),
                overdueCount: Math.max(0, (cur.overdueCount || 0) + delta.overdueCount),
                totalInvoiced: Math.max(0, (cur.totalInvoiced || 0) + delta.totalInvoiced),
                totalPaid: Math.max(0, (cur.totalPaid || 0) + delta.totalPaid)
            };
            next.totalOutstanding = Math.max(0, next.totalInvoiced - next.totalPaid);
            next.updatedAt = FieldValue.serverTimestamp();
            trx.set(ref, next, { merge: true });
        });
    });
