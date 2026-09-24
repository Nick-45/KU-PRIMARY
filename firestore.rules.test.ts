// firestore.rules.test.ts
// Test suite validating that all "Dirty Dozen" adversarial payloads return PERMISSION_DENIED.

import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment,
    RulesTestEnvironment
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';

let testEnv: RulesTestEnvironment;

const PROJECT_ID = 'edupriva-test-security';

describe('EDUPRIVA Firestore Rules - Phase 0 Dirty Dozen Security Tests', () => {
    beforeAll(async () => {
        let rules = '';
        try {
            rules = readFileSync(resolve(__dirname, 'firestore.rules'), 'utf8');
        } catch {
            rules = readFileSync(resolve(__dirname, 'DRAFT_firestore.rules'), 'utf8');
        }

        testEnv = await initializeTestEnvironment({
            projectId: PROJECT_ID,
            firestore: {
                rules,
                host: '127.0.0.1',
                port: 8080
            }
        });
    });

    afterAll(async () => {
        if (testEnv) {
            await testEnv.cleanup();
        }
    });

    beforeEach(async () => {
        if (testEnv) {
            await testEnv.clearFirestore();
            // Seed initial trusted fixtures
            await testEnv.withSecurityRulesDisabled(async (context) => {
                const db = context.firestore();
                // Seed School
                await db.doc('schools/school_1').set({
                    id: 'school_1',
                    name: 'St. Teresa Academy',
                    active: true
                });

                // Seed legitimate user docs
                await db.doc('users/admin_uid_1').set({
                    uid: 'admin_uid_1',
                    role: 'admin',
                    schoolId: 'school_1'
                });

                await db.doc('users/student_uid_42').set({
                    uid: 'student_uid_42',
                    role: 'student',
                    schoolId: 'school_1',
                    studentId: 'stu_42'
                });

                // Seed existing settled transaction
                await db.doc('fee_transactions/school_1__stu_42__10000__2026-09-14').set({
                    schoolId: 'school_1',
                    studentId: 'stu_42',
                    amount: 10000,
                    type: 'payment',
                    status: 'completed',
                    idempotencyKey: 'school_1__stu_42__10000__2026-09-14',
                    voided: false,
                    createdAt: new Date()
                });

                // Seed already voided transaction
                await db.doc('fee_transactions/school_1__stu_42__already_voided_txn').set({
                    schoolId: 'school_1',
                    studentId: 'stu_42',
                    amount: 5000,
                    type: 'payment',
                    status: 'completed',
                    idempotencyKey: 'school_1__stu_42__already_voided_txn',
                    voided: true,
                    voidedAt: new Date(),
                    voidedBy: 'admin_uid_1',
                    voidReason: 'Initial legitimate void'
                });

                // Seed invoice
                await db.doc('invoices/inv_student_term1_2026').set({
                    schoolId: 'school_1',
                    studentId: 'stu_42',
                    total: 45000,
                    paidAmount: 0,
                    remainingBalance: 45000,
                    status: 'pending'
                });
            });
        }
    });

    // DD-01: Unauthenticated Transaction Injection
    test('DD-01: Unauthenticated user cannot write a fee transaction', async () => {
        const unauthDb = testEnv.unauthenticatedContext().firestore();
        const ref = unauthDb.doc('fee_transactions/school_1__stu_99__5000__2026-09-14');
        await assertFails(ref.set({
            schoolId: 'school_1',
            studentId: 'stu_99',
            amount: 5000,
            type: 'payment',
            status: 'completed',
            idempotencyKey: 'school_1__stu_99__5000__2026-09-14'
        }));
    });

    // DD-02: Cross-Tenant Ledger Injection
    test('DD-02: User from school_attacker cannot post transaction to school_victim', async () => {
        const attackerDb = testEnv.authenticatedContext('attacker_user', {
            schoolId: 'school_attacker',
            role: 'admin'
        }).firestore();
        const ref = attackerDb.doc('fee_transactions/school_victim__stu_100__12000__2026-09-14');
        await assertFails(ref.set({
            schoolId: 'school_victim',
            studentId: 'stu_100',
            amount: 12000,
            type: 'payment',
            status: 'completed',
            idempotencyKey: 'school_victim__stu_100__12000__2026-09-14'
        }));
    });

    // DD-03: Privilege Escalation via User Profile Self-Update
    test('DD-03: Student user cannot escalate role to admin', async () => {
        const studentDb = testEnv.authenticatedContext('student_uid_42', {
            schoolId: 'school_1',
            role: 'student'
        }).firestore();
        const ref = studentDb.doc('users/student_uid_42');
        await assertFails(ref.update({
            role: 'admin',
            isSuperAdmin: true
        }));
    });

    // DD-04: Negative Amount Fee Tampering / Ledger Drain
    test('DD-04: Negative amount in fee payment must be rejected', async () => {
        const parentDb = testEnv.authenticatedContext('parent_uid_42', {
            schoolId: 'school_1',
            role: 'parent'
        }).firestore();
        const ref = parentDb.doc('fee_transactions/school_1__stu_42__neg5000__2026-09-14');
        await assertFails(ref.set({
            schoolId: 'school_1',
            studentId: 'stu_42',
            amount: -50000,
            type: 'payment',
            status: 'completed',
            idempotencyKey: 'school_1__stu_42__neg5000__2026-09-14'
        }));
    });

    // DD-05: Settled Transaction Mutation
    test('DD-05: Settled transaction core fields cannot be mutated', async () => {
        const clerkDb = testEnv.authenticatedContext('clerk_uid_1', {
            schoolId: 'school_1',
            role: 'teacher'
        }).firestore();
        const ref = clerkDb.doc('fee_transactions/school_1__stu_42__10000__2026-09-14');
        await assertFails(ref.update({
            amount: 100,
            studentId: 'stu_attacker_child'
        }));
    });

    // DD-06: Double-Void Replay Attack
    test('DD-06: Already voided transaction cannot be re-voided', async () => {
        const adminDb = testEnv.authenticatedContext('admin_uid_1', {
            schoolId: 'school_1',
            role: 'admin'
        }).firestore();
        const ref = adminDb.doc('fee_transactions/school_1__stu_42__already_voided_txn');
        await assertFails(ref.update({
            voided: true,
            voidReason: 'Duplicate void execution',
            voidedAt: new Date()
        }));
    });

    // DD-07: Shadow Field Injection
    test('DD-07: Injected shadow fields must be rejected on create', async () => {
        const adminDb = testEnv.authenticatedContext('admin_uid_1', {
            schoolId: 'school_1',
            role: 'admin'
        }).firestore();
        const ref = adminDb.doc('fee_transactions/school_1__stu_42__shadow_attack');
        await assertFails(ref.set({
            schoolId: 'school_1',
            studentId: 'stu_42',
            amount: 5000,
            type: 'payment',
            status: 'completed',
            idempotencyKey: 'school_1__stu_42__shadow_attack',
            __bypassVerification: true,
            trustedSuperAdmin: 'all_access'
        }));
    });

    // DD-08: Invoice Status Forgery
    test('DD-08: Student cannot mark invoice as paid', async () => {
        const studentDb = testEnv.authenticatedContext('student_uid_42', {
            schoolId: 'school_1',
            role: 'student'
        }).firestore();
        const ref = studentDb.doc('invoices/inv_student_term1_2026');
        await assertFails(ref.update({
            status: 'paid',
            paidAmount: 45000,
            remainingBalance: 0
        }));
    });

    // DD-09: Cross-School Orphan Invoice Creation
    test('DD-09: User cannot create invoice belonging to another school', async () => {
        const teacherDb = testEnv.authenticatedContext('teacher_uid_1', {
            schoolId: 'school_1',
            role: 'teacher'
        }).firestore();
        const ref = teacherDb.doc('invoices/inv_foreign_school_fake');
        await assertFails(ref.set({
            schoolId: 'school_2',
            studentId: 'stu_school2_victim',
            total: 30000,
            status: 'pending'
        }));
    });

    // DD-10: ID Poisoning / Path Traversal
    test('DD-10: Malformed or path-traversing doc ID must be rejected', async () => {
        const adminDb = testEnv.authenticatedContext('admin_uid_1', {
            schoolId: 'school_1',
            role: 'admin'
        }).firestore();
        const ref = adminDb.collection('fee_transactions').doc('invalid/nested/path/key');
        await assertFails(ref.set({
            schoolId: 'school_1',
            amount: 5000
        }));
    });

    // DD-11: PII Exposure via Blanket List Query
    test('DD-11: Students cannot query general student directory', async () => {
        const studentDb = testEnv.authenticatedContext('student_uid_42', {
            schoolId: 'school_1',
            role: 'student'
        }).firestore();
        const col = studentDb.collection('students');
        await assertFails(col.where('schoolId', '==', 'school_1').get());
    });

    // DD-12: Direct Client Balance Tampering
    test('DD-12: Client cannot directly set student_balances without ledger write', async () => {
        const studentDb = testEnv.authenticatedContext('student_uid_42', {
            schoolId: 'school_1',
            role: 'student'
        }).firestore();
        const ref = studentDb.doc('student_balances/stu_42__term_1__2026');
        await assertFails(ref.set({
            balance: 0,
            totalPaid: 100000,
            status: 'paid'
        }));
    });
});
