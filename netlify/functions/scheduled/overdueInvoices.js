const { db, FieldValue } = require('../lib/admin');
const { onSchedule } = require('firebase-functions/v2/scheduler');

exports.overdueInvoices = onSchedule(
    { schedule: '0 2 * * *', timeZone: 'Africa/Nairobi', memory: '512MiB', timeoutSeconds: 540 },
    async () => {
        const now = new Date();
        const snap = await db.collection('invoices')
            .where('status', 'in', ['pending', 'partial'])
            .where('dueDate', '<', now.toISOString().split('T')[0])
            .limit(5000)
            .get();

        if (snap.empty) return;

        let batch = db.batch();
        let ops = 0;
        for (const d of snap.docs) {
            batch.update(d.ref, { status: 'overdue', updatedAt: FieldValue.serverTimestamp() });
            if (++ops === 400) { await batch.commit(); batch = db.batch(); ops = 0; }
        }
        if (ops > 0) await batch.commit();
        console.log(`Marked ${snap.size} invoices overdue`);
    }
);
