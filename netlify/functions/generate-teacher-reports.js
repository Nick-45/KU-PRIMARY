// netlify/functions/generate-teacher-reports.js
const PDFDocument = require('pdfkit');
const axios = require('axios');

const FALLBACK_NAME = 'EDUPRIVA';
const FALLBACK_MOTTO = 'Powering Modern Education';

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

    let payload;
    try {
        payload = JSON.parse(event.body || '{}');
    } catch {
        return json(400, { error: 'Invalid JSON body' });
    }

    const { mode, records, meta, teacher } = payload;

    if (!Array.isArray(records) || records.length === 0) {
        return json(400, { error: 'records array is required and must not be empty' });
    }
    if (mode !== 'single' && mode !== 'all') {
        return json(400, { error: 'mode must be "single" or "all"' });
    }
    if (!meta || typeof meta !== 'object') {
        return json(400, { error: 'meta object is required' });
    }

    try {
        const logoBuffer = await fetchLogoBuffer(meta.schoolLogo);
        const pdfBuffer = mode === 'single'
            ? await generateSingleRecordPDF(records[0], meta, teacher, logoBuffer)
            : await generateAllRecordsPDF(records, meta, teacher, logoBuffer);

        const safe = (s) => String(s || '').replace(/[^\w-]/g, '');
        const filename = mode === 'single'
            ? `assessment_${safe(records[0].studentName || 'student')}_${new Date().toISOString().slice(0, 10)}.pdf`
            : `teacher_report_${safe(meta.schoolName || 'edupriva')}_${new Date().toISOString().slice(0, 10)}.pdf`;

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="${filename}"`
            },
            body: pdfBuffer.toString('base64'),
            isBase64Encoded: true
        };
    } catch (err) {
        console.error('Teacher reports PDF error:', err);
        return json(500, { error: err.message });
    }
};

// ---------------- Helpers ----------------

function json(statusCode, body) {
    return {
        statusCode,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    };
}

function cbcGrade(score) {
    if (score >= 80) return { code: 'EE', label: 'Exceeding Expectation', points: 8 };
    if (score >= 65) return { code: 'ME', label: 'Meeting Expectation', points: 6 };
    if (score >= 50) return { code: 'AE', label: 'Approaching Expectation', points: 4 };
    if (score >= 40) return { code: 'BE', label: 'Below Expectation', points: 2 };
    return { code: 'BE', label: 'Below Expectation', points: 1 };
}

async function fetchLogoBuffer(url) {
    if (!url || typeof url !== 'string') return null;
    try {
        const res = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 8000,
            headers: { 'User-Agent': 'EduPriva-PDF/1.0' }
        });
        const buf = Buffer.from(res.data);
        if (buf.length > 2 * 1024 * 1024) return null;
        return buf;
    } catch {
        return null;
    }
}

function drawBrandHeader(doc, meta, logoBuffer, badgeLabel) {
    const PRIMARY = '#1a237e';
    const GRAY = '#666';
    const MARGIN = 40;
    const pageWidth = doc.page.width;

    const schoolName = meta.schoolName || FALLBACK_NAME;
    const motto = meta.schoolMotto || FALLBACK_MOTTO;
    const year = meta.year || new Date().getFullYear();

    const headerY = MARGIN;
    const logoSize = 54;
    const textX = MARGIN + (logoBuffer ? logoSize + 12 : 0);

    if (logoBuffer) {
        try {
            doc.image(logoBuffer, MARGIN, headerY, { fit: [logoSize, logoSize] });
        } catch (e) {
            console.warn('Logo embed failed:', e.message);
        }
    }

    doc.fontSize(18).fillColor(PRIMARY).font('Helvetica-Bold')
       .text(schoolName, textX, headerY, {
           width: pageWidth - textX - MARGIN - 160
       });

    if (motto) {
        doc.fontSize(9).fillColor(GRAY).font('Helvetica-Oblique')
           .text(motto, textX, headerY + 26, {
               width: pageWidth - textX - MARGIN - 160
           });
    }

    const contactBits = [
        meta.schoolAddress,
        meta.schoolPhone ? `Phone: ${meta.schoolPhone}` : '',
        meta.schoolEmail ? `Email: ${meta.schoolEmail}` : ''
    ].filter(Boolean);

    if (contactBits.length) {
        doc.fontSize(8).fillColor(GRAY).font('Helvetica')
           .text(contactBits.join('   •   '), textX, headerY + 42, {
               width: pageWidth - textX - MARGIN - 160
           });
    }

    const badgeW = 140;
    const badgeH = 54;
    const badgeX = pageWidth - MARGIN - badgeW;
    const badgeY = headerY;

    doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 4)
       .lineWidth(2).strokeColor(PRIMARY).stroke();

    doc.fontSize(10).fillColor(PRIMARY).font('Helvetica-Bold')
       .text(badgeLabel, badgeX, badgeY + 10, {
           width: badgeW, align: 'center'
       });

    doc.fontSize(9).fillColor(GRAY).font('Helvetica')
       .text(String(year), badgeX, badgeY + 32, {
           width: badgeW, align: 'center'
       });

    const dividerY = headerY + logoSize + 12;
    doc.moveTo(MARGIN, dividerY).lineTo(pageWidth - MARGIN, dividerY)
       .lineWidth(2).strokeColor(PRIMARY).stroke();

    return dividerY + 20;
}

// ---------------- Single record PDF ----------------

function generateSingleRecordPDF(record, meta, teacher, logoBuffer) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', margin: 40 });
        const chunks = [];
        doc.on('data', (c) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const PRIMARY = '#1a237e';
        const GRAY = '#666';
        const MARGIN = 40;
        const CONTENT_W = doc.page.width - MARGIN * 2;

        let y = drawBrandHeader(doc, meta, logoBuffer, 'ASSESSMENT');

        doc.fontSize(14).fillColor('#000').font('Helvetica-Bold')
           .text('Assessment Record', MARGIN, y, { width: CONTENT_W, align: 'center' });
        y += 24;

        // Info grid
        const grade = cbcGrade(record.score || 0);
        const rowH = 26;
        const infoRows = [
            ['Student', record.studentName || 'N/A', 'Admission No', record.admissionNumber || 'N/A'],
            ['Subject', record.subject || 'N/A', 'Level', record.levelDisplay || record.level || 'N/A'],
            ['Class', record.class || 'N/A', 'Assessment Type', record.assessmentType || 'N/A'],
            ['Score', `${record.score || 0}%`, 'CBC Level', `${grade.code} — ${grade.label}`],
            ['Points', grade.points.toFixed(1), 'Date', record.recordedAtDisplay || 'N/A'],
            ['Teacher', `${teacher?.firstName || ''} ${teacher?.lastName || ''}`.trim() || 'N/A',
             'School', meta.schoolName || FALLBACK_NAME]
        ];

        doc.rect(MARGIN, y, CONTENT_W, infoRows.length * rowH + 10)
           .fillAndStroke('#f5f5f5', '#e0e0e0');

        let rowY = y + 5;
        infoRows.forEach(([l1, v1, l2, v2], idx) => {
            if (idx % 2 === 1) {
                doc.rect(MARGIN + 1, rowY, CONTENT_W - 2, rowH).fill('#eef2f7');
            }
            doc.fontSize(9).fillColor(GRAY).font('Helvetica')
               .text(l1.toUpperCase(), MARGIN + 15, rowY + 3);
            doc.fontSize(11).fillColor('#000').font('Helvetica-Bold')
               .text(v1, MARGIN + 15, rowY + 12, { width: CONTENT_W / 2 - 30, ellipsis: true });

            doc.fontSize(9).fillColor(GRAY).font('Helvetica')
               .text(l2.toUpperCase(), MARGIN + CONTENT_W / 2, rowY + 3);
            doc.fontSize(11).fillColor('#000').font('Helvetica-Bold')
               .text(v2, MARGIN + CONTENT_W / 2, rowY + 12, {
                   width: CONTENT_W / 2 - 15, ellipsis: true
               });

            rowY += rowH;
        });

        y = rowY + 20;

        // Remarks block
        if (record.remarks) {
            doc.rect(MARGIN, y, CONTENT_W, 60).fill('#f9f9f9');
            doc.rect(MARGIN, y, 4, 60).fill(PRIMARY);
            doc.fontSize(9).fillColor(PRIMARY).font('Helvetica-Bold')
               .text('TEACHER REMARKS', MARGIN + 15, y + 8);
            doc.fontSize(10).fillColor('#333').font('Helvetica-Oblique')
               .text(record.remarks, MARGIN + 15, y + 24, {
                   width: CONTENT_W - 30, ellipsis: true
               });
            y += 72;
        }

        // Footer
        doc.fontSize(8).fillColor('#999').font('Helvetica')
           .text(
               `Generated: ${new Date().toLocaleString('en-KE')}   •   ${meta.schoolName || FALLBACK_NAME}   •   ${meta.year || new Date().getFullYear()}`,
               MARGIN, doc.page.height - 40, { width: CONTENT_W, align: 'center' }
           );

        doc.end();
    });
}

// ---------------- All records PDF ----------------

function generateAllRecordsPDF(records, meta, teacher, logoBuffer) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40 });
        const chunks = [];
        doc.on('data', (c) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const PRIMARY = '#1a237e';
        const GRAY = '#666';
        const MARGIN = 40;
        const CONTENT_W = doc.page.width - MARGIN * 2;
        const RIGHT_EDGE = doc.page.width - MARGIN;

        let y = drawBrandHeader(doc, meta, logoBuffer, 'ASSESSMENTS');

        const teacherName = teacher
            ? `${teacher.firstName || ''} ${teacher.lastName || ''}`.trim()
            : 'Teacher';

        doc.fontSize(11).fillColor('#333').font('Helvetica-Bold')
           .text(`Teacher: ${teacherName}   |   Total Records: ${records.length}`,
                 MARGIN, y, { width: CONTENT_W, align: 'center' });
        y += 22;

        // Column widths
        const colWidths = [30, 130, 80, 90, 55, 55, 45, 90, 70];
        const headers = ['#', 'Student', 'Adm No', 'Subject', 'Score', 'CBC', 'Pts', 'Assessment', 'Date'];

        const drawTableHeader = (topY) => {
            doc.rect(MARGIN, topY, CONTENT_W, 22).fill(PRIMARY);
            doc.fillColor('#fff').fontSize(8).font('Helvetica-Bold');
            let cx = MARGIN + 4;
            headers.forEach((h, i) => {
                doc.text(h, cx, topY + 7, {
                    width: colWidths[i] - 8,
                    align: i === 1 || i === 3 || i === 7 ? 'left' : 'center'
                });
                cx += colWidths[i];
            });
            return topY + 22;
        };

        y = drawTableHeader(y);

        records.forEach((r, idx) => {
            if (y > doc.page.height - 60) {
                doc.addPage({ layout: 'landscape' });
                y = drawBrandHeader(doc, meta, logoBuffer, 'ASSESSMENTS');
                y = drawTableHeader(y);
            }

            const rowH = 18;
            if (idx % 2 === 1) {
                doc.rect(MARGIN, y, CONTENT_W, rowH).fill('#f7f9fc');
            }

            const grade = cbcGrade(r.score || 0);
            const row = [
                String(idx + 1),
                r.studentName || 'Unknown',
                r.admissionNumber || 'N/A',
                r.subject || 'N/A',
                `${r.score || 0}%`,
                grade.code,
                grade.points.toFixed(1),
                r.assessmentType || 'N/A',
                r.recordedAtDisplay || 'N/A'
            ];

            doc.fontSize(8).font('Helvetica').fillColor('#000');
            let cx = MARGIN + 4;
            row.forEach((val, i) => {
                doc.text(String(val), cx, y + 5, {
                    width: colWidths[i] - 8,
                    align: i === 1 || i === 3 || i === 7 ? 'left' : 'center',
                    ellipsis: true
                });
                cx += colWidths[i];
            });

            y += rowH;
            doc.moveTo(MARGIN, y).lineTo(RIGHT_EDGE, y)
               .lineWidth(0.5).strokeColor('#e6e6e6').stroke();
        });

        // Footer
        doc.fontSize(8).fillColor('#999').font('Helvetica')
           .text(
               `Generated: ${new Date().toLocaleString('en-KE')}   •   ${meta.schoolName || FALLBACK_NAME}   •   ${meta.year || new Date().getFullYear()}`,
               MARGIN, doc.page.height - 30, { width: CONTENT_W, align: 'center' }
           );

        doc.end();
    });
}
