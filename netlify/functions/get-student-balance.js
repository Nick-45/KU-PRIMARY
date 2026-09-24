// netlify/functions/get-student-balance.js
const { initAdmin } = require('./_lib/firebaseAdmin');

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ success: false, message: 'Method not allowed' }) };
    }

    const { admissionNumber, schoolId } = JSON.parse(event.body || '{}');

    if (!admissionNumber || !schoolId) {
        return { statusCode: 400, body: JSON.stringify({ success: false, message: 'Missing fields' }) };
    }

    try {
        const admin = initAdmin();
        const db = admin.firestore();
        
        // Find student by admissionNumber
        const studentsSnapshot = await db.collection('students')
            .where('schoolId', '==', schoolId)
            .where('admissionNumber', '==', String(admissionNumber))
            .limit(1)
            .get();

        if (studentsSnapshot.empty) {
            return { statusCode: 404, body: JSON.stringify({ success: false, message: 'Student not found' }) };
        }

        const studentData = studentsSnapshot.docs[0].data();
        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, balance: studentData.feeBalance || 0 })
        };
    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ success: false, message: error.message }) };
    }
};
