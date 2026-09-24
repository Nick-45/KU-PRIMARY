// netlify/functions/generate-ranking.js
const PDFDocument = require('pdfkit');
const axios = require('axios');

const FALLBACK_NAME = 'EDUPRIVA';
const FALLBACK_MOTTO = 'Powering Modern Education';

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return json(405, { error: 'Method Not Allowed' });
    }

    let payload;
    try {
        payload = JSON.parse(event.body || '{}');
    } catch {
        return json(400, { error: 'Invalid JSON body' });
    }

    const { students, meta } = payload;

    if (!Array.isArray(students) || students.length === 0) {
        return json(400, { error: 'students array is required and must not be empty' });
    }
    if (!meta || typeof meta !== 'object') {
        return json(400, { error: 'meta object is required' });
    }

    try {
        const pdfBuffer = await generateRankingPDF(students, meta);
        const safe = (s) => String(s || '').replace(/\s+/g, '_').replace(/[^\w-]/g, '');
        const filename = `ranking_${safe(meta.cls)}_${safe(meta.term)}_${safe(meta.year || new Date().getFullYear())}.pdf`;

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
        console.error('Ranking PDF generation error:', err);
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
    if (score >= 80) return { code: 'EE', points: 8 };
    if (score >= 65) return { code: 'ME', points: 6 };
    if (score >= 50) return { code: 'AE', points: 4 };
    if (score >= 40) return { code: 'BE', points: 2 };
    return { code: 'BE', points: 1 };
}

/**
 * Try to fetch the logo as a Buffer.
 * Returns null on any failure so the PDF still renders.
 */
async function fetchLogoBuffer(url) {
    if (!url || typeof url !== 'string') return null;
    try {
        const res = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 8000,
            // Some hosts block the default axios UA
            headers: { 'User-Agent': 'EduPriva-PDF/1.0' }
        });
        const buf = Buffer.from(res.data);
        // Reject absurdly large images
        if (buf.length > 2 * 1024 * 1024) {
            console.warn('Logo too large, skipping:', buf.length);
            return null;
        }
        return buf;
    } catch (err) {
        console.warn('Logo fetch failed (continuing without it):', err.message);
        return null;
    }
}

/**
 * Draw the school brand block at the top of a page.
 * Left: logo + name + motto. Right: "Ranking Report" badge + year.
 * Returns the Y coordinate where the caller should continue drawing.
 */
function drawHeader(doc, meta, logoBuffer, { pageWidth, margin = 30 }) {
    const year = meta.year || new Date().getFullYear();
    const schoolName = meta.schoolName || FALLBACK_NAME;
    const motto = meta.schoolMotto || FALLBACK_MOTTO;

    const headerY = margin;
    const logoSize = 48;
    const textX = margin + (logoBuffer ? logoSize + 12 : 0);

    // --- Logo (only if we got bytes) ---
    if (logoBuffer) {
        try {
            doc.image(logoBuffer, margin, headerY, {
                fit: [logoSize, logoSize]
            });
        } catch (e) {
            console.warn('Failed to embed logo:', e.message);
        }
    }

    // --- School name ---
    doc
        .fontSize(16)
        .fillColor('#1a237e')
        .font('Helvetica-Bold')
        .text(schoolName, textX, headerY + 2, { width: pageWidth - textX - margin - 140 });

    // --- Motto ---
    if (motto) {
        doc
            .fontSize(9)
            .fillColor('#666')
            .font('Helvetica-Oblique')
            .text(motto, textX, headerY + 24, {
                width: pageWidth - textX - margin - 140
            });
    }

    // --- Report badge (right side) ---
    const badgeW = 130;
    const badgeH = 40;
    const badgeX = pageWidth - margin - badgeW;
    const badgeY = headerY;

    doc
        .roundedRect(badgeX, badgeY, badgeW, badgeH, 4)
        .lineWidth(2)
        .strokeColor('#1a237e')
        .stroke();

    doc
        .fontSize(11)
        .fillColor('#1a237e')
        .font('Helvetica-Bold')
        .text('RANKING REPORT', badgeX, badgeY + 6, { width: badgeW, align: 'center' });

    doc
        .fontSize(9)
        .fillColor('#666')
        .font('Helvetica')
        .text(String(year), badgeX, badgeY + 22, { width: badgeW, align: 'center' });

    // --- Divider ---
    const dividerY = headerY + logoSize + 8;
    doc
        .moveTo(margin, dividerY)
        .lineTo(pageWidth - margin, dividerY)
        .lineWidth(2)
        .strokeColor('#1a237e')
        .stroke();

    return dividerY + 12;
}

// ---------------- Main PDF builder ----------------

