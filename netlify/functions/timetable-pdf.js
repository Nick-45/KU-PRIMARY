// netlify/functions/timetable-pdf.js
// Real PDF generation via PDFKit. 
// Renders branded timetables in A4 landscape, one per page for class view,
// one per level for master view.

const PDFDocument = require('pdfkit');
const axios = require('axios');

const FALLBACK_SCHOOL = 'School';
const FALLBACK_MOTTO = '';

// ---------- colours ----------
const NAVY = '#1a237e';
const SLATE = '#2c3e50';
const GREEN = '#27ae60';
const GRAY = '#64748b';
const LIGHT = '#f1f5f9';
const BORDER = '#cbd5e1';
const BREAK_BG = '#fef3c7';
const BREAK_FG = '#78350f';

// ---------- constants ----------
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

const PERIODS = [
    { id: 'p1', name: 'Period 1', time: '08:00 - 08:40', type: 'class' },
    { id: 'p2', name: 'Period 2', time: '08:40 - 09:20', type: 'class' },
    { id: 'break1', name: 'Morning Break', time: '09:20 - 09:50', type: 'break', label: 'TEA / RECREATION BREAK' },
    { id: 'p3', name: 'Period 3', time: '09:50 - 10:30', type: 'class' },
    { id: 'p4', name: 'Period 4', time: '10:30 - 11:10', type: 'class' },
    { id: 'p5', name: 'Period 5', time: '11:10 - 11:50', type: 'class' },
    { id: 'lunch', name: 'Lunch Break', time: '11:50 - 13:00', type: 'break', label: 'NOON LUNCH BREAK' },
    { id: 'p6', name: 'Period 6', time: '13:00 - 13:40', type: 'class' },
    { id: 'p7', name: 'Period 7', time: '13:40 - 14:20', type: 'class' },
    { id: 'p8', name: 'Period 8', time: '14:20 - 15:00', type: 'class' }
];

const CLASS_PERIODS = PERIODS.filter(p => p.type === 'class');

const DUTY_AREAS = [
    { id: 'gate_morning', label: 'Main Gate (Morning)', time: '07:00 - 08:00' },
    { id: 'assembly',     label: 'Assembly Ground',     time: '08:00 - 08:20' },
    { id: 'break_duty',   label: 'Break Supervision',   time: '09:20 - 09:50' },
    { id: 'dining',       label: 'Dining Hall',         time: '12:00 - 13:00' },
    { id: 'gate_evening', label: 'Main Gate (Evening)', time: '15:00 - 16:30' },
    { id: 'library',      label: 'Library',             time: '15:00 - 16:30' },
    { id: 'playground',   label: 'Playground',          time: '16:00 - 17:00' },
    { id: 'dormitory',    label: 'Dormitory (Night)',   time: '21:00 - 22:00' }
];

// ---------- helpers ----------
async function fetchLogo(url) {
    if (!url || typeof url !== 'string') return null;
    try {
        const res = await axios.get(url, {
            responseType: 'arraybuffer', timeout: 8000,
            headers: { 'User-Agent': 'EduPriva-PDF/1.0' }
        });
        const buf = Buffer.from(res.data);
        return buf.length > 2 * 1024 * 1024 ? null : buf;
    } catch {
        return null;
    }
}

