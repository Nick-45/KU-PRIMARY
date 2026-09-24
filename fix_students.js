const fs = require('fs');
let code = fs.readFileSync('src/pages/Students.jsx', 'utf8');

// Remove setCursor and setHasMore
code = code.replace(/setCursor\(null\);\s*setHasMore\(false\);/, '');

// Remove the hasMore condition
code = code.replace(/\{students\.length < stats\.total \+ stats\.deleted && hasMore && \(/, 
"{students.length < stats.total + stats.deleted && (");

fs.writeFileSync('src/pages/Students.jsx', code);
console.log("Fixed Students.jsx");
