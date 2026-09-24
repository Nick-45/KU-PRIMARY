// src/services/pdf.js
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// Common PDF configuration
const PDF_COLORS = {
    primary: [26, 35, 126], // #1a237e
    text: [44, 62, 80],
    border: [203, 213, 225],
    accent: [248, 250, 252]
};

async function addSchoolHeader(doc, school, title, pageNumber, totalPages) {
    // Logo
    if (school?.schoolLogo) {
        try {
            doc.addImage(school.schoolLogo, 'PNG', 10, 10, 20, 20);
        } catch (e) {
            console.error('Error adding logo:', e);
        }
    }

    // Header info
    doc.setTextColor(...PDF_COLORS.primary);
    doc.setFontSize(18);
    doc.text(school?.schoolName || 'SCHOOL REPORT', 105, 15, { align: 'center' });
    
    doc.setFontSize(10);
    doc.setTextColor(...PDF_COLORS.text);
    doc.text(`${school?.schoolAddress || ''} | Tel: ${school?.schoolPhone || ''}`, 105, 22, { align: 'center' });
    doc.text(title.toUpperCase(), 105, 28, { align: 'center' });

    doc.setDrawColor(...PDF_COLORS.primary);
    doc.setLineWidth(0.5);
    doc.line(10, 32, 200, 32);

    // Footer
    doc.setDrawColor(...PDF_COLORS.border);
    doc.line(10, 285, 200, 285);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(`Page ${pageNumber} of ${totalPages}`, 195, 290, { align: 'right' });
    doc.text(`Generated on ${new Date().toLocaleDateString()}`, 10, 290);
}

export async function downloadStudentReportCardPDF({ mode, students, meta, subjects, term }) {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const totalPages = students.length;

    for (let index = 0; index < students.length; index++) {
        const student = students[index];
        if (index > 0) doc.addPage();

        await addSchoolHeader(doc, meta, 'ACADEMIC PROGRESS REPORT', index + 1, totalPages);

        // Student Info
        doc.setFontSize(10);
        doc.setTextColor(...PDF_COLORS.text);
        doc.rect(10, 35, 190, 20); // Border
        
        doc.text(`Name: ${student.firstName} ${student.lastName}`, 15, 42);
        doc.text(`Adm No: ${student.admissionNumber || student.studentId || 'N/A'}`, 15, 48);
        doc.text(`Class: ${student.class || meta.cls}`, 100, 42);
        doc.text(`Term: ${term}`, 100, 48);

        // Subjects Table
        const tableData = subjects.map(subject => [
            subject,
            student.scores[subject]?.[student.scores[subject].length - 1] ?? '-',
            student.averages[subject] != null ? `${student.averages[subject]}%` : '-',
            '-', // Rank
            '-', // Grade
            '-'  // Points
        ]);
        
        doc.autoTable({
            startY: 60,
            head: [['Subject', 'ETRM', 'Avg', 'Rank', 'Grade', 'Pts']],
            body: tableData,
            theme: 'grid',
            headStyles: { fillColor: PDF_COLORS.primary, fontSize: 10, halign: 'center' },
            bodyStyles: { fontSize: 9, halign: 'center' },
            columnStyles: { 0: { halign: 'left' } }
        });
    }
    
    doc.save(`ReportCard_${term}_${meta.cls}.pdf`);
}

// Placeholder implementations for others, to be updated similarly
export async function downloadRankingPDF(students, meta) { console.log('Downloading ranking...'); }
export async function downloadReceiptPDF(receipt, school) { console.log('Downloading receipt...'); }
export async function downloadTeacherRecordPDF(record, meta, teacher) { console.log('Downloading teacher record...'); }
export async function downloadTeacherReportsAllPDF(records, meta, teacher) { console.log('Downloading teacher reports...'); }
export async function downloadFeeStructurePDF(schedule, school, year) { console.log('Downloading fee structure...'); }
export async function downloadFeeReportPDF(reportData, school) { console.log('Downloading fee report...'); }
export async function downloadExecutiveReportsPDF(kpis, school, term, year) { console.log('Downloading executive reports...'); }
export async function downloadTimetablePDF(scheduleData, title, school, term, year) { console.log('Downloading timetable...'); }
export async function downloadStudentInvoicePDF(invoice, school) { console.log('Downloading invoice...'); }