// Draws the school letterhead at the top of a page.
// Returns Y coordinate to continue drawing below.
function drawHeader(doc, school, logo, title, subtitle) {
    const MARGIN = 28;
    const pageW = doc.page.width;
    const y = MARGIN;

    // Logo
    const logoBox = 46;
    if (logo) {
        try { doc.image(logo, MARGIN, y, { fit: [logoBox, logoBox] }); } catch {}
    } else {
        doc.rect(MARGIN, y, logoBox, logoBox).fill(NAVY);
        doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20)
            .text('EP', MARGIN, y + 14, { width: logoBox, align: 'center' });
    }

    const textX = MARGIN + logoBox + 12;
    const rightBlockW = 220;

    // School name
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(16)
        .text(school.name || FALLBACK_SCHOOL, textX, y + 2, { width: pageW - textX - MARGIN - rightBlockW });

    // Contact line
    const contactBits = [school.address, school.phone, school.email].filter(Boolean);
    if (contactBits.length) {
        doc.fillColor(GRAY).font('Helvetica').fontSize(8)
            .text(contactBits.join('  |  '), textX, y + 24, { width: pageW - textX - MARGIN - rightBlockW });
    }

    // Motto
    if (school.motto) {
        doc.fillColor(NAVY).font('Helvetica-Oblique').fontSize(8)
            .text(school.motto, textX, y + 36, { width: pageW - textX - MARGIN - rightBlockW });
    }

    // Right block: title + subtitle
    doc.fillColor(SLATE).font('Helvetica-Bold').fontSize(11)
        .text(title, pageW - MARGIN - rightBlockW, y + 4, { width: rightBlockW, align: 'right' });
    if (subtitle) {
        doc.fillColor(GRAY).font('Helvetica').fontSize(9)
            .text(subtitle, pageW - MARGIN - rightBlockW, y + 20, { width: rightBlockW, align: 'right' });
    }

    // Divider under header
    const dividerY = y + logoBox + 8;
    doc.moveTo(MARGIN, dividerY).lineTo(pageW - MARGIN, dividerY)
        .lineWidth(1.2).strokeColor(NAVY).stroke();

    return dividerY + 12;
}

// Draws the branded footer at the bottom.
function drawFooter(doc, school) {
    const MARGIN = 28;
    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const y = pageH - 34;

    doc.moveTo(MARGIN, y).lineTo(pageW - MARGIN, y)
        .lineWidth(0.5).strokeColor(BORDER).stroke();

    const year = new Date().getFullYear();
    const left = `© ${year} ${school.name || FALLBACK_SCHOOL}. All rights reserved.`;
    const right = `Generated ${new Date().toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' })}`;

    doc.fillColor(GRAY).font('Helvetica').fontSize(7.5)
        .text(left, MARGIN, y + 6, { width: pageW / 2, align: 'left' });
    if (school.motto) {
        doc.fillColor(NAVY).font('Helvetica-Oblique').fontSize(7.5)
            .text(school.motto, pageW / 2 - 60, y + 6, { width: 120, align: 'center' });
    }
    doc.fillColor(GRAY).font('Helvetica').fontSize(7.5)
        .text(right, pageW - MARGIN - pageW / 2, y + 6, { width: pageW / 2, align: 'right' });
}

