const nodemailer = require('nodemailer');
const axios = require('axios');
const { db, FieldValue } = require('../lib/admin');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');

const SMTP_USER = defineSecret('SMTP_USER');
const SMTP_PASS = defineSecret('SMTP_PASS');
const AT_API_KEY = defineSecret('AT_API_KEY');
const AT_USERNAME = defineSecret('AT_USERNAME');

function renderTemplate(tpl, vars) {
    return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
}

async function sendSMS(to, message) {
    if (!AT_API_KEY.value()) return { skipped: true };
    const params = new URLSearchParams({
        username: AT_USERNAME.value(),
        to,
        message,
        from: 'EDUPRIVA'
    });
    const res = await axios.post('https://api.africastalking.com/version1/messaging',
        params.toString(),
        {
            headers: {
                apiKey: AT_API_KEY.value(),
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json'
            }
        });
    return res.data;
}

async function sendEmail(transporter, to, subject, text) {
    return transporter.sendMail({
        from: SMTP_USER.value(), to, subject, text
    });
}

exports.sendReminders = onSchedule(
    { schedule: '0 8 * * *', timeZone: 'Africa/Nairobi', memory: '1GiB', timeoutSeconds: 540,
      secrets: [SMTP_USER, SMTP_PASS, AT_API_KEY, AT_USERNAME] },
    async () => {
        const transporter = nodemailer.createTransport({
            host: 'smtp.gmail.com', port: 465, secure: true,
            auth: { user: SMTP_USER.value(), pass: SMTP_PASS.value() }
        });

        const today = new Date();
        const in7 = new Date(today.getTime() + 7 * 86400000).toISOString().split('T')[0];

        const snap = await db.collection('invoices')
            .where('status', 'in', ['pending', 'partial', 'overdue'])
            .where('dueDate', '<=', in7)
            .limit(3000)
            .get();

        for (const d of snap.docs) {
            const inv = d.data();
            // Skip if reminded in last 3 days
            const last = inv.lastReminderAt?.toDate?.();
            if (last && (today - last) < 3 * 86400000) continue;

            // Load school template
            const schoolSnap = await db.collection('schools').doc(inv.schoolId).get();
            const school = schoolSnap.data() || {};
            const tpl = school.reminderTemplate || {
                sms: 'Dear parent, fee balance for {{studentName}} ({{admissionNumber}}) is KES {{balance}}. Due {{dueDate}}. Pay via M-Pesa Paybill {{paybill}}, Acc {{admissionNumber}}.',
                emailSubject: 'Fee Reminder — {{studentName}}',
                emailBody: 'Dear Parent,\n\nOur records show an outstanding balance of KES {{balance}} for {{studentName}} ({{admissionNumber}}), due on {{dueDate}}.\n\nKindly settle at your earliest convenience.\n\nRegards,\n{{schoolName}}'
            };

            const balance = inv.remainingBalance || (inv.total - (inv.paidAmount || 0));
            const vars = {
                studentName: inv.studentName,
                admissionNumber: inv.admissionNumber,
                balance: balance.toLocaleString(),
                dueDate: inv.dueDate,
                schoolName: school.schoolName || 'School',
                invoiceNumber: inv.invoiceNumber,
                paybill: school.mpesaPaybill || ''
            };

            // Find parent contacts
            const stuSnap = await db.collection('students').doc(inv.studentId).get();
            const stu = stuSnap.data() || {};
            const parentPhone = stu.parentPhone || stu.guardianPhone;
            const parentEmail = stu.parentEmail || stu.guardianEmail;

            if (parentPhone) {
                try {
                    await sendSMS(parentPhone, renderTemplate(tpl.sms, vars));
                } catch (e) { console.error('SMS fail:', e.message); }
            }
            if (parentEmail) {
                try {
                    await sendEmail(transporter, parentEmail,
                        renderTemplate(tpl.emailSubject, vars),
                        renderTemplate(tpl.emailBody, vars));
                } catch (e) { console.error('Email fail:', e.message); }
            }

            await d.ref.update({ lastReminderAt: FieldValue.serverTimestamp() });
        }
    }
);
