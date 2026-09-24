// src/services/csvService.js

/**
 * Minimal RFC 4180-compliant CSV parser.
 * Handles:
 *   - quoted fields with embedded commas: "P.O Box 123, Nairobi"
 *   - escaped quotes: "" -> "
 *   - embedded newlines inside quoted fields
 *   - CRLF and LF line endings
 *
 * Input:  raw CSV text
 * Output: array of arrays of strings
 *
 * Notes:
 *   - Does not attempt to interpret types. Caller does that.
 *   - Skips a trailing empty last row caused by trailing newline.
 */
export function parseCSV(text) {
    if (!text) return [];
    // Strip BOM if present
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    let i = 0;

    while (i < text.length) {
        const ch = text[i];

        if (inQuotes) {
            if (ch === '"') {
                // Lookahead for escaped quote
                if (text[i + 1] === '"') {
                    field += '"';
                    i += 2;
                    continue;
                }
                inQuotes = false;
                i++;
                continue;
            }
            field += ch;
            i++;
            continue;
        }

        // Not in quotes
        if (ch === '"') {
            inQuotes = true;
            i++;
            continue;
        }

        if (ch === ',') {
            row.push(field);
            field = '';
            i++;
            continue;
        }

        if (ch === '\r') {
            // Swallow CRLF or lone CR
            row.push(field);
            field = '';
            rows.push(row);
            row = [];
            if (text[i + 1] === '\n') i += 2; else i++;
            continue;
        }

        if (ch === '\n') {
            row.push(field);
            field = '';
            rows.push(row);
            row = [];
            i++;
            continue;
        }

        field += ch;
        i++;
    }

    // Flush final field/row
    if (field.length > 0 || row.length > 0) {
        row.push(field);
        rows.push(row);
    }

    // Remove trailing empty row from a final newline
    if (rows.length > 0) {
        const last = rows[rows.length - 1];
        if (last.length === 1 && last[0] === '') rows.pop();
    }

    return rows;
}

/**
 * Convert an array-of-arrays CSV (from parseCSV) to an array of objects
 * keyed by the header row. Header names are lowercased and trimmed.
 */
export function rowsToObjects(rows) {
    if (!rows || rows.length < 2) return { headers: [], objects: [] };
    const headers = rows[0].map((h) => String(h).trim().toLowerCase());
    const objects = rows.slice(1).map((r) => {
        const o = {};
        headers.forEach((h, i) => { o[h] = r[i] !== undefined ? String(r[i]).trim() : ''; });
        return o;
    });
    return { headers, objects };
}