// ============================================================
// Class timetable — fits exactly one A4 landscape page.
// ============================================================
function drawClassTimetable(doc, school, logo, schedule, className, term, year) {
    const MARGIN = 28;
    const pageW = doc.page.width;
    const startY = drawHeader(doc, school, logo, 'Class Master Timetable', `${className} · ${term} ${year}`);

    const footerTop = doc.page.height - 40;
    const availableH = footerTop - startY - 8;

    // Column widths
    const timeColW = 78;
    const dayColW = (pageW - MARGIN * 2 - timeColW) / DAYS.length;
    const totalCols = DAYS.length + 1;

    // Row heights — PERIODS total 10 (8 class + 2 break)
    const breakRowH = 16;
    const numBreaks = PERIODS.filter(p => p.type === 'break').length;
    const numClass = PERIODS.length - numBreaks;
    const classRowH = (availableH - breakRowH * numBreaks) / numClass;

    // Header row
    let y = startY;
    const headerH = 22;
    doc.rect(MARGIN, y, pageW - MARGIN * 2, headerH).fill(NAVY);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9);

    // "Time / Day" cell
    doc.text('Time / Day', MARGIN, y + 6, { width: timeColW, align: 'center' });
    for (let i = 0; i < DAYS.length; i++) {
        const cx = MARGIN + timeColW + dayColW * i;
        doc.text(DAYS[i].toUpperCase(), cx, y + 6, { width: dayColW, align: 'center' });
    }
    y += headerH;

    // Body rows
    for (const period of PERIODS) {
        const rowH = period.type === 'break' ? breakRowH : classRowH;

        if (period.type === 'break') {
            // Break row spans all columns
            doc.rect(MARGIN, y, pageW - MARGIN * 2, rowH).fill(BREAK_BG);
            doc.strokeColor(BORDER).lineWidth(0.5)
                .rect(MARGIN, y, pageW - MARGIN * 2, rowH).stroke();
            doc.fillColor(BREAK_FG).font('Helvetica-Bold').fontSize(7.5)
                .text(`${period.label}  (${period.time})`,
                    MARGIN, y + (rowH - 8) / 2, { width: pageW - MARGIN * 2, align: 'center', characterSpacing: 1 });
        } else {
            // Time column
            doc.rect(MARGIN, y, timeColW, rowH).fill(LIGHT);
            doc.strokeColor(BORDER).lineWidth(0.5).rect(MARGIN, y, timeColW, rowH).stroke();
            doc.fillColor(SLATE).font('Helvetica-Bold').fontSize(7.5)
                .text(period.name, MARGIN + 3, y + 4, { width: timeColW - 6, align: 'center' });
            doc.fillColor(GRAY).font('Helvetica').fontSize(6.5)
                .text(period.time, MARGIN + 3, y + 14, { width: timeColW - 6, align: 'center' });

            // Day cells
            for (let i = 0; i < DAYS.length; i++) {
                const day = DAYS[i];
                const cx = MARGIN + timeColW + dayColW * i;
                const slot = schedule?.[day]?.[period.id];

                doc.rect(cx, y, dayColW, rowH).strokeColor(BORDER).lineWidth(0.5).stroke();

                if (slot) {
                    // Subject
                    doc.fillColor(SLATE).font('Helvetica-Bold').fontSize(7)
                        .text(slot.subject || '', cx + 3, y + 4, { width: dayColW - 6, align: 'left', ellipsis: true });
                    // Teacher initials
                    doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(7.5)
                        .text(slot.teacherInitials || 'TBA', cx + 3, y + 15, { width: dayColW - 6, align: 'left' });
                    // Room (small)
                    if (slot.room) {
                        doc.fillColor(GRAY).font('Helvetica').fontSize(6)
                            .text(slot.room, cx + 3, y + 25, { width: dayColW - 6, align: 'left', ellipsis: true });
                    }
                }
            }
        }
        y += rowH;
    }

    drawFooter(doc, school);
}

// ============================================================
// Teacher timetables — one teacher per page (or two per page if short).
// ============================================================
function drawTeacherTimetable(doc, school, logo, teacher, assignments, term, year) {
    const MARGIN = 28;
    const pageW = doc.page.width;
    const startY = drawHeader(doc, school, logo, 'Teacher Timetable', `${teacher.fullName} (${teacher.initials}) · ${term} ${year}`);

    const footerTop = doc.page.height - 40;
    const availableH = footerTop - startY - 8;

    const timeColW = 78;
    const dayColW = (pageW - MARGIN * 2 - timeColW) / DAYS.length;

    const headerH = 22;
    const rowH = (availableH - headerH) / CLASS_PERIODS.length;

    let y = startY;
    doc.rect(MARGIN, y, pageW - MARGIN * 2, headerH).fill(NAVY);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9)
        .text('Time / Day', MARGIN, y + 6, { width: timeColW, align: 'center' });
    for (let i = 0; i < DAYS.length; i++) {
        const cx = MARGIN + timeColW + dayColW * i;
        doc.text(DAYS[i].toUpperCase(), cx, y + 6, { width: dayColW, align: 'center' });
    }
    y += headerH;

    for (const period of CLASS_PERIODS) {
        doc.rect(MARGIN, y, timeColW, rowH).fill(LIGHT);
        doc.strokeColor(BORDER).lineWidth(0.5).rect(MARGIN, y, timeColW, rowH).stroke();
        doc.fillColor(SLATE).font('Helvetica-Bold').fontSize(7.5)
            .text(period.name, MARGIN + 3, y + rowH / 2 - 8, { width: timeColW - 6, align: 'center' });
        doc.fillColor(GRAY).font('Helvetica').fontSize(6.5)
            .text(period.time, MARGIN + 3, y + rowH / 2 + 2, { width: timeColW - 6, align: 'center' });

        for (let i = 0; i < DAYS.length; i++) {
            const day = DAYS[i];
            const cx = MARGIN + timeColW + dayColW * i;
            const slot = assignments.find(a => a.day === day && a.period.id === period.id);

            doc.rect(cx, y, dayColW, rowH).strokeColor(BORDER).lineWidth(0.5).stroke();
            if (slot) {
                doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(7)
                    .text(slot.subject, cx + 3, y + 5, { width: dayColW - 6, align: 'left', ellipsis: true });
                doc.fillColor(GRAY).font('Helvetica').fontSize(6.5)
                    .text(slot.className, cx + 3, y + 16, { width: dayColW - 6, align: 'left' });
            }
        }
        y += rowH;
    }

    drawFooter(doc, school);
}

