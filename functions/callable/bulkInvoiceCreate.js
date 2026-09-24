const { db, FieldValue } = require('../lib/admin');
const { onCall, HttpsError } = require('firebase-functions/v2/https');

const slug = (s) => String(s).trim().replace(/\s+/g, '_').replace(/[\/\\.#$\[\]]/g, '');

exports.bulkInvoiceCreate = onCall({ memory: '512MiB', timeoutSeconds: 300 }, async (req) => {
    const auth = req.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Login required');
    const { schoolId, entries, meta } = req.data || {};
    if (!schoolId || !Array.isArray(entries) || entries.length === 0) {
        throw new HttpsError('invalid-argument', 'schoolId and entries required');
    }
    if (entries.length > 2000) throw new HttpsError('invalid-argument', 'Max 2000 per call');

    const results = { count: 0, errors: [] };
    const CHUNK = 400;

    for (let i = 0; i < entries.length; i += CHUNK) {
        const chunk = entries.slice(i, i + CHUNK);
        const batch = db.batch();
        for (const e of chunk) {
            const suffix = e.suffix || `${Date.now()}_${i}`;
            const id = `${slug(schoolId)}__${slug(e.studentId)}__${slug(e.term)}__${slug(e.academicYear)}__${slug(suffix)}`;
            const ref = db.collection('invoices').doc(id);
            batch.set(ref, {
                invoiceNumber: e.invoiceNumber,
                studentId: e.studentId,
                studentName: e.studentName,
                studentClass: e.studentClass,
                studentLevel: e.studentLevel,
                admissionNumber: e.admissionNumber,
                items: e.items || [],
                subtotal: e.subtotal || 0,
                tax: e.tax || 0,
                discount: e.discount || 0,
                total: e.total || 0,
                paidAmount: 0,
                remainingBalance: e.total || 0,
                term: e.term,
                academicYear: String(e.academicYear),
                dueDate: e.dueDate,
                status: 'pending',
                notes: e.notes || '',
                payments: [],
                schoolId,
                createdBy: meta?.createdBy || auth.uid,
                createdByName: meta?.createdByName || '',
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            }, { merge: true });
        }
        try {
            await batch.commit();
            results.count += chunk.length;
        } catch (err) {
            results.errors.push({ chunk: i, error: err.message });
        }
    }
    return results;
});
