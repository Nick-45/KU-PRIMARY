// services/ExportService.js
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import { storage } from '../firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

// ---------- colours (matching the rest of the app) ----------
const NAVY = [26, 35, 126];     // #1a237e
const SLATE = [44, 62, 80];     // #2c3e50
const GREEN = [39, 174, 96];    // #27ae60
const GRAY = [100, 116, 139];   // #64748b
const LIGHT = [241, 245, 249];  // #f1f5f9
const BORDER = [203, 213, 225]; // #cbd5e1

// ---------- layout constants ----------
const MARGIN = 14;              // mm
const HEADER_H = 26;            // mm
const FOOTER_H = 12;            // mm

// ---------- image loading ----------
// jsPDF needs a data URL or base64. Fetch once, convert, cache for the run.
let _logoCache = {}; // { url: { dataUrl, format } }
async function loadImageAsDataURL(url) {
    if (!url) return null;
    if (_logoCache[url]) return _logoCache[url];
    try {
        const res = await fetch(url, { mode: 'cors' });
        if (!res.ok) return null;
        const blob = await res.blob();
        const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
        // Detect format from mime type
        const mime = blob.type || '';
        let format = 'PNG';
        if (mime.includes('jpeg') || mime.includes('jpg')) format = 'JPEG';
        else if (mime.includes('webp')) format = 'WEBP';
        const entry = { dataUrl, format };
        _logoCache[url] = entry;
        return entry;
    } catch (err) {
        console.warn('Logo load failed:', err.message);
        return null;
    }
}

class ExportService {
    // ============================================================
    // THE HEADER / FOOTER — drawn on every page
    // ============================================================
    drawHeader(pdf, school, logo) {
        const pageW = pdf.internal.pageSize.getWidth();
        const y = MARGIN;

        // Logo (or placeholder navy box with initials)
        const logoBox = 18;
        if (logo?.dataUrl) {
            try {
                pdf.addImage(logo.dataUrl, logo.format, MARGIN, y, logoBox, logoBox, undefined, 'FAST');
            } catch {
                this._drawLogoPlaceholder(pdf, MARGIN, y, logoBox, school);
            }
        } else {
            this._drawLogoPlaceholder(pdf, MARGIN, y, logoBox, school);
        }

        const textX = MARGIN + logoBox + 5;
        const rightW = 60;
        const textW = pageW - textX - MARGIN - rightW;

        // School name
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(13);
        pdf.setTextColor(...NAVY);
        pdf.text(school.name || 'School', textX, y + 5, { maxWidth: textW });

        // Contact line
        const bits = [school.address, school.phone, school.email].filter(Boolean);
        if (bits.length) {
            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(7.5);
            pdf.setTextColor(...GRAY);
            pdf.text(bits.join('  |  '), textX, y + 10, { maxWidth: textW });
        }

        // Motto
        if (school.motto) {
            pdf.setFont('helvetica', 'italic');
            pdf.setFontSize(7.5);
            pdf.setTextColor(...NAVY);
            pdf.text(school.motto, textX, y + 14.5, { maxWidth: textW });
        }

        // Right-hand badge: "OFFICIAL EXPORT"
        const badgeW = 46;
        const badgeH = 9;
        const badgeX = pageW - MARGIN - badgeW;
        const badgeY = y + 2;
        pdf.setDrawColor(...NAVY);
        pdf.setLineWidth(0.5);
        pdf.roundedRect(badgeX, badgeY, badgeW, badgeH, 1.5, 1.5, 'S');
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(7);
        pdf.setTextColor(...NAVY);
        pdf.text('OFFICIAL EXPORT', badgeX + badgeW / 2, badgeY + 6, { align: 'center' });

        // Divider
        pdf.setDrawColor(...NAVY);
        pdf.setLineWidth(0.6);
        pdf.line(MARGIN, y + logoBox + 3, pageW - MARGIN, y + logoBox + 3);

        return y + logoBox + 8; // Y where content can start
    }

