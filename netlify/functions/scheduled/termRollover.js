const { db, FieldValue } = require('../lib/admin');
const { onSchedule } = require('firebase-functions/v2/scheduler');

const slug = (s) => String(s).trim().replace(/\s+/g, '_').replace(/[\/\\.#$\[\]]/g, '');
const nextTerm = (t) => ({ 'Term 1': 'Term 2', 'Term 2': 'Term 3', 'Term 3': 'Term 1' }[t]);

exports.termRollover = onSchedule(
    { schedule: '0 4 5 1,5,9 *', timeZone: 'Africa/Nairobi', memory: '1GiB', timeoutSeconds: 540 },
    async () => {
        const schools = await db.collection('schools').get();
        for (const s of schools.docs) {
            const schoolId = s.id;
            const balSnap = await db.collection('student_balances')
                .where('schoolId', '==', schoolId)
                .where('balance', '>', 0)
                .limit(5000)
                .get();

            let batch = db.batch();
            let ops = 0;
            for (const b of balSnap.docs) {
                const bal = b.data();
                const nt = nextTerm(bal.term);
                const ny = nt === 'Term 1' ? bal.year + 1 : bal.year;
                const id = `${slug(schoolId)}__${slug(bal.studentId)}__${slug(nt)}__${slug(ny)}__OPENING`;
                const ref = db.collection('invoices').doc(id);
                batch.set(ref, {
                    invoiceNumber: `${(schoolId).slice(0, 4).toUpperCase()}-OPEN-${ny}-${slug(bal.admissionNumber)}`,
                    studentId: bal.studentId,
                    studentName: bal.studentName,
                    studentClass: bal.studentClass,
                    studentLevel: bal.level,
                    admissionNumber: bal.admissionNumber,
                    items: [{ description: `Opening balance carried from ${bal.term} ${bal.year}`, amount: bal.balance }],
                    subtotal: bal.balance,
                    tax: 0, discount: 0, total: bal.balance,
                    paidAmount: 0, remainingBalance: bal.balance,
                    term: nt, academicYear: String(ny),
                    dueDate: new Date(ny, 0, 31).toISOString().split('T')[0],
                    status: 'pending',
                    notes: `Carried forward from ${bal.term} ${bal.year}`,
                    payments: [],
                    schoolId,
                    createdBy: 'system-rollover',
                    createdByName: 'Term Rollover',
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp()
                }, { merge: true });
                if (++ops === 400) { await batch.commit(); batch = db.batch(); ops = 0; }
            }
            if (ops > 0) await batch.commit();
        }
    }
);
