const fs = require('fs');
let code = fs.readFileSync('src/App.jsx', 'utf8');

if (!code.includes('StudentAnalytics')) {
    code = code.replace(/const Students = lazy\(\(\) => import\('\.\/pages\/Students'\)\);/, 
    `const Students = lazy(() => import('./pages/Students'));\nconst StudentAnalytics = lazy(() => import('./pages/StudentAnalytics'));`);
    
    code = code.replace(/<Route path="\/students" element={<AuthWrapper><Students \/><\/AuthWrapper>} \/>/,
    `<Route path="/students" element={<AuthWrapper><Students /></AuthWrapper>} />\n                <Route path="/student-analytics" element={<AuthWrapper><StudentAnalytics /></AuthWrapper>} />`);
    
    fs.writeFileSync('src/App.jsx', code);
    console.log("Patched App.jsx");
}
