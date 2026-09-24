// netlify/functions/generate-student-report.js
const PDFDocument = require('pdfkit');
const axios = require('axios');

const FALLBACK_NAME = 'EDUPRIVA';
const FALLBACK_MOTTO = 'Powering Modern Education';

// ============================================================
// HTTP handler
// ============================================================
exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

    let payload;
    try {
        payload = JSON.parse(event.body || '{}');
    } catch {
        return json(400, { error: 'Invalid JSON body' });
    }

    const { mode, students, meta, subjects, term } = payload;

    if (!Array.isArray(students) || students.length === 0) {
        return json(400, { error: 'students array is required' });
    }
    if (!['single', 'class', 'all', 'template'].includes(mode)) {
        return json(400, { error: 'mode must be single | class | all | template' });
    }
    if (!Array.isArray(subjects)) {
        return json(400, { error: 'subjects array is required' });
    }

    try {
        const logoBuffer = await fetchLogoBuffer(meta.schoolLogo);

        const pdfBuffer = await buildPDF({
            mode,
            students,
            meta: meta || {},
            subjects,
            term: term || '',
            logoBuffer,
        });

        const safe = (s) => String(s || '').replace(/[^\w-]/g, '');
        const filename = mode === 'template'
            ? `report_template_${new Date().toISOString().slice(0, 10)}.pdf`
            : mode === 'single'
                ? `report_${safe(students[0].admissionNumber || students[0].studentId || 'student')}.pdf`
                : `class_reports_${safe(meta.cls)}_${safe(term)}.pdf`;

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="${filename}"`,
            },
            body: pdfBuffer.toString('base64'),
            isBase64Encoded: true,
        };
    } catch (err) {
        console.error('Student report PDF error:', err);
        return json(500, { error: err.message });
    }
};

function json(statusCode, body) {
    return {
        statusCode,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    };
}

// ============================================================
// CBC grading — single source of truth
// ============================================================
function cbcGrade(score) {
    if (score == null || isNaN(score)) {
        return { code: 'NA', label: 'Not Assessed', points: null, level: 'NA' };
    }
    if (score >= 80) return { code: 'EE', label: 'Exceeding Expectation', points: 8, level: 'EE' };
    if (score >= 65) return { code: 'ME', label: 'Meeting Expectation', points: 6, level: 'ME' };
    if (score >= 50) return { code: 'AE', label: 'Approaching Expectation', points: 4, level: 'AE' };
    if (score >= 40) return { code: 'BE', label: 'Below Expectation', points: 2, level: 'BE' };
    return { code: 'BE', label: 'Below Expectation', points: 1, level: 'BE' };
}

function gradeBg(level) {
    return level === 'EE' ? '#d4edda'
        : level === 'ME' ? '#d1ecf1'
        : level === 'AE' ? '#fff3cd'
        : level === 'NA' ? '#eef2f7'
        : '#f8d7da';
}

function gradeFg(level) {
    return level === 'EE' ? '#155724'
        : level === 'ME' ? '#0c5460'
        : level === 'AE' ? '#856404'
        : level === 'NA' ? '#94a3b8'
        : '#721c24';
}

// System-generated per-subject remark
function subjectRemark(avg, cbc) {
    if (avg == null) return 'Not assessed this term';
    if (cbc.level === 'EE') return 'Exceeds expectations. Sustained excellent work.';
    if (cbc.level === 'ME') return 'Meets expectations. Keep up the consistency.';
    if (cbc.level === 'AE') return 'Approaching expectations. Needs more practice.';
    if (cbc.level === 'BE') return 'Below expectations. Requires targeted support.';
    return 'Not assessed';
}

// System-generated overall teacher comment
function buildTeacherComment(report) {
    const { meanScore, assessedCount, totalSubjects, subjectRows } = report;

    if (assessedCount === 0) {
        return 'No assessments have been recorded for this student this term. Please complete assessments before publishing.';
    }

    const overall = cbcGrade(meanScore);
    const coverage = `${assessedCount} of ${totalSubjects} learning areas`;

    // Find best & weakest
    const assessed = subjectRows.filter((r) => r.average != null);
    const sorted = [...assessed].sort((a, b) => b.average - a.average);
    const best = sorted[0];
    const weakest = sorted[sorted.length - 1];

    const strength = best && best.average >= 65
        ? ` ${best.subject} is a particular strength (${best.average}%).`
        : '';

    const improvement = weakest && weakest.average < 50 && weakest.subject !== best?.subject
        ? ` Additional support is recommended in ${weakest.subject} (${weakest.average}%).`
        : '';

    // Coverage caveat: if less than 70% of subjects assessed, flag it
    const coverageRatio = totalSubjects > 0 ? assessedCount / totalSubjects : 0;
    const caveat = coverageRatio < 0.7
        ? ` This report covers ${coverage}; a fuller picture will emerge as more assessments are completed.`
        : '';

    switch (overall.level) {
        case 'EE':
            return `Exceeding expectations across the assessed learning areas.${strength}${improvement}${caveat}`;
        case 'ME':
            return `Meeting expectations in most assessed areas.${strength}${improvement}${caveat}`;
        case 'AE':
            return `Approaching expectations overall. Consistent practice will raise achievement.${strength}${improvement}${caveat}`;
        case 'BE':
            return `Below expectations in the assessed areas. Targeted intervention is required.${strength}${improvement}${caveat}`;
        default:
            return `This report covers ${coverage}.${caveat}`;
    }
}

// ============================================================
// Compute academic report — separated from PDF drawing
// ============================================================
function computeReport(student, subjects) {
    const subjectRows = subjects.map((subject) => {
        const scores = (student.scores && student.scores[subject]) || [];
        const ass1 = scores[0] ?? null;
        const ass2 = scores[1] ?? null;
        const ass3 = scores[2] ?? null;
        const providedAvg = student.averages && student.averages[subject];

        // Average: use provided, else compute from available scores, else null
        let average = providedAvg != null && !isNaN(providedAvg)
            ? Math.round(providedAvg)
            : null;

        if (average == null && scores.length > 0) {
            average = Math.round(scores.reduce((a, b) => a + (Number(b) || 0), 0) / scores.length);
        }

        const cbc = cbcGrade(average);
        return {
            subject,
            ass1, ass2, ass3,
            average,
            cbc,
            remark: subjectRemark(average, cbc),
            teacher: student.subjectTeachers?.[subject] || '',
        };
    });

    const assessed = subjectRows.filter((r) => r.average != null);
    const assessedCount = assessed.length;
    const totalSubjects = subjectRows.length;

    // Mean is over ASSESSED subjects only — N/A subjects are excluded
    const meanScore = assessedCount > 0
        ? Math.round(assessed.reduce((s, r) => s + r.average, 0) / assessedCount)
        : 0;

    // Total points over assessed subjects only
    const totalPoints = assessed.reduce((s, r) => s + (r.cbc.points || 0), 0);
    const avgPoints = assessedCount > 0 ? (totalPoints / assessedCount).toFixed(1) : null;

    const overall = cbcGrade(assessedCount > 0 ? meanScore : null);

    const report = {
        student,
        subjectRows,
        assessedCount,
        totalSubjects,
        meanScore,
        totalPoints,
        avgPoints,
        overall,
    };
    report.teacherComment = buildTeacherComment(report);
    return report;
}

// ============================================================
// Logo fetch
// ============================================================
async function fetchLogoBuffer(url) {
    if (!url || typeof url !== 'string') return null;
    try {
        const res = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 8000,
            headers: { 'User-Agent': 'EduPriva-PDF/1.0' },
        });
        const buf = Buffer.from(res.data);
        if (buf.length > 2 * 1024 * 1024) return null;
        return buf;
    } catch {
        return null;
    }
}

// ============================================================
// Drawing primitives
// ============================================================
const PRIMARY = '#1a237e';
const PRIMARY_SOFT = '#3949ab';
const GRAY = '#666';
const LIGHT = '#f5f7fb';
const BORDER = '#e0e6ed';
const DANGER = '#c62828';
const SUCCESS = '#1b5e20';

/**
 * Draw a linear gradient rectangle (horizontal).
 * PDFKit doesn't have native gradients, so we interpolate between two colors
 * and paint thin vertical strips.
 */
function linearGradientRect(doc, x, y, w, h, from, to, steps = 40) {
    const stepW = w / steps;
    for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1);
        const color = interpolateHex(from, to, t);
        doc.rect(x + i * stepW, y, stepW + 0.5, h).fill(color);
    }
}

function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return [
        parseInt(h.substring(0, 2), 16),
        parseInt(h.substring(2, 4), 16),
        parseInt(h.substring(4, 6), 16),
    ];
}

function interpolateHex(a, b, t) {
    const [r1, g1, b1] = hexToRgb(a);
    const [r2, g2, b2] = hexToRgb(b);
    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const bl = Math.round(b1 + (b2 - b1) * t);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`;
}

