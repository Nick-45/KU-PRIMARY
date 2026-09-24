const fs = require('fs');
let code = fs.readFileSync('src/pages/StudentFeeDetail.jsx', 'utf8');

// Replace the status span and add the button
code = code.replace(/<span style={{[^>]*background:\s*t\.status === 'completed'[^>]*>[\s\S]*?{t\.status \|\| 'N\/A'}[\s\S]*?<\/span>[\s\S]*?<\/td>\s*<\/tr>/, 
`<span style={{
    padding: '2px 10px',
    borderRadius: '12px',
    fontSize: '11px',
    background: t.voided ? '#f8d7da' : t.status === 'completed' ? '#d4edda' :
                t.status === 'pending' ? '#fff3cd' : '#f8d7da',
    color: t.voided ? '#721c24' : t.status === 'completed' ? '#155724' :
            t.status === 'pending' ? '#856404' : '#721c24'
}}>
    {t.voided ? 'VOIDED' : t.status || 'N/A'}
</span>
</td>
<td style={{ padding: '12px 20px', textAlign: 'center' }}>
    {!t.voided && t.type === 'payment' && (
        <button 
            onClick={() => handleVoidTransaction(t)}
            style={{ background: 'none', border: '1px solid var(--danger)', color: 'var(--danger)', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' }}
        >
            Reverse
        </button>
    )}
</td>
</tr>`);

// Add Actions header to transactions table
code = code.replace(/<th style={{[^>]*}}>Status<\/th>\s*<\/tr>\s*<\/thead>/,
`<th style={{ padding: '12px 20px', textAlign: 'center', fontSize: '12px', fontWeight: '600', color: 'var(--gray)' }}>Status</th>
<th style={{ padding: '12px 20px', textAlign: 'center', fontSize: '12px', fontWeight: '600', color: 'var(--gray)' }}>Actions</th>
</tr>
</thead>`);

// Also change colSpan="5" to colSpan="6"
code = code.replace(/colSpan="5"/, 'colSpan="6"');

// And strike-through voided transactions
code = code.replace(/<tr key={t\.id} style={{ borderBottom: '1px solid var\(--border\)' }}>/, 
`<tr key={t.id} style={{ borderBottom: '1px solid var(--border)', opacity: t.voided ? 0.6 : 1, textDecoration: t.voided ? 'line-through' : 'none' }}>`);

fs.writeFileSync('src/pages/StudentFeeDetail.jsx', code);
console.log("Patched transactions successfully");