    _drawLogoPlaceholder(pdf, x, y, size, school) {
        pdf.setFillColor(...NAVY);
        pdf.rect(x, y, size, size, 'F');
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(11);
        pdf.setTextColor(255, 255, 255);
        const initials = (school?.name || 'S').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
        pdf.text(initials, x + size / 2, y + size / 2 + 3, { align: 'center' });
    }

    drawFooter(pdf, school, exitId) {
        const pageW = pdf.internal.pageSize.getWidth();
        const pageH = pdf.internal.pageSize.getHeight();
        const y = pageH - MARGIN;

        pdf.setDrawColor(...BORDER);
        pdf.setLineWidth(0.3);
        pdf.line(MARGIN, y - 8, pageW - MARGIN, y - 8);

        const year = new Date().getFullYear();
        const left = `\u00A9 ${year} ${school.name || 'School'}. All rights reserved.`;
        const right = `Exit ID: ${exitId || 'N/A'}`;

        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7);
        pdf.setTextColor(...GRAY);
        pdf.text(left, MARGIN, y - 4);

        if (school.motto) {
            pdf.setFont('helvetica', 'italic');
            pdf.setTextColor(...NAVY);
            pdf.text(school.motto, pageW / 2, y - 4, { align: 'center' });
        }

        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(...GRAY);
        pdf.text(right, pageW - MARGIN, y - 4, { align: 'right' });