// ============================================================
// Page rendering
// ============================================================
function drawReportCard(doc, { student, meta, subjects, term, logoBuffer }) {
    const MARGIN = 32;
    const PAGE_W = doc.page.width;
    const PAGE_H = doc.page.height;
    const CONTENT_W = PAGE_W - MARGIN * 2;

    const report = computeReport(student, subjects);

    // ============================================================
    // Header — centered
    // ============================================================
    let y = MARGIN;

    // Soft gradient band behind header
    linearGradientRect(doc, MARGIN, y, CONTENT_W, 66, '#eef2ff', '#f8fafc');
    doc.rect(MARGIN, y, CONTENT_W, 66).lineWidth(0.5).strokeColor(BORDER).stroke();

    // Logo — centered above name
    const logoSize = 42;
    const logoY = y + 8;
    if (logoBuffer) {
        try {
            doc.image(logoBuffer, MARGIN + (CONTENT_W - logoSize) / 2, logoY, {
                fit: [logoSize, logoSize],
            });
        } catch (e) {
            console.warn('Logo embed failed:', e.message);
        }
    }

    // Name + motto below logo, centered
    const textCenterY = logoY + (logoBuffer ? logoSize + 2 : 0);
    doc.fontSize(15).fillColor(PRIMARY).font('Helvetica-Bold')
        .text(
            (meta.schoolName || FALLBACK_NAME).toUpperCase(),
            MARGIN, textCenterY,
            { width: CONTENT_W, align: 'center', characterSpacing: 1 }
        );

    doc.fontSize(8.5).fillColor(GRAY).font('Helvetica-Oblique')
        .text(
            `"${meta.schoolMotto || FALLBACK_MOTTO}"`,
            MARGIN, textCenterY + 18,
            { width: CONTENT_W, align: 'center' }
        );

    // Contact line under header
    const contactBits = [
        meta.schoolAddress,
        meta.schoolPhone ? `Tel: ${meta.schoolPhone}` : '',
        meta.schoolEmail ? `Email: ${meta.schoolEmail}` : '',
    ].filter(Boolean);

    if (contactBits.length) {
        doc.fontSize(7.5).fillColor(GRAY).font('Helvetica')
            .text(contactBits.join('   •   '), MARGIN, y + 52, {
                width: CONTENT_W, align: 'center',
            });
    }

    y += 74;

    // ============================================================
    // Title
    // ============================================================
    doc.fontSize(12).fillColor(PRIMARY).font('Helvetica-Bold')
        .text('STUDENT PROGRESS REPORT', MARGIN, y, {
            width: CONTENT_W, align: 'center', characterSpacing: 0.5,
        });
    y += 16;

    // Thin gradient underline
    linearGradientRect(doc, MARGIN + CONTENT_W * 0.25, y, CONTENT_W * 0.5, 2, PRIMARY, PRIMARY_SOFT, 30);
    y += 10;

    // ============================================================
    // Student info strip — 3 columns × 3 rows
    // ============================================================
    const infoRowH = 15;
    const infoRows = 3;
    const infoH = infoRowH * infoRows + 8;
    doc.rect(MARGIN, y, CONTENT_W, infoH).fillAndStroke(LIGHT, BORDER);

    const label = (text, x, ly, w) =>
        doc.fontSize(7).fillColor(GRAY).font('Helvetica')
            .text(text.toUpperCase(), x, ly, { width: w, ellipsis: true });
    const value = (text, x, ly, w) =>
        doc.fontSize(9).fillColor('#111').font('Helvetica-Bold')
            .text(String(text == null || text === '' ? '—' : text), x, ly + 8, {
                width: w, ellipsis: true,
            });

    const colW = CONTENT_W / 3;
    const colX = (i) => MARGIN + 10 + colW * i;
    const textW = colW - 20;

    // Row 1: Name | Admission No | Class
    label('Name', colX(0), y + 6, textW);
    value(`${student.firstName || ''} ${student.lastName || ''}`.trim(), colX(0), y + 6, textW);
    label('Admission No', colX(1), y + 6, textW);
    value(student.admissionNumber || student.studentId, colX(1), y + 6, textW);
    label('Class', colX(2), y + 6, textW);
    value(student.class || meta.cls, colX(2), y + 6, textW);

    // Row 2: Level | Term | Academic Year
    label('Level', colX(0), y + 6 + infoRowH, textW);
    value(meta.levelDisplay || meta.level, colX(0), y + 6 + infoRowH, textW);
    label('Term', colX(1), y + 6 + infoRowH, textW);
    value(term, colX(1), y + 6 + infoRowH, textW);
    label('Academic Year', colX(2), y + 6 + infoRowH, textW);
    value(meta.year || new Date().getFullYear(), colX(2), y + 6 + infoRowH, textW);

    // Row 3: Term End | Next Term Start | Date Issued
    const termEnd = meta.currentTermEnd ? new Date(meta.currentTermEnd).toLocaleDateString('en-KE') : '—';
    const nextStart = meta.nextTermStart ? new Date(meta.nextTermStart).toLocaleDateString('en-KE') : '—';
    label('Current Term Ends', colX(0), y + 6 + infoRowH * 2, textW);
    value(termEnd, colX(0), y + 6 + infoRowH * 2, textW);
    label('Next Term Begins', colX(1), y + 6 + infoRowH * 2, textW);
    value(nextStart, colX(1), y + 6 + infoRowH * 2, textW);
    label('Date Issued', colX(2), y + 6 + infoRowH * 2, textW);
    value(new Date().toLocaleDateString('en-KE'), colX(2), y + 6 + infoRowH * 2, textW);

    y += infoH + 8;

    // ============================================================
    // Fee arrears row
    // ============================================================
    const arrears = Number(student.feeArrears || 0);
    const hasArrears = arrears > 0;
    const arrearsH = 18;
    doc.rect(MARGIN, y, CONTENT_W, arrearsH)
        .fillAndStroke(hasArrears ? '#fdecea' : '#e8f5e9', BORDER);

    doc.fontSize(8).fillColor(GRAY).font('Helvetica')
        .text('FEE ARREARS', MARGIN + 10, y + 5, { width: CONTENT_W * 0.4 });

    doc.fontSize(10).font('Helvetica-Bold')
        .fillColor(hasArrears ? DANGER : SUCCESS)
        .text(
            hasArrears ? `KES ${arrears.toLocaleString()}` : 'Cleared — no outstanding balance',
            MARGIN + 10, y + 4,
            { width: CONTENT_W - 20, align: 'right' }
        );

    y += arrearsH + 8;

    // ============================================================
    // Performance table
    // ============================================================
    const tableTop = y;

    // Column widths (now includes subject teacher + remark)
    // Subject | A1 | A2 | A3 | Avg | CBC | Pts | Teacher | Remark
    const colSubject = Math.floor(CONTENT_W * 0.20);
    const colAss = 26;
    const colAvg = 28;
    const colCbc = 38;
    const colPts = 32;
    const colTeacher = Math.floor(CONTENT_W * 0.14);
    const colRemark = CONTENT_W - colSubject - colAss * 3 - colAvg - colCbc - colPts - colTeacher;

    const columns = [
        { key: 'subject', w: colSubject, label: 'Learning Area', align: 'left' },
        { key: 'a1', w: colAss, label: 'A1', align: 'center' },
        { key: 'a2', w: colAss, label: 'A2', align: 'center' },
        { key: 'a3', w: colAss, label: 'A3', align: 'center' },
        { key: 'avg', w: colAvg, label: 'Avg', align: 'center' },
        { key: 'cbc', w: colCbc, label: 'Level', align: 'center' },
        { key: 'pts', w: colPts, label: 'Pts', align: 'center' },
        { key: 'teacher', w: colTeacher, label: 'Teacher', align: 'left' },
        { key: 'remark', w: colRemark, label: 'Subject Remark', align: 'left' },
    ];

    const headerH = 22;

    // Header band — gradient
    linearGradientRect(doc, MARGIN, tableTop, CONTENT_W, headerH, PRIMARY, PRIMARY_SOFT, 50);
    doc.fillColor('#fff').fontSize(7.5).font('Helvetica-Bold');
    let cx = MARGIN + 4;
    columns.forEach((c) => {
        doc.text(c.label, cx, tableTop + 7, { width: c.w - 8, align: c.align });
        cx += c.w;
    });

    // Rows
    let ry = tableTop + headerH;
    const rowH = 17;

    report.subjectRows.forEach((row, idx) => {
        // Zebra
        if (idx % 2 === 1) {
            doc.rect(MARGIN, ry, CONTENT_W, rowH).fill('#fafbfe');
        }

        const cells = [
            { t: row.subject, align: 'left', bold: true },
            { t: row.ass1 != null ? String(row.ass1) : '—', align: 'center' },
            { t: row.ass2 != null ? String(row.ass2) : '—', align: 'center' },
            { t: row.ass3 != null ? String(row.ass3) : '—', align: 'center' },
            { t: row.average != null ? String(row.average) : '—', align: 'center', bold: true },
            { t: row.cbc.code, align: 'center', bg: gradeBg(row.cbc.level), fg: gradeFg(row.cbc.level), bold: true },
            { t: row.cbc.points != null ? row.cbc.points.toFixed(1) : '—', align: 'center', bold: true },
            { t: row.teacher || '—', align: 'left', size: 7 },
            { t: row.remark, align: 'left', size: 7, color: '#555' },
        ];

        let rx = MARGIN + 4;
        cells.forEach((c, i) => {
            const col = columns[i];
            if (c.bg) {
                doc.rect(rx, ry + 3, col.w - 8, rowH - 6).fill(c.bg);
            }
            doc.fontSize(c.size || 8)
                .font(c.bold ? 'Helvetica-Bold' : 'Helvetica')
                .fillColor(c.fg || c.color || '#000');
            doc.text(c.t, rx, ry + 5, {
                width: col.w - 8, align: c.align, ellipsis: true,
            });
            rx += col.w;
        });

        ry += rowH;
        doc.moveTo(MARGIN, ry).lineTo(MARGIN + CONTENT_W, ry)
            .lineWidth(0.3).strokeColor(BORDER).stroke();
    });

    // Table border
    doc.rect(MARGIN, tableTop, CONTENT_W, ry - tableTop)
        .lineWidth(0.6).strokeColor(PRIMARY).stroke();

    ry += 4;

    // ============================================================
    // Performance summary
    // ============================================================
    const summaryH = 40;
    linearGradientRect(doc, MARGIN, ry, CONTENT_W, summaryH, '#eef2ff', '#f8fafc');
    doc.rect(MARGIN, ry, CONTENT_W, summaryH).lineWidth(0.4).strokeColor(BORDER).stroke();

    const summaryX = (i) => MARGIN + 10 + (CONTENT_W / 4) * i;
    const summaryW = CONTENT_W / 4 - 20;

    const summaryCell = (i, label, val, color) => {
        doc.fontSize(7).fillColor(GRAY).font('Helvetica')
            .text(label, summaryX(i), ry + 6, { width: summaryW });
        doc.fontSize(13).fillColor(color || PRIMARY).font('Helvetica-Bold')
            .text(val, summaryX(i), ry + 18, { width: summaryW });
    };

    summaryCell(0, 'SUBJECTS OFFERED', String(report.totalSubjects));
    summaryCell(1, 'SUBJECTS ASSESSED', `${report.assessedCount} / ${report.totalSubjects}`);
    summaryCell(2, 'OVERALL MEAN', report.assessedCount > 0 ? `${report.meanScore}%` : '—');
    summaryCell(
        3,
        'OVERALL CBC LEVEL',
        report.overall.code,
        report.overall.level === 'EE' ? SUCCESS
            : report.overall.level === 'BE' ? DANGER
            : PRIMARY
    );

    ry += summaryH + 8;

    // ============================================================
    // Competency Level Guide (legend box)
    // ============================================================
    const legendH = 24;
    doc.rect(MARGIN, ry, CONTENT_W, legendH).fillAndStroke('#f8f9fa', BORDER);
    doc.fontSize(7).fillColor(GRAY).font('Helvetica')
        .text('COMPETENCY LEVEL GUIDE', MARGIN + 10, ry + 4, { width: CONTENT_W - 20 });

    const legendItems = [
        { code: 'EE', meaning: 'Exceeding Expectations', color: '#27ae60' },
        { code: 'ME', meaning: 'Meeting Expectations', color: '#2ecc71' },
        { code: 'AE', meaning: 'Approaching Expectations', color: '#f39c12' },
        { code: 'BE', meaning: 'Below Expectations', color: '#e74c3c' },
    ];
    let lx = MARGIN + 10;
    legendItems.forEach((item) => {
        doc.circle(lx + 3, ry + 16, 3).fill(item.color);
        doc.fontSize(7.5).fillColor('#333').font('Helvetica')
            .text(`${item.code}  ${item.meaning}`, lx + 10, ry + 13, { width: 110, lineBreak: false });
        lx += 118;
    });

    ry += legendH + 8;

    // ============================================================
    // Teacher's / Head Teacher's Remarks
    // ============================================================
    const remarkBoxH = 34;

    // Class teacher comment
    doc.rect(MARGIN, ry, CONTENT_W, remarkBoxH).fillAndStroke('#fbfcfe', BORDER);
    doc.rect(MARGIN, ry, 3, remarkBoxH).fill(PRIMARY);
    doc.fontSize(7.5).fillColor(PRIMARY).font('Helvetica-Bold')
        .text("CLASS TEACHER'S REMARKS", MARGIN + 10, ry + 5);
    doc.fontSize(8.5).fillColor('#333').font('Helvetica')
        .text(report.teacherComment, MARGIN + 10, ry + 16, {
            width: CONTENT_W - 20, height: remarkBoxH - 20, ellipsis: true,
        });
    ry += remarkBoxH + 6;

    // Head teacher comment (if provided by caller, else placeholder)
    const headComment = student.headTeacherComment
        || 'Acknowledged. The school continues to support the learner’s progress.';

    doc.rect(MARGIN, ry, CONTENT_W, remarkBoxH).fillAndStroke('#fbfcfe', BORDER);
    doc.rect(MARGIN, ry, 3, remarkBoxH).fill(PRIMARY_SOFT);
    doc.fontSize(7.5).fillColor(PRIMARY).font('Helvetica-Bold')
        .text("HEAD TEACHER / PRINCIPAL'S REMARKS", MARGIN + 10, ry + 5);
    doc.fontSize(8.5).fillColor('#333').font('Helvetica')
        .text(headComment, MARGIN + 10, ry + 16, {
            width: CONTENT_W - 20, height: remarkBoxH - 20, ellipsis: true,
        });
    ry += remarkBoxH + 8;

    // ============================================================
    // Signatures + stamp — pinned to bottom of page
    // ============================================================
    const footerY = PAGE_H - 68;

    // Signature blocks
    const sigW = (CONTENT_W - 30) / 2;
    const sigLeftX = MARGIN;
    const sigRightX = MARGIN + sigW + 30;

    // Class teacher
    doc.moveTo(sigLeftX, footerY + 22).lineTo(sigLeftX + sigW - 20, footerY + 22)
        .lineWidth(0.8).strokeColor('#333').stroke();
    doc.fontSize(7.5).fillColor(GRAY).font('Helvetica')
        .text('Class Teacher — Signature & Date', sigLeftX, footerY + 26, { width: sigW - 20 });

    // Head teacher / principal
    doc.moveTo(sigRightX, footerY + 22).lineTo(sigRightX + sigW - 20, footerY + 22)
        .lineWidth(0.8).strokeColor('#333').stroke();
    doc.fontSize(7.5).fillColor(GRAY).font('Helvetica')
        .text('Head Teacher / Principal — Signature & Date', sigRightX, footerY + 26, { width: sigW - 20 });

    // School stamp area
    doc.rect(MARGIN + CONTENT_W - 90, footerY - 10, 80, 46)
        .dash(2, { space: 2 })
        .lineWidth(0.5).strokeColor('#aaa').stroke();
    doc.undash();
    doc.fontSize(6.5).fillColor('#aaa').font('Helvetica-Oblique')
        .text('Official School Stamp', MARGIN + CONTENT_W - 90, footerY + 38, {
            width: 80, align: 'center',
        });

    // Footer line
    doc.moveTo(MARGIN, PAGE_H - 30).lineTo(PAGE_W - MARGIN, PAGE_H - 30)
        .lineWidth(0.4).strokeColor(BORDER).stroke();
    doc.fontSize(7).fillColor('#999').font('Helvetica')
        .text(
            `${meta.schoolName || FALLBACK_NAME}  •  Generated ${new Date().toLocaleString('en-KE')}  •  ${meta.year || new Date().getFullYear()}`,
            MARGIN, PAGE_H - 24,
            { width: CONTENT_W, align: 'center' }
        );
}

// ============================================================
// Main builder
// ============================================================
async function buildPDF({ students, meta, subjects, term, logoBuffer }) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({
            size: 'A4',
            margin: 0,
            autoFirstPage: false,
            info: {
                Title: `Student Progress Report${meta.cls ? ' — ' + meta.cls : ''}`,
                Author: meta.schoolName || FALLBACK_NAME,
                Subject: `${term || ''} report`,
                Creator: 'EduPriva',
            },
        });
        const chunks = [];
        doc.on('data', (c) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        students.forEach((student) => {
            doc.addPage();
            drawReportCard(doc, { student, meta, subjects, term, logoBuffer });
        });

        doc.end();
    });
}
