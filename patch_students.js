const fs = require('fs');
let code = fs.readFileSync('src/pages/Students.jsx', 'utf8');

code = code.replace(
    /\{\!isTeacher && \(\s*<button className="btn btn-outline"/,
    "{!isTeacher && (\\n                                <><button className=\\"btn btn-outline\\""
);

code = code.replace(
    /<i className="fas fa-plus"><\/i> Add Student\s*<\/button>\s*\)\}/,
    "<i className=\\"fas fa-plus\\"></i> Add Student\\n                                </button></>\\n                            )}"
);

fs.writeFileSync('src/pages/Students.jsx', code);
console.log("Patched Students.jsx");