        // Page number
        const pageNum = pdf.internal.getNumberOfPages();
        pdf.setFontSize(6.5);
        pdf.text(`Page ${pageNum}`, pageW - MARGIN, y, { align: 'right' });
    }

    // Called after content — draws the header/footer on every page that exists.
    // We do it after-the-fact so we don't have to track page breaks manually.
    _brandAllPages(pdf, school, logo, exitId) {
        const total = pdf.internal.getNumberOfPages();
        for (let i = 1; i <= total; i++) {
            pdf.setPage(i);
            this.drawHeader(pdf, school, logo);
            this.drawFooter(pdf, school, exitId);
        }
    }

    // ============================================================
    // MAIN ENTRY
    // ============================================================
    async generateSchoolExitPackage(schoolId, schoolData, exitId) {
        const pdf = new jsPDF('p', 'mm', 'a4');
        const pageW = pdf.internal.pageSize.getWidth();
        const pageH = pdf.internal.pageSize.getHeight();

        // Preload logo
        const logo = await loadImageAsDataURL(schoolData.logoUrl);

        // Content area bounds (below the header, above the footer)
        const contentTop = MARGIN + 26;
        const contentBottom = pageH - MARGIN - 12;
        const contentH = contentBottom - contentTop;

        // ---------------- COVER PAGE ----------------
        this.drawHeader(pdf, schoolData, logo);

        let coverY = contentTop + 30;

        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(28);
        pdf.setTextColor(...NAVY);
        pdf.text('School Data Export', pageW / 2, coverY, { align: 'center' });

        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(14);
        pdf.setTextColor(...SLATE);
        pdf.text(schoolData.name || 'School', pageW / 2, coverY + 12, { align: 'center' });

        if (schoolData.motto) {
            pdf.setFont('helvetica', 'italic');
            pdf.setFontSize(11);
            pdf.setTextColor(...NAVY);
            pdf.text(schoolData.motto, pageW / 2, coverY + 20, { align: 'center' });
        }

        // Divider
        pdf.setDrawColor(...BORDER);
        pdf.setLineWidth(0.3);
        pdf.line(pageW / 2 - 40, coverY + 28, pageW / 2 + 40, coverY + 28);

        // Metadata block
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(10);
        pdf.setTextColor(...GRAY);

        const metaY = coverY + 40;
        const labelW = 40;
        const rowGap = 8;
        const leftCol = pageW / 2 - 45;
        const rows = [
            ['School ID',     schoolId || 'N/A'],
            ['Curriculum',    schoolData.curriculum || 'N/A'],
            ['Subscription',  schoolData.subscriptionStatus || 'N/A'],
            ['Export Date',   new Date().toLocaleDateString()],
            ['Export Time',   new Date().toLocaleTimeString()],
            ['Exit ID',       exitId || 'N/A'],
        ];

        rows.forEach(([k, v], i) => {
            const ry = metaY + i * rowGap;
            pdf.setFont('helvetica', 'bold');
            pdf.setTextColor(...SLATE);
            pdf.text(`${k}:`, leftCol, ry);
            pdf.setFont('helvetica', 'normal');
            pdf.setTextColor(...GRAY);
            pdf.text(String(v), leftCol + labelW, ry);
        });

        // Summary box
        const summaryY = metaY + rows.length * rowGap + 10;
        pdf.setFillColor(...LIGHT);
        pdf.roundedRect(MARGIN + 20, summaryY, pageW - MARGIN * 2 - 40, 28, 2, 2, 'F');
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(9);
        pdf.setTextColor(...SLATE);
        pdf.text('EXPORT CONTENTS', MARGIN + 26, summaryY + 6);

        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);
        pdf.setTextColor(...GRAY);
        const contentsLine = [
            `Students: ${(schoolData.students || []).length}`,
            `Teachers: ${(schoolData.teachers || []).length}`,
            `Exams: ${(schoolData.exams || []).length}`,
            `Scores: ${(schoolData.scores || []).length}`,
            `Submissions: ${(schoolData.submissions || []).length}`,
        ].join('    |    ');
        pdf.text(contentsLine, MARGIN + 26, summaryY + 14);

        pdf.setFontSize(7.5);
        pdf.text('This document is confidential and intended solely for the named school and its designated recipients.',
            MARGIN + 26, summaryY + 22);

        // ---------------- TABLE OF CONTENTS ----------------
        pdf.addPage();
        this.drawHeader(pdf, schoolData, logo);

        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(16);
        pdf.setTextColor(...NAVY);
        pdf.text('Table of Contents', pageW / 2, contentTop + 10, { align: 'center' });

        const toc = [
            '1. School Information',
            '2. Student Records',
            '3. Teacher Records',
            '4. Exam Records',
            '5. Data Summary',
        ];

        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(11);
        pdf.setTextColor(...SLATE);

        toc.forEach((item, i) => {
            const ty = contentTop + 28 + i * 10;
            pdf.text(item, MARGIN + 20, ty);
            pdf.setTextColor(...GRAY);
            pdf.text('—', pageW - MARGIN - 20, ty, { align: 'right' });
            pdf.setTextColor(...SLATE);
        });

        // ---------------- SECTION 1: SCHOOL INFORMATION ----------------
        pdf.addPage();
        this.drawHeader(pdf, schoolData, logo);

        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(14);
        pdf.setTextColor(...NAVY);
        pdf.text('1. School Information', MARGIN, contentTop + 8);

        pdf.autoTable({
            startY: contentTop + 14,
            head: [['Field', 'Value']],
            body: [
                ['School Name',           schoolData.name || 'N/A'],
                ['School ID',             schoolId],
                ['School Type',           schoolData.schoolType || 'N/A'],
                ['Curriculum',            schoolData.curriculum || 'N/A'],
                ['Highest Level',         schoolData.highestLevel || 'N/A'],
                ['Motto',                 schoolData.motto || 'N/A'],
                ['Email',                 schoolData.email || 'N/A'],
                ['Phone',                 schoolData.phone || 'N/A'],
                ['Address',               schoolData.address || 'N/A'],
                ['City',                  schoolData.city || 'N/A'],
                ['Country',               schoolData.country || 'N/A'],
                ['Subscription Status',   schoolData.subscriptionStatus || 'N/A'],
            ],
            theme: 'grid',
            headStyles: { fillColor: NAVY, textColor: 255, fontSize: 9, fontStyle: 'bold' },
            bodyStyles: { fontSize: 9, textColor: SLATE },
            alternateRowStyles: { fillColor: LIGHT },
            styles: { cellPadding: 2.5, lineColor: BORDER, lineWidth: 0.2 },
            columnStyles: {
                0: { cellWidth: 60, fontStyle: 'bold' },
                1: { cellWidth: 110 },
            },
            margin: { left: MARGIN, right: MARGIN, top: contentTop, bottom: MARGIN + 12 },
        });

        // ---------------- SECTION 2: STUDENT RECORDS ----------------
        pdf.addPage();
        this.drawHeader(pdf, schoolData, logo);

        const students = schoolData.students || [];

        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(14);
        pdf.setTextColor(...NAVY);
        pdf.text('2. Student Records', MARGIN, contentTop + 8);

        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(9);
        pdf.setTextColor(...GRAY);
        pdf.text(`Total: ${students.length} record${students.length === 1 ? '' : 's'}`, MARGIN, contentTop + 13);

        pdf.autoTable({
            startY: contentTop + 17,
            head: [['ID', 'Name', 'Level', 'Class', 'Status']],
            body: students.map(s => [
                s.studentId || 'N/A',
                `${s.firstName || ''} ${s.lastName || ''}`.trim(),
                s.level || 'N/A',
                s.class || 'N/A',
                s.status || 'active',
            ]),
            theme: 'grid',
            headStyles: { fillColor: NAVY, textColor: 255, fontSize: 8, fontStyle: 'bold' },
            bodyStyles: { fontSize: 8, textColor: SLATE },
            alternateRowStyles: { fillColor: LIGHT },
            styles: { cellPadding: 2, lineColor: BORDER, lineWidth: 0.2 },
            columnStyles: {
                0: { cellWidth: 30 },
                1: { cellWidth: 50 },
                2: { cellWidth: 30 },
                3: { cellWidth: 30 },
                4: { cellWidth: 25 },
            },
            margin: { left: MARGIN, right: MARGIN, top: contentTop + 17, bottom: MARGIN + 12 },
        });

        // ---------------- SECTION 3: TEACHER RECORDS ----------------
        pdf.addPage();
        this.drawHeader(pdf, schoolData, logo);

        const teachers = schoolData.teachers || [];

        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(14);
        pdf.setTextColor(...NAVY);
        pdf.text('3. Teacher Records', MARGIN, contentTop + 8);

        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(9);
        pdf.setTextColor(...GRAY);
        pdf.text(`Total: ${teachers.length} record${teachers.length === 1 ? '' : 's'}`, MARGIN, contentTop + 13);

        pdf.autoTable({
            startY: contentTop + 17,
            head: [['ID', 'Name', 'Email', 'Level', 'Subjects']],
            body: teachers.map(t => [
                t.teacherId || 'N/A',
                `${t.firstName || ''} ${t.lastName || ''}`.trim(),
                t.email || 'N/A',
                t.level || 'N/A',
                (t.subjects || []).join(', ') || 'N/A',
            ]),
            theme: 'grid',
            headStyles: { fillColor: NAVY, textColor: 255, fontSize: 8, fontStyle: 'bold' },
            bodyStyles: { fontSize: 8, textColor: SLATE },
            alternateRowStyles: { fillColor: LIGHT },
            styles: { cellPadding: 2, lineColor: BORDER, lineWidth: 0.2 },
            columnStyles: {
                0: { cellWidth: 28 },
                1: { cellWidth: 42 },
                2: { cellWidth: 50 },
                3: { cellWidth: 28 },
                4: { cellWidth: 40 },
            },
            margin: { left: MARGIN, right: MARGIN, top: contentTop + 17, bottom: MARGIN + 12 },
        });

        // ---------------- SECTION 4: EXAM RECORDS ----------------
        const exams = schoolData.exams || [];
        if (exams.length > 0) {
            pdf.addPage();
            this.drawHeader(pdf, schoolData, logo);

            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(14);
            pdf.setTextColor(...NAVY);
            pdf.text('4. Exam Records', MARGIN, contentTop + 8);

            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(9);
            pdf.setTextColor(...GRAY);
            pdf.text(`Total: ${exams.length} record${exams.length === 1 ? '' : 's'}`, MARGIN, contentTop + 13);

            pdf.autoTable({
                startY: contentTop + 17,
                head: [['Title', 'Class', 'Subject', 'Status', 'Date']],
                body: exams.map(e => [
                    e.title || 'N/A',
                    e.class || 'N/A',
                    e.subject || 'N/A',
                    e.status || 'N/A',
                    e.startDate ? new Date(e.startDate).toLocaleDateString() : 'N/A',
                ]),
                theme: 'grid',
                headStyles: { fillColor: NAVY, textColor: 255, fontSize: 8, fontStyle: 'bold' },
                bodyStyles: { fontSize: 8, textColor: SLATE },
                alternateRowStyles: { fillColor: LIGHT },
                styles: { cellPadding: 2, lineColor: BORDER, lineWidth: 0.2 },
                margin: { left: MARGIN, right: MARGIN, top: contentTop + 17, bottom: MARGIN + 12 },
            });
        }

        // ---------------- SECTION 5: DATA SUMMARY ----------------
        pdf.addPage();
        this.drawHeader(pdf, schoolData, logo);

        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(14);
        pdf.setTextColor(...NAVY);
        pdf.text('5. Data Summary', MARGIN, contentTop + 8);

        const retentionEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString();

        pdf.autoTable({
            startY: contentTop + 14,
            head: [['Metric', 'Value']],
            body: [
                ['Total Students',       schoolData.students?.length || 0],
                ['Total Teachers',       schoolData.teachers?.length || 0],
                ['Total Exams',          schoolData.exams?.length || 0],
                ['Total Scores',         schoolData.scores?.length || 0],
                ['Total Submissions',    schoolData.submissions?.length || 0],
                ['Export Date',          new Date().toLocaleDateString()],
                ['Export Time',          new Date().toLocaleTimeString()],
                ['Exit ID',              exitId || 'N/A'],
                ['Retention Period',     '30 Days'],
                ['Retention End Date',   retentionEnd],
            ],
            theme: 'grid',
            headStyles: { fillColor: NAVY, textColor: 255, fontSize: 9, fontStyle: 'bold' },
            bodyStyles: { fontSize: 9, textColor: SLATE },
            alternateRowStyles: { fillColor: LIGHT },
            styles: { cellPadding: 2.5, lineColor: BORDER, lineWidth: 0.2 },
            columnStyles: {
                0: { cellWidth: 70, fontStyle: 'bold' },
                1: { cellWidth: 100 },
            },
            margin: { left: MARGIN, right: MARGIN, top: contentTop + 14, bottom: MARGIN + 12 },
        });

        // ---------------- BRAND EVERY PAGE ----------------
        // We draw the header/footer last so we don't have to track page breaks
        // inside autoTable. This stamps them onto every page that exists.
        this._brandAllPages(pdf, schoolData, logo, exitId);

        return pdf.output('blob');
    }

    // ============================================================
    // UPLOAD (unchanged API)
    // ============================================================
    async uploadExportPDF(pdfBlob, schoolId, exitId) {
        const fileName = `exit_packages/${schoolId}/${exitId}_${Date.now()}.pdf`;
        const storageRef = ref(storage, fileName);
        await uploadBytes(storageRef, pdfBlob, { contentType: 'application/pdf' });
        const downloadUrl = await getDownloadURL(storageRef);
        return { url: downloadUrl, fileName };
    }
}

export default new ExportService();