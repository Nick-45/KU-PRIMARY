# EDUPRIVA Firestore Security Specification
## Phase 0: Payload-First Security TDD (Financial & Multi-Tenant Hardening)

### 1. Executive Summary & Security Architecture
EDUPRIVA is a multi-tenant Kenyan School Management System serving over 100 schools, each with up to 1,000 students, handling fee payments, M-Pesa reconciliations, student academic records, health records, and boarding operations.

Under the Zero-Trust Architecture and Attribute-Based Access Control (ABAC) principles:
1. **Tenant Isolation**: No authenticated principal (Admin, Teacher, Student, Parent) may read or write documents outside their assigned `schoolId`.
2. **Financial Immutability**: All records in `fee_transactions` are append-only ledger entries. Once created, core fields (`amount`, `studentId`, `schoolId`, `type`, `idempotencyKey`, `createdAt`) are mathematically immutable.
3. **Double-Entry & State Atomicity**: Balance mutations in `student_balances` must never be written as detached client mutations; they must strictly mirror an atomic `fee_transaction`.
4. **Anti-Tampering & Anti-Void Replay**: Void operations are reversals, requiring an explicit audit trail, and cannot be re-applied to an already-voided transaction.
5. **Anti-Update-Gaps**: Every write is wrapped in strict type, boundary, regex, and allowed-key constraints to prevent shadow-field injections.

---

### 2. Core Data Invariants

