const fs = require('fs');
let code = fs.readFileSync('src/utils/constants.js', 'utf8');

code = code.replace(
    /export const LEVEL_CLASSES = \{/,
    "export const LEVEL_ORDER = ['pre-primary', 'lower-primary', 'upper-primary', 'junior-school', 'senior-school'];\\n\\nexport const LEVEL_CLASSES = {"
);

fs.writeFileSync('src/utils/constants.js', code);
console.log("Patched constants.js");
