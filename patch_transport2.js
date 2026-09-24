const fs = require('fs');
let code = fs.readFileSync('src/pages/Transportation.jsx', 'utf8');

code = code.replace(
    /const \[selectedDriver, setSelectedDriver\] = useState\(null\);/,
    "const [selectedDriver, setSelectedDriver] = useState(null);\\n  const [selectedAssignment, setSelectedAssignment] = useState(null);"
);

fs.writeFileSync('src/pages/Transportation.jsx', code);
console.log("Patched Transportation.jsx state");
