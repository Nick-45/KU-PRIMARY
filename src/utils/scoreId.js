// src/utils/scoreId.js

/**
 * Generates a deterministic, URL-safe Firestore document ID for a score.
 * Format: {studentId}_{subject}_{term}_{assessmentType}
 * 
 * This eliminates the need for existence-check queries.
 * Using setDoc with { merge: true } makes writes idempotent.
 */
export function makeScoreId(studentId, subject, term, assessmentType) {
    if (!studentId || !subject || !term || !assessmentType) {
        throw new Error('makeScoreId: all arguments are required');
    }
    const slug = (s) => String(s).trim().replace(/\s+/g, '_').replace(/[\/\\.#$\[\]]/g, '');
    return `${slug(studentId)}__${slug(subject)}__${slug(term)}__${slug(assessmentType)}`;
}

/**
 * Generates a deterministic ID for assessment configs.
 */
export function makeAssessmentConfigId(schoolId, level, cls, subject, assessmentType, term) {
    const slug = (s) => String(s).trim().replace(/\s+/g, '_').replace(/[\/\\.#$\[\]]/g, '');
    return `${slug(schoolId)}__${slug(level)}__${slug(cls)}__${slug(subject)}__${slug(assessmentType)}__${slug(term)}`;
}

/**
 * Generates a deterministic ID for class summaries.
 */
export function makeClassSummaryId(schoolId, level, cls, subject, term) {
    const slug = (s) => String(s).trim().replace(/\s+/g, '_').replace(/[\/\\.#$\[\]]/g, '');
    return `${slug(schoolId)}__${slug(level)}__${slug(cls)}__${slug(subject)}__${slug(term)}`;
}
