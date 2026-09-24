const nodemailer = require('nodemailer');
const axios = require('axios');
const { db, FieldValue } = require('../lib/admin');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');

const SMTP_USER = defineSecret('SMTP_USER');
const SMTP_PASS = defineSecret('SMTP_PASS');
const AT_API_KEY = defineSecret('AT_API_KEY');
const AT_USERNAME = defineSecret('AT_USERNAME');

exports.sendInvoiceReminder = onRequest(
    { secrets: [SMTP_USER, SMTP_PASS, AT_API_KEY, AT_USERNAME], cors: true },
    async (req, res) => {
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
        try {
            const { invoiceId } = req.body || {};
            if (!invoiceId) return res.status(400).json({ error: 'invoiceId required' });

            const invSnap = await db.collection('invoices').doc(invoiceId).get();
            if (!invSnap.exists) return res.status(404).json({ error: 'Invoice not found' });
            const inv = invSnap.data();

            const [schoolSnap, stuSnap] = await Promise.all([
                db.collection('schools').doc(inv.schoolId).get(),
                db.collection('students').doc(inv.studentId).get()
            ]);
            const school = schoolSnap.data() || {};
            const stu = stuSnap.data() || {};

            const balance = inv.remainingBalance || (inv.total - (inv.paidAmount || 0));
            const message = `Dear parent, fee balance for ${inv.studentName} (${inv.admissionNumber}) is KES ${balance.toLocaleString()}. Invoice ${inv.invoiceNumber}, due ${inv.dueDate}.`;

            const results = { sms: null, email: null };

            const parentPhone = stu.parentPhone || stu.guardianPhone;
            if (parentPhone && AT_API_KEY.value()) {
                const params = new URLSearchParams({
                    username: AT_USERNAME.value(), to: parentPhone,
                    message, from: school.smsSenderId || 'EDUPRIVA'
                });
                const r = await axios.post('https://api.africastalking.com/version1/messaging',
                    params.toString(),
                    { headers: { apiKey: AT_API_KEY.value(), 'Content-Type': 'application/x-www-form-urlencoded' } });
                results.sms = r.data;
            }

            const parentEmail = stu.parentEmail || stu.guardianEmail;
            if (parentEmail && SMTP_USER.value()) {
                const t = nodemailer.createTransport({
                    host: 'smtp.gmail.com', port: 465, secure: true,
                    auth: { user: SMTP_USER.value(), pass: SMTP_PASS.value() }
                });
                results.email = await t.sendMail({
                    from: SMTP_USER.value(), to: parentEmail,
                    subject: `Fee Reminder — ${inv.studentName}`,
                    text: message
                });
            }

            await invSnap.ref.update({ lastReminderAt: FieldValue.serverTimestamp() });
            return res.json({ success: true, results });
        } catch (err) {
            console.error('sendInvoiceReminder error:', err);
            return res.status(500).json({ success: false, error: err.message });
        }
    }
);