function generateRankingPDF(students, meta) {
    return fetchLogoBuffer(meta.schoolLogo).then((logoBuffer) => {
        return new Promise((resolve, reject) => {
            const doc = new PDFDocument({
                size: 'A4',
                layout: 'landscape',
                margin: 30,
                autoFirstPage: true
            });

            const chunks = [];
            doc.on('data', (c) => chunks.push(c));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            const pageWidth = doc.page.width;
            const pageHeight = doc.page.height;
            const margin = 30;

            // ---- Header ----
            let y = drawHeader(doc, meta, logoBuffer, { pageWidth, margin });

            // ---- Sub-header: level | class | term | assessment ----
            doc
                .fontSize(10)
                .fillColor('#333')
                .font('Helvetica-Bold')
                .text(
                    `${meta.level || ''}  |  Class: ${meta.cls || ''}  |  ${meta.term || ''}  |  ${meta.assessmentType || ''}`,
                    margin,
                    y,
                    { width: pageWidth - margin * 2, align: 'center' }
                );

            y += 20;

            // ---- Build columns ----
            const allSubjects = Array.isArray(meta.subjects) ? meta.subjects : [];

            // Column widths — subjects get a smaller fixed width; name shrinks if needed
            const rankW = 36;
            const nameW = 130;
            const admW = 70;
            const subjectW = Math.max(48, Math.min(70, Math.floor(
                (pageWidth - margin * 2 - rankW - nameW - admW - 50 - 50 - 45) /
                Math.max(1, allSubjects.length)
            )));
            const totalW = 50;
            const avgW = 50;
            const gradeW = 45;

            const cols = [
                { w: rankW, h: 'Rank' },
                { w: nameW, h: 'Name' },
                { w: admW, h: 'Adm No' },
                ...allSubjects.map((s) => ({
                    w: subjectW,
                    h: String(s).length > 9 ? String(s).slice(0, 8) + '…' : String(s)
                })),
                { w: totalW, h: 'Total' },
                { w: avgW, h: 'Avg' },
                { w: gradeW, h: 'Grade' }
            ];

            const totalColsWidth = cols.reduce((a, c) => a + c.w, 0);
            let startX = (pageWidth - totalColsWidth) / 2;

            // ---- Draw header row ----
            const drawTableHeader = (topY) => {
                doc.rect(startX, topY, totalColsWidth, 20).fill('#1a237e');
                doc.fillColor('#fff').fontSize(8).font('Helvetica-Bold');
                let cx = startX + 4;
                cols.forEach((c) => {
                    doc.text(c.h, cx, topY + 6, {
                        width: c.w - 8,
                        align: 'center',
                        ellipsis: true
                    });
                    cx += c.w;
                });
                return topY + 22;
            };

            y = drawTableHeader(y);

            // ---- Rows ----
            doc.fillColor('#000').font('Helvetica');

            students.forEach((s, idx) => {
                // Page break check
                if (y > pageHeight - 40) {
                    doc.addPage({ layout: 'landscape' });
                    // Optional: repeat brand header on continuation pages
                    // y = drawHeader(doc, meta, logoBuffer, { pageWidth, margin });
                    y = drawTableHeader(margin);
                }

                // Zebra striping
                const rowH = 16;
                if (idx % 2 === 1) {
                    doc.rect(startX, y - 2, totalColsWidth, rowH).fill('#f5f7fb');
                    doc.fillColor('#000');
                }

                doc.fontSize(8).font('Helvetica');

                const row = [
                    `#${idx + 1}`,
                    `${s.firstName || ''} ${s.lastName || ''}`.trim(),
                    s.admissionNumber || s.studentId || 'N/A',
                    ...allSubjects.map((sub) => {
                        const sc = (s.subjectScores || {})[sub];
                        return sc != null ? String(sc) : '-';
                    }),
                    String(s.totalMarks || 0),
                    `${s.average || 0}%`,
                    s.cbcGrade?.code || cbcGrade(s.average || 0).code
                ];

                let rx = startX + 4;
                row.forEach((val, i) => {
                    doc.text(String(val), rx, y, {
                        width: cols[i].w - 8,
                        align: i === 1 ? 'left' : 'center',
                        ellipsis: true
                    });
                    rx += cols[i].w;
                });

                y += rowH;
                doc
                    .moveTo(startX, y - 2)
                    .lineTo(startX + totalColsWidth, y - 2)
                    .lineWidth(0.5)
                    .strokeColor('#e6e6e6')
                    .stroke();
            });

            // ---- Summary footer ----
            y += 10;
            if (y > pageHeight - 50) {
                doc.addPage({ layout: 'landscape' });
                y = margin + 10;
            }

            const scored = students.filter((s) => (s.average || 0) > 0);
            const classMean = scored.length
                ? Math.round(scored.reduce((a, s) => a + s.average, 0) / scored.length)
                : 0;
            const highest = scored.length ? Math.max(...scored.map((s) => s.average)) : 0;
            const lowest = scored.length ? Math.min(...scored.map((s) => s.average)) : 0;

            doc
                .fontSize(9)
                .fillColor('#333')
                .font('Helvetica-Bold')
                .text(
                    `Students: ${students.length}   •   Class Mean: ${classMean}% (${cbcGrade(classMean).code})   •   Highest: ${highest}%   •   Lowest: ${lowest}%`,
                    margin,
                    y,
                    { width: pageWidth - margin * 2, align: 'center' }
                );

            y += 16;
            doc
                .fontSize(8)
                .fillColor('#999')
                .font('Helvetica')
                .text(
                    `Generated: ${new Date().toLocaleString()}  •  ${meta.schoolName || FALLBACK_NAME}  •  ${yearFrom(meta)}`,
                    margin,
                    y,
                    { width: pageWidth - margin * 2, align: 'center' }
                );

            doc.end();
        });
    });
}

function yearFrom(meta) {
    return meta?.year || new Date().getFullYear();
}