// ============================================================
// Master overview — grouped by level. One level per page.
// ============================================================
function drawMasterByLevel(doc, school, logo, level, classes, schedules, term, year) {
    const MARGIN = 28;
    const pageW = doc.page.width;
    const levelName = LEVEL_DISPLAY[level] || level;
    const startY = drawHeader(doc, school, logo, 'Master Timetable Overview', `${levelName} · ${term} ${year}`);

    const footerTop = doc.page.height - 40;
    let y = startY + 4;

    const timeColW = 70;
    const dayColW = (pageW - MARGIN * 2 - timeColW) / DAYS.length;

    for (const cls of classes) {
        const schedule = schedules[cls] || {};

        // Class name strip
        const stripH = 14;
        if (y + stripH + 60 > footerTop) {
            // not enough room — start new page for the rest
            doc.addPage();
            drawHeader(doc, school, logo, 'Master Timetable Overview', `${levelName} · ${term} ${year}`);
            y = startY + 4;
        }
        doc.rect(MARGIN, y, pageW - MARGIN * 2, stripH).fill(SLATE);
        doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8)
            .text(cls.toUpperCase(), MARGIN + 6, y + 3, { width: pageW - MARGIN * 2, align: 'left' });
        y += stripH;

        // Grid
        const headerH = 14;
        const rowH = 16;
        const totalH = headerH + CLASS_PERIODS.length * rowH;

        doc.rect(MARGIN, y, pageW - MARGIN * 2, headerH).fill(LIGHT);
        doc.fillColor(SLATE).font('Helvetica-Bold').fontSize(7)
            .text('Time', MARGIN, y + 4, { width: timeColW, align: 'center' });
        for (let i = 0; i < DAYS.length; i++) {
            const cx = MARGIN + timeColW + dayColW * i;
            doc.text(DAYS[i].slice(0, 3).toUpperCase(), cx, y + 4, { width: dayColW, align: 'center' });
        }
        y += headerH;

        for (const period of CLASS_PERIODS) {
            doc.rect(MARGIN, y, timeColW, rowH).fill(LIGHT);
            doc.strokeColor(BORDER).lineWidth(0.4).rect(MARGIN, y, timeColW, rowH).stroke();
            doc.fillColor(GRAY).font('Helvetica').fontSize(6.5)
                .text(period.name.replace('Period ', 'P'), MARGIN, y + 5, { width: timeColW, align: 'center' });

            for (let i = 0; i < DAYS.length; i++) {
                const day = DAYS[i];
                const cx = MARGIN + timeColW + dayColW * i;
                const slot = schedule?.[day]?.[period.id];
                doc.rect(cx, y, dayColW, rowH).strokeColor(BORDER).lineWidth(0.4).stroke();
                if (slot) {
                    doc.fillColor(SLATE).font('Helvetica-Bold').fontSize(6)
                        .text(slot.subject || '', cx + 2, y + 2, { width: dayColW - 4, align: 'center', ellipsis: true });
                    doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(6)
                        .text(slot.teacherInitials || '', cx + 2, y + 9, { width: dayColW - 4, align: 'center' });
                }
            }
            y += rowH;
        }

        y += 6; // gap between classes

        // If this class ran over the footer, break page
        if (y > footerTop - rowH) {
            doc.addPage();
            drawHeader(doc, school, logo, 'Master Timetable Overview', `${levelName} · ${term} ${year}`);
            y = startY + 4;
        }
    }

    drawFooter(doc, school);
}

