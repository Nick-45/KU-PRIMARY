const fs = require('fs');
let code = fs.readFileSync('src/components/Layout/Sidebar.jsx', 'utf8');

// Add communication to premium modules
code = code.replace(
    /\{ key: 'health', path: '\/health', icon: 'fa-heartbeat', label: 'Health Unit' \}/,
    "{ key: 'health', path: '/health', icon: 'fa-heartbeat', label: 'Health Unit' },\\n        { key: 'communication', path: '/sms', icon: 'fa-comments', label: 'Communication' }"
);

// Remove sms from superadminItems
code = code.replace(
    /\{\s*path: '\/sms',\s*icon: 'fa-comments',\s*label: 'Communication',\s*show: isSuper\s*\},/,
    ""
);

fs.writeFileSync('src/components/Layout/Sidebar.jsx', code);
console.log("Patched Sidebar.jsx");
