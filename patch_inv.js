const fs = require('fs');
let code = fs.readFileSync('src/pages/StudentFeeDetail.jsx', 'utf8');

// strike-through for cancelled invoices
code = code.replace(/<tr key={invoice.id} style={{ borderBottom: '1px solid var\(--border\)' }}>/,
`<tr key={invoice.id} style={{ borderBottom: '1px solid var(--border)', opacity: invoice.status === 'cancelled' ? 0.6 : 1, textDecoration: invoice.status === 'cancelled' ? 'line-through' : 'none' }}>`);

// Add Cancel button
code = code.replace(/<button\s*className="btn btn-success"\s*style={{ padding: '4px 10px', fontSize: '11px' }}\s*onClick={\(\) => generateInvoicePDF\(invoice\)}\s*>\s*<i className="fas fa-file-pdf"><\/i> PDF\s*<\/button>/,
`<button
    className="btn btn-success"
    style={{ padding: '4px 10px', fontSize: '11px' }}
    onClick={() => generateInvoicePDF(invoice)}
>
    <i className="fas fa-file-pdf"></i> PDF
</button>
{invoice.status !== 'cancelled' && (
    <button
        className="btn btn-danger"
        style={{ padding: '4px 10px', fontSize: '11px', background: 'none', border: '1px solid var(--danger)', color: 'var(--danger)' }}
        onClick={() => handleCancelInvoice(invoice)}
    >
        Reverse
    </button>
)}`);

fs.writeFileSync('src/pages/StudentFeeDetail.jsx', code);
console.log("Patched invoices successfully");
