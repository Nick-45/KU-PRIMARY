const fs = require('fs');
let code = fs.readFileSync('src/pages/Students.jsx', 'utf8');

code = code.replace(/<button className="btn btn-primary" onClick={handleAddStudent}>/, 
`<button className="btn btn-outline" onClick={() => navigate('/student-analytics')} title="Analytics">
                            <i className="fas fa-chart-line"></i> Analytics
                        </button>
                        <button className="btn btn-primary" onClick={handleAddStudent}>`);

fs.writeFileSync('src/pages/Students.jsx', code);
console.log("Patched Students.jsx button");
