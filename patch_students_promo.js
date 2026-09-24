const fs = require('fs');
let code = fs.readFileSync('src/pages/Students.jsx', 'utf8');

code = code.replace(/const getPromotionTargets = useCallback\(\(student\) => {[\s\S]*?}, \[\]\);/, 
`const getPromotionTargets = useCallback((student) => {
        if (!student) return [];
        const targets = [];
        
        // If in terminal class for this school, only target is graduation
        if (isInTerminalClass(student.level, student.class, schoolHighestLevel)) {
            targets.push({
                key: \`graduate\`,
                level: student.level,
                class: student.class,
                type: 'graduate',
                label: \`Graduate from \${getLevelDisplayName(student.level)}\`,
            });
            return targets;
        }

        const nextClass = getNextClass(student.level, student.class);
        if (nextClass) {
            targets.push({
                key: \`\${student.level}|\${nextClass}\`,
                level: student.level,
                class: nextClass,
                type: 'same-level',
                label: \`\${getLevelDisplayName(student.level)} — \${nextClass}\`,
            });
        }
        const nextLevel = getNextLevel(student.level);
        if (nextLevel && (!schoolHighestLevel || LEVEL_ORDER.indexOf(nextLevel) <= LEVEL_ORDER.indexOf(schoolHighestLevel))) {
            const first = LEVEL_CLASSES[nextLevel]?.[0];
            if (first) {
                targets.push({
                    key: \`\${nextLevel}|\${first}\`,
                    level: nextLevel,
                    class: first,
                    type: 'next-level',
                    label: \`\${getLevelDisplayName(nextLevel)} — \${first} (transition)\`,
                });
            }
        }
        return targets;
    }, [schoolHighestLevel]);`);

fs.writeFileSync('src/pages/Students.jsx', code);
console.log("Patched getPromotionTargets in Students.jsx");
