// src/services/auditService.js
import { db } from '../firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

/**
 * AuditLogService
 * Records sensitive actions for security and compliance.
 */
export const AuditLogService = {
  /**
   * Logs an action to the 'audit_logs' collection.
   * @param {string} userId - The UID of the user performing the action.
   * @param {string} action - The action performed (e.g., 'FEE_PAYMENT', 'TEACHER_CREATED').
   * @param {string} entityId - The ID of the affected document.
   * @param {Object} details - Additional details about the action (do not include sensitive PII).
   */
  async logAction(userId, action, entityId, details = {}) {
    try {
      await addDoc(collection(db, 'audit_logs'), {
        userId,
        action,
        entityId,
        details,
        timestamp: serverTimestamp(),
      });
    } catch (error) {
      console.error('Failed to log audit action:', error);
      // We don't throw here to avoid disrupting the main user flow.
    }
  }
};
