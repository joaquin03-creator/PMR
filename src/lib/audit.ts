import { db, auth } from '../firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { AuditLog } from '../types';

export async function logAuditEvent(
  entityType: AuditLog['entityType'],
  entityId: string,
  action: AuditLog['action'],
  changes?: AuditLog['changes'],
  notes?: string
) {
  try {
    const user = auth.currentUser;
    if (!user) return;

    const logData: Omit<AuditLog, 'id'> = {
      entityType,
      entityId,
      action,
      changes,
      performedBy: user.email || 'unknown',
      timestamp: new Date().toISOString(),
      notes
    };

    await addDoc(collection(db, 'auditLogs'), logData);
  } catch (error) {
    console.error('Failed to log audit event:', error);
  }
}
