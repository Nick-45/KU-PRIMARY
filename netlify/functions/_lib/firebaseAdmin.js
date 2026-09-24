// netlify/functions/_lib/firebaseAdmin.js
let admin = null;

function initAdmin() {
    if (!admin) {
        try {
            admin = require('firebase-admin');
        } catch (e) {
            throw new Error('firebase-admin is not installed in this environment');
        }
    }

    if (admin.apps && admin.apps.length) return admin;

    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY;

    if (!projectId || !clientEmail || !privateKey) {
        throw new Error(
            'Firebase Admin credentials missing. Set FIREBASE_PROJECT_ID, ' +
            'FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY in environment.'
        );
    }

    admin.initializeApp({
        credential: admin.credential.cert({
            projectId,
            clientEmail,
            // Env vars store \n as literal backslash-n; convert back to real newlines
            privateKey: privateKey.replace(/\\n/g, '\n')
        })
    });

    return admin;
}

module.exports = { initAdmin };