#### A. Multi-Tenant Invariant
* Every document in school-scoped collections (`fee_transactions`, `invoices`, `student_balances`, `fee_audit_log`, `students`, `teachers`, `student_scores`, `exams`) must possess a valid `schoolId`.
* For any read or write, `resource.data.schoolId == request.auth.token.schoolId` (or verified against the user's authoritative record).
* Document IDs must adhere to `^[a-zA-Z0-9_\-]+$` and not exceed 128 characters (ID Poisoning Guard).

#### B. Fee Transactions (`fee_transactions/{txnId}`)
* **Creation Constraint**:
  * `id` must equal `idempotencyKey` to enforce single-post semantics.
  * `amount` must be a non-zero number. For `payment`, `discount`, and `waiver`, `amount > 0`.
  * `type` must be one of: `['payment', 'discount', 'waiver', 'refund', 'reversal']`.
  * `status` must be one of: `['pending', 'completed', 'success', 'failed', 'reversed']`.
  * `voided` must initialize to `false`.
  * Client cannot forge server/system fields (`mpesaReceiptNumber`, `completedAt`) unless initiated through authorized backend/admin roles.
* **Update Constraint**:
  * Only `voided`, `voidedAt`, `voidedBy`, and `voidReason` may be updated.
  * Can ONLY transition from `voided == false` to `voided == true`. An already voided transaction is in a **Terminal State** and cannot be updated again.
  * Core fields (`amount`, `studentId`, `schoolId`, `type`, `idempotencyKey`) are immutable.

#### C. Invoices (`invoices/{invoiceId}`)
* **Creation Constraint**:
  * Must specify valid `studentId`, `schoolId`, `term`, `academicYear`, and `items`.
  * `items` must be a bounded list (`size() <= 50`) where items have valid `description`, `amount`, and `quantity`.
  * `total` must equal `subtotal + tax - discount`.
  * `paidAmount` must initialize to `0` and `remainingBalance` must equal `total`.
  * `status` initializes to `'pending'`.
* **Update Constraint**:
  * If `status == 'paid'`, the invoice has reached a terminal outcome and cannot be arbitrarily modified by regular users.
  * Only financial admin or ledger batch operations can alter `paidAmount`, `remainingBalance`, and `payments`.
  * Students/parents have read-only access to their own invoices (`resource.data.studentId == request.auth.uid`).

#### D. Student Balances (`student_balances/{balanceId}`)
* Represents the materialized balance (`totalInvoiced - totalPaid - totalDiscount - totalWaived`).
* Cannot be manipulated by arbitrary standalone client `set` or `update` operations; client writes must be constrained to ledger-synchronized batches or restricted to authorized administrative financial controllers.

#### E. User & Profile Protection (`users/{uid}`)
* Users can update personal preference fields (`phone`, `address`, `displayName`) on their own record (`request.auth.uid == uid`).
* Users CANNOT modify security-critical RBAC fields (`role`, `schoolId`, `permissions`, `isSuperAdmin`).
* Role assignment is strictly restricted to platform admins or authorized school administrators.

---

### 3. The "Dirty Dozen" Payloads (Adversarial Security Test Cases)

Below are the 12 targeted attack payloads designed to probe vulnerabilities in Identity, Integrity, Multi-Tenancy, and State Transitions:

```json
{
  "dirtyDozen": [
    {
      "id": "DD-01",
      "name": "Unauthenticated Transaction Injection",
      "targetCollection": "fee_transactions",
      "targetDocId": "school_1__stu_99__5000__2026-09-14",
      "auth": null,
      "violationType": "Identity Violation (Unauthenticated Write)",
      "payload": {
        "schoolId": "school_1",
        "studentId": "stu_99",
        "amount": 5000,
        "type": "payment",
        "status": "completed",
        "idempotencyKey": "school_1__stu_99__5000__2026-09-14"
      },
      "expectedResult": "PERMISSION_DENIED"
    },
    {
      "id": "DD-02",
      "name": "Cross-Tenant Ledger Injection",
      "targetCollection": "fee_transactions",
      "targetDocId": "school_victim__stu_100__12000__2026-09-14",
      "auth": { "uid": "attacker_user", "schoolId": "school_attacker", "role": "admin" },
      "violationType": "Multi-Tenant Isolation Breach",
      "payload": {
        "schoolId": "school_victim",
        "studentId": "stu_100",
        "amount": 12000,
        "type": "payment",
        "status": "completed",
        "idempotencyKey": "school_victim__stu_100__12000__2026-09-14"
      },
      "expectedResult": "PERMISSION_DENIED"
    },
    {
      "id": "DD-03",
      "name": "Privilege Escalation via Profile Self-Update",
      "targetCollection": "users",
      "targetDocId": "student_uid_42",
      "auth": { "uid": "student_uid_42", "schoolId": "school_1", "role": "student" },
      "violationType": "RBAC Integrity Violation (Self-Elevation to Admin)",
      "payload": {
        "role": "admin",
        "permissions": ["all"],
        "isSuperAdmin": true
      },
      "expectedResult": "PERMISSION_DENIED"
    },
    {
      "id": "DD-04",
      "name": "Negative Amount Fee Tampering / Ledger Drain",
      "targetCollection": "fee_transactions",
      "targetDocId": "school_1__stu_42__neg5000__2026-09-14",
      "auth": { "uid": "parent_uid_42", "schoolId": "school_1", "role": "parent" },
      "violationType": "Integrity Violation (Illegal Negative/Zero Amount on Payment)",
      "payload": {
        "schoolId": "school_1",
        "studentId": "stu_42",
        "amount": -50000,
        "type": "payment",
        "status": "completed",
        "idempotencyKey": "school_1__stu_42__neg5000__2026-09-14"
      },
      "expectedResult": "PERMISSION_DENIED"
    },
    {
      "id": "DD-05",
      "name": "Settled Transaction Mutation (Modifying Amount After Post)",
      "targetCollection": "fee_transactions",
      "targetDocId": "school_1__stu_42__10000__2026-09-14",
      "auth": { "uid": "clerk_uid_1", "schoolId": "school_1", "role": "teacher" },
      "violationType": "Immutability Violation (Mutating Amount/StudentId of Existing Ledger Entry)",
      "payload": {
        "amount": 100,
        "studentId": "stu_attacker_child"
      },
      "expectedResult": "PERMISSION_DENIED"
    },
    {
      "id": "DD-06",
      "name": "Double-Void Replay Attack",
      "targetCollection": "fee_transactions",
      "targetDocId": "school_1__stu_42__already_voided_txn",
      "auth": { "uid": "admin_uid_1", "schoolId": "school_1", "role": "admin" },
      "violationType": "State Machine Violation (Updating Terminal Voided Transaction)",
      "payload": {
        "voided": true,
        "voidReason": "Duplicate void execution to trigger second credit adjustment",
        "voidedAt": "2026-09-14T14:00:00Z"
      },
      "expectedResult": "PERMISSION_DENIED"
    },
    {
      "id": "DD-07",
      "name": "Shadow Field Injection (Privilege & System Bypass Keys)",
      "targetCollection": "fee_transactions",
      "targetDocId": "school_1__stu_42__shadow_attack",
      "auth": { "uid": "admin_uid_1", "schoolId": "school_1", "role": "admin" },
      "violationType": "Schema Integrity Violation (Shadow Fields Injected)",
      "payload": {
        "schoolId": "school_1",
        "studentId": "stu_42",
        "amount": 5000,
        "type": "payment",
        "status": "completed",
        "idempotencyKey": "school_1__stu_42__shadow_attack",
        "__bypassVerification": true,
        "trustedSuperAdmin": "all_access",
        "walletCreditUnlocked": true
      },
      "expectedResult": "PERMISSION_DENIED"
    },
    {
      "id": "DD-08",
      "name": "Invoice Status Forgery (Student Self-Forging Paid Invoice)",
      "targetCollection": "invoices",
      "targetDocId": "inv_student_term1_2026",
      "auth": { "uid": "student_uid_42", "schoolId": "school_1", "role": "student" },
      "violationType": "State Authorization Violation (Direct Status & Balance Wipe)",
      "payload": {
        "status": "paid",
        "paidAmount": 45000,
        "remainingBalance": 0
      },
      "expectedResult": "PERMISSION_DENIED"
    },
    {
      "id": "DD-09",
      "name": "Cross-School Orphan Invoice Creation",
      "targetCollection": "invoices",
      "targetDocId": "inv_foreign_school_fake",
      "auth": { "uid": "teacher_uid_1", "schoolId": "school_1", "role": "teacher" },
      "violationType": "Relational Multi-Tenant Breach (Creating Invoice for Other School's Student)",
      "payload": {
        "schoolId": "school_2",
        "studentId": "stu_school2_victim",
        "total": 30000,
        "status": "pending"
      },
      "expectedResult": "PERMISSION_DENIED"
    },
    {
      "id": "DD-10",
      "name": "ID Poisoning / Path Traversal Document Key Injection",
      "targetCollection": "fee_transactions",
      "targetDocId": "../../schools/school_victim/config",
      "auth": { "uid": "admin_uid_1", "schoolId": "school_1", "role": "admin" },
      "violationType": "Path Variable Hardening / Injection",
      "payload": {
        "schoolId": "school_1",
        "amount": 5000
      },
      "expectedResult": "PERMISSION_DENIED"
    },
    {
      "id": "DD-11",
      "name": "PII Exposure via Blanket List Query",
      "targetCollection": "students",
      "targetDocId": null,
      "auth": { "uid": "student_uid_42", "schoolId": "school_1", "role": "student" },
      "violationType": "PII Protection Violation (Student Listing All Parent Contacts)",
      "payload": {
        "query": "collection('students').where('schoolId', '==', 'school_1')"
      },
      "expectedResult": "PERMISSION_DENIED"
    },
    {
      "id": "DD-12",
      "name": "Direct Client Balance Tampering (No Corresponding Ledger Entry)",
      "targetCollection": "student_balances",
      "targetDocId": "stu_42__term_1__2026",
      "auth": { "uid": "student_uid_42", "schoolId": "school_1", "role": "student" },
      "violationType": "Ledger Bypassing Invariant",
      "payload": {
        "balance": 0,
        "totalPaid": 100000,
        "status": "paid"
      },
      "expectedResult": "PERMISSION_DENIED"
    }
  ]
}
```

---

### 4. Test Runner Implementation Guide (`firestore.rules.test.ts`)
The test runner executes against the Firebase Local Emulator Suite using `@firebase/rules-unit-testing`. Each test case in the suite asserts:
1. Denials on unauthenticated operations.
2. Denials on mismatched `schoolId` claims.
3. Denials on schema expansions (excess keys).
4. Denials on illegal negative or zero transaction amounts.
5. Denials on mutations to locked ledger records.
6. Denials on re-voiding an already voided document.
7. Verification that legitimate admin and ledger batch operations succeed within tenant limits.