// ============================================================
// Duty roster — one page
// ============================================================
function drawDutyRoster(doc, school, logo, roster, term, year) {
    const MARGIN = 28;
    const pageW = doc.page.width;
    const startY = drawHeader(doc, school, logo, 'Weekly Duty Roster', `${term} ${year}`);

    const footerTop = doc.page.height - 40;
    const availableH = footerTop - startY - 8;

    const areaColW = 150;
    const dayColW = (pageW - MARGIN * 2 - areaColW) / DAYS.length;

    const headerH = 22;
    const rowH = (availableH - headerH) / DUTY_AREAS.length;

    let y = startY;
    doc.rect(MARGIN, y, pageW - MARGIN * 2, headerH).fill(NAVY);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9)
        .text('Duty Area / Time', MARGIN + 4, y + 6, { width: areaColW, align: 'left' });
    for (let i = 0; i < DAYS.length; i++) {
        const cx = MARGIN + areaColW + dayColW * i;
        doc.text(DAYS[i].toUpperCase(), cx, y + 6, { width: dayColW, align: 'center' });
    }
    y += headerH;

    for (const area of DUTY_AREAS) {
        doc.rect(MARGIN, y, areaColW, rowH).fill(LIGHT);
        doc.strokeColor(BORDER).lineWidth(0.5).rect(MARGIN, y, areaColW, rowH).stroke();
        doc.fillColor(SLATE).font('Helvetica-Bold').fontSize(7.5)
            .text(area.label, MARGIN + 4, y + 5, { width: areaColW - 8, align: 'left' });
        doc.fillColor(GRAY).font('Helvetica').fontSize(6.5)
            .text(area.time, MARGIN + 4, y + 14, { width: areaColW - 8, align: 'left' });

        for (let i = 0; i < DAYS.length; i++) {
            const day = DAYS[i];
            const cx = MARGIN + areaColW + dayColW * i;
            const entry = roster?.[day]?.[area.id];
            doc.rect(cx, y, dayColW, rowH).strokeColor(BORDER).lineWidth(0.5).stroke();
            if (entry) {
                doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(8)
                    .text(entry.teacherInitials || '', cx + 2, y + 4, { width: dayColW - 4, align: 'center' });
                doc.fillColor(GRAY).font('Helvetica').fontSize(6)
                    .text(entry.teacherFullName || '', cx + 2, y + 14, { width: dayColW - 4, align: 'center', ellipsis: true });
            }
        }
        y += rowH;
    }

    drawFooter(doc, school);
}

// ---------- level names map (mirrors client constants) ----------
const LEVEL_DISPLAY = {
    'pre-primary': 'Pre-Primary',
    'lower-primary': 'Lower Primary',
    'upper-primary': 'Upper Primary',
    'junior-school': 'Junior School',
    'senior-school': 'Senior School'
};

// ---------- handler ----------
exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }
    let payload;
    try { payload = JSON.parse(event.body || '{}'); }
    catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

    const { type, school = {}, logoUrl, term = 'Term 1', year = new Date().getFullYear() } = payload;

    // Fetch logo once (may be null)
    const logo = await fetchLogo(logoUrl || school.logoUrl);

    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0 });
    doc.on('data', c => chunks.push(c));

    const done = new Promise((resolve, reject) => {
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
    });

    try {
        if (type === 'class') {
            const { className, schedule } = payload;
            drawClassTimetable(doc, school, logo, schedule || {}, className || '', term, year);
        } else if (type === 'teacher') {
            const { teacher, assignments } = payload;
            drawTeacherTimetable(doc, school, logo, teacher, assignments || [], term, year);
        } else if (type === 'master') {
            const { level, classes, schedules } = payload;
            drawMasterByLevel(doc, school, logo, level, classes || [], schedules || {}, term, year);
        } else if (type === 'duty') {
            drawDutyRoster(doc, school, logo, payload.roster || {}, term, year);
        } else {
            return { statusCode: 400, body: JSON.stringify({ error: 'Unknown type' }) };
        }

        doc.end();
        const pdfBuffer = await done;

        const safe = (s) => String(s || '').replace(/[^\w-]/g, '');
        const filename = `Timetable_${safe(payload.className || payload.teacher?.initials || payload.level || 'Roster')}_${safe(term)}_${year}.pdf`;

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*'
            },
            body: pdfBuffer.toString('base64'),
            isBase64Encoded: true
        };
    } catch (err) {
        console.error('timetable-pdf error:', err);
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*' },
            body: JSON.stringify({ error: err.message })
        };
    }
};