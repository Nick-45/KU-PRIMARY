const { db, FieldValue } = require('../lib/admin');
const { onSchedule } = require('firebase-functions/v2/scheduler');

const slug = (s) => String(s).trim().replace(/\s+/g, '_').replace(/[\/\\.#$\[\]]/g, '');

exports.agingReport = onSchedule(
    { schedule: '0 3 * * *', timeZone: 'Africa/Nairobi', memory: '1GiB', timeoutSeconds: 540 },
    async () => {
        const schools = await db.collection('schools').get();
        for (const schoolDoc of schools.docs) {
            const schoolId = schoolDoc.id;
            const invSnap = await db.collection('invoices')
                .where('schoolId', '==', schoolId)
                .where('status', 'in', ['pending', 'partial', 'overdue'])
                .limit(10000)
                .get();

            const asOf = new Date();
            const buckets = { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 };
            const byTerm = {};

            for (const d of invSnap.docs) {
                const inv = d.data();
                const remaining = inv.remainingBalance || (inv.total - (inv.paidAmount || 0));
                if (remaining <= 0) continue;
                const due = inv.dueDate ? new Date(inv.dueDate) : null;
                let bucket;
                if (!due || due >= asOf) bucket = 'current';
                else {
                    const days = Math.floor((asOf - due) / 86400000);
                    if (days <= 30) bucket = 'd30';
                    else if (days <= 60) bucket = 'd60';
                    else if (days <= 90) bucket = 'd90';
                    else bucket = 'd90plus';
                }
                buckets[bucket] += remaining;

                const termKey = `${inv.term}__${inv.academicYear}`;
                byTerm[termKey] = byTerm[termKey] || { term: inv.term, year: inv.academicYear, current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0, total: 0 };
                byTerm[termKey][bucket] += remaining;
                byTerm[termKey].total += remaining;
            }

            const id = `${slug(schoolId)}__${asOf.toISOString().split('T')[0]}`;
            await db.collection('aging_reports').doc(id).set({
                schoolId,
                asOf: asOf.toISOString(),
                buckets,
                byTerm,
                generatedAt: FieldValue.serverTimestamp()
            });
        }
    }
);
