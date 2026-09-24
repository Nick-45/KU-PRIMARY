// src/components/Fees/ReceiptModal.jsx
import React, { useRef } from 'react';

/**
 * ReceiptModal
 * ------------
 * Renders a printable A4 receipt preview and exposes two actions:
 *   - Print       → opens the browser print dialog (paper copy)
 *   - Download PDF → calls the parent's onDownloadPDF prop, which
 *                    POSTs to /api/generate-receipt and streams a
 *                    proper A4 PDF (not a screenshot).
 *
 * The parent owns the receipt data and the school branding,
 * this component is purely presentational.
 */
export default function ReceiptModal({ receiptData, schoolData, onClose, onDownloadPDF }) {
    const receiptRef = useRef();

    // ---- Print (paper copy) ----
    const handlePrint = () => {
        const node = receiptRef.current;
        if (!node) return;
        const w = window.open('', '_blank', 'width=900,height=700');
        w.document.write(`
            <html>
                <head>
                    <title>Receipt ${receiptData.receiptNumber}</title>
                    <style>
                        body { margin: 0; padding: 0; font-family: Arial, sans-serif; }
                        @media print { .no-print { display: none !important; } }
                    </style>
                </head>
                <body>${node.outerHTML}</body>
            </html>
        `);
        w.document.close();
        w.focus();
        w.print();
        w.close();
    };

    // ---- Download PDF (server-generated) ----
    const handleDownloadPDF = () => {
        if (typeof onDownloadPDF === 'function') {
            onDownloadPDF();
        } else {
            // Fallback: behave like print so users aren't stuck
            handlePrint();
        }
    };

    // ---- Formatters ----
    const formatCurrency = (value) => new Intl.NumberFormat('en-KE', {
        style: 'currency',
        currency: 'KES',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(value || 0);

    const formatDate = (date) => new Date(date).toLocaleDateString('en-KE', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    const formatTime = (date) => new Date(date).toLocaleTimeString('en-KE', {
        hour: '2-digit',
        minute: '2-digit'
    });

    const numberToWords = (num) => {
        const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
        const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
        const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];

        if (!num || num === 0) return 'Zero Shillings';

        const convert = (n) => {
            if (n < 10) return ones[n];
            if (n < 20) return teens[n - 10];
            if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
            if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' and ' + convert(n % 100) : '');
            if (n < 1000000) return convert(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + convert(n % 1000) : '');
            return 'Amount too large';
        };

        return convert(Math.round(num)) + ' Shillings';
    };

    const r = receiptData || {};
    const school = schoolData || {};

    return (
        <div className="modal-overlay active"
             onClick={(e) => e.target === e.currentTarget && onClose()}>
            <div className="modal"
                 style={{ maxWidth: 800, maxHeight: '95vh', overflowY: 'auto' }}>
                {/* Header with actions */}
                <div className="modal-header" style={{
                    display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', marginBottom: 20
                }}>
                    <h2 style={{ fontSize: 22, color: 'var(--secondary)' }}>
                        <i className="fas fa-receipt"></i> Fee Receipt
                    </h2>
                    <div className="no-print" style={{ display: 'flex', gap: 10 }}>
                        <button onClick={handlePrint} style={btnStyle('var(--primary)')}
                                title="Open the browser print dialog">
                            <i className="fas fa-print"></i> Print
                        </button>
                        <button onClick={handleDownloadPDF} style={btnStyle('#e74c3c')}
                                title="Download a clean A4 PDF">
                            <i className="fas fa-file-pdf"></i> Download PDF
                        </button>
                        <button onClick={onClose} style={closeBtnStyle}
                                title="Close">
                            <i className="fas fa-times"></i>
                        </button>
                    </div>
                </div>

                {/* Preview area (A4 aspect) */}
                <div style={{
                    overflow: 'auto', padding: 10,
                    background: '#f0f0f0', borderRadius: 8
                }}>
                    <div ref={receiptRef} style={{
                        width: '210mm',
                        minHeight: '297mm',
                        padding: '10mm',
                        background: 'white',
                        fontFamily: 'Arial, sans-serif',
                        fontSize: 12,
                        color: '#333',
                        lineHeight: 1.6,
                        margin: '0 auto'
                    }}>
                        {/* ---- School header ---- */}
                        <div style={{
                            display: 'flex', justifyContent: 'space-between',
                            alignItems: 'center',
                            borderBottom: '3px double #1a237e',
                            paddingBottom: 10, marginBottom: 15
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
                                {school.schoolLogo && (
                                    <img src={school.schoolLogo} alt="School Logo" style={{
                                        width: 60, height: 60, objectFit: 'contain',
                                        border: '1px solid #e0e0e0', borderRadius: 8, padding: 5
                                    }} />
                                )}
                                <div>
                                    <h1 style={{
                                        fontSize: 20, fontWeight: 700,
                                        color: '#1a237e', margin: 0, letterSpacing: 1
                                    }}>
                                        {school.schoolName || r.schoolName || 'School Name'}
                                    </h1>
                                    {school.schoolAddress && (
                                        <div style={{ fontSize: 11, color: '#666' }}>
                                            {school.schoolAddress}
                                        </div>
                                    )}
                                    <div style={{ fontSize: 11, color: '#666' }}>
                                        {school.schoolPhone && <span>Phone: {school.schoolPhone}</span>}
                                        {school.schoolEmail && (
                                            <span style={{ marginLeft: 15 }}>
                                                Email: {school.schoolEmail}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                                <div style={{
                                    fontSize: 16, fontWeight: 700, color: '#1a237e',
                                    border: '2px solid #1a237e', padding: '5px 15px',
                                    borderRadius: 4
                                }}>
                                    RECEIPT
                                </div>
                                <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
                                    No: {r.receiptNumber}
                                </div>
                            </div>
                        </div>

                        {/* ---- Student info ---- */}
                        <div style={{
                            display: 'grid', gridTemplateColumns: '1fr 1fr',
                            gap: 10, marginBottom: 15, padding: 10,
                            background: '#f5f5f5', borderRadius: 4
                        }}>
                            <div>
                                <div style={labelStyle}>Student Name</div>
                                <div style={valueStyle}>{r.studentName}</div>
                            </div>
                            <div>
                                <div style={labelStyle}>Admission Number</div>
                                <div style={valueStyle}>{r.admissionNumber || 'N/A'}</div>
                            </div>
                            <div>
                                <div style={labelStyle}>Class</div>
                                <div style={valueStyle}>{r.studentClass || 'N/A'}</div>
                            </div>
                            <div>
                                <div style={labelStyle}>Payment Date</div>
                                <div style={valueStyle}>
                                    {formatDate(r.paymentDate)} at {formatTime(r.paymentDate)}
                                </div>
                            </div>
                        </div>

                        {/* ---- Payment table ---- */}
                        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 15 }}>
                            <thead>
                                <tr style={{ background: '#1a237e', color: 'white' }}>
                                    <th style={thStyle}>Description</th>
                                    <th style={{ ...thStyle, textAlign: 'center' }}>Payment Method</th>
                                    <th style={{ ...thStyle, textAlign: 'right' }}>Reference</th>
                                    <th style={{ ...thStyle, textAlign: 'right' }}>Amount (KES)</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td style={tdStyle}>{r.description || 'Fee Payment'}</td>
                                    <td style={{ ...tdStyle, textAlign: 'center', textTransform: 'capitalize' }}>
                                        {r.paymentMethod || 'cash'}
                                    </td>
                                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                                        {r.reference || 'N/A'}
                                    </td>
                                    <td style={{
                                        ...tdStyle, textAlign: 'right',
                                        fontWeight: 700, color: '#1a237e'
                                    }}>
                                        {formatCurrency(r.amount)}
                                    </td>
                                </tr>
                                {r.invoices && r.invoices.length > 0 && (
                                    <tr>
                                        <td colSpan={4} style={{
                                            ...tdStyle, background: '#f9f9f9'
                                        }}>
                                            <div style={{ fontSize: 11 }}>
                                                <strong>Applied to Invoices:</strong>
                                                {r.invoices.map((inv, idx) => (
                                                    <span key={idx} style={{ marginLeft: 10 }}>
                                                        {inv.invoiceNumber} (KES {(inv.amount || 0).toLocaleString()})
                                                    </span>
                                                ))}
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                            <tfoot>
                                <tr style={{ background: '#f5f5f5' }}>
                                    <td colSpan={3} style={{
                                        ...tdStyle, textAlign: 'right', fontWeight: 700
                                    }}>
                                        Total Paid
                                    </td>
                                    <td style={{
                                        ...tdStyle, textAlign: 'right', fontWeight: 700,
                                        color: '#1a237e', fontSize: 16
                                    }}>
                                        {formatCurrency(r.amount)}
                                    </td>
                                </tr>
                            </tfoot>
                        </table>

                        {/* ---- Amount in words ---- */}
                        <div style={{
                            padding: 10, background: '#f9f9f9', borderRadius: 4,
                            marginBottom: 15, borderLeft: '4px solid #1a237e'
                        }}>
                            <div style={labelStyle}>Amount in Words</div>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>
                                {numberToWords(Math.round(r.amount || 0))}
                            </div>
                        </div>

                        {/* ---- Summary ---- */}
                        <div style={{
                            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
                            gap: 10, marginBottom: 15, padding: 10,
                            background: '#e3f2fd', borderRadius: 4
                        }}>
                            <div>
                                <div style={labelStyle}>Total Paid to Date</div>
                                <div style={{ fontWeight: 700, fontSize: 15, color: '#1a237e' }}>
                                    {formatCurrency(r.totalPaid || 0)}
                                </div>
                            </div>
                            <div>
                                <div style={labelStyle}>Outstanding Balance</div>
                                <div style={{
                                    fontWeight: 700, fontSize: 15,
                                    color: (r.balance || 0) > 0 ? '#d32f2f' : '#2e7d32'
                                }}>
                                    {formatCurrency(r.balance || 0)}
                                </div>
                            </div>
                            <div>
                                <div style={labelStyle}>Term / Year</div>
                                <div style={valueStyle}>
                                    {r.term || 'Term 1'} {r.year || new Date().getFullYear()}
                                </div>
                            </div>
                        </div>

                        {/* ---- Footer ---- */}
                        <div style={{
                            borderTop: '1px solid #e0e0e0', paddingTop: 10,
                            marginTop: 10, display: 'flex',
                            justifyContent: 'space-between', alignItems: 'center',
                            fontSize: 10, color: '#888'
                        }}>
                            <div>
                                <div>Generated on: {new Date().toLocaleString()}</div>
                                <div>Receipt No: {r.receiptNumber}</div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                                <div style={{
                                    borderTop: '2px solid #333', paddingTop: 5,
                                    width: 180, textAlign: 'center',
                                    fontSize: 11, fontWeight: 500
                                }}>
                                    Authorized Signature
                                </div>
                                <div style={{ fontSize: 9, marginTop: 4 }}>
                                    This is a computer-generated receipt
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ---- Inline style helpers ----
const labelStyle = {
    fontSize: 10, color: '#888',
    textTransform: 'uppercase', letterSpacing: 0.5
};

const valueStyle = { fontWeight: 600, fontSize: 14 };

const thStyle = {
    padding: '8px 12px', textAlign: 'left',
    fontSize: 11, border: '1px solid #1a237e'
};

const tdStyle = {
    padding: '8px 12px', border: '1px solid #e0e0e0'
};

const btnStyle = (bg) => ({
    padding: '8px 16px', background: bg, color: 'white',
    border: 'none', borderRadius: 6, cursor: 'pointer',
    fontSize: 13, fontWeight: 600,
    display: 'inline-flex', alignItems: 'center', gap: 6
});

const closeBtnStyle = {
    width: 40, height: 40, border: 'none', borderRadius: '50%',
    background: 'var(--light)', cursor: 'pointer', fontSize: 18
};
