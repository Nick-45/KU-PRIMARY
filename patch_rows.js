const fs = require('fs');
let code = fs.readFileSync('src/pages/Students.jsx', 'utf8');

const target = `                    <td>{s.studentId || 'N/A'}</td>
                    <td><span className={\`level-badge \${badge}\`}>{levelDisplay}</span></td>
                    <td>{s.class || 'N/A'}</td>`;

const replacement = `                    <td>{s.studentId || 'N/A'}</td>
                    <td>
                        <div style={{ fontSize: '12px' }}>
                            {s.gender || 'N/A'}{s.dateOfBirth ? \` • \${Math.floor((new Date() - new Date(s.dateOfBirth).getTime()) / 3.15576e+10)} yrs\` : ''}
                        </div>
                    </td>
                    <td><span className={\`level-badge \${badge}\`}>{levelDisplay}</span></td>
                    <td>{s.class || 'N/A'}</td>`;

if (code.includes(target)) {
    code = code.replace(target, replacement);
    fs.writeFileSync('src/pages/Students.jsx', code);
    console.log("Patched rows successfully");
} else {
    console.log("Target not found");
}

code = fs.readFileSync('src/pages/Students.jsx', 'utf8');
const colspanTarget = `<td colSpan={isTeacher ? 5 : 6}>`;
const colspanReplacement = `<td colSpan={isTeacher ? 6 : 7}>`;
if (code.includes(colspanTarget)) {
    code = code.replace(colspanTarget, colspanReplacement);
    fs.writeFileSync('src/pages/Students.jsx', code);
    console.log("Patched colspan successfully");
}

