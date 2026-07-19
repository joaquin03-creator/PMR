import { auth, db } from '../firebase';
import { collection, addDoc } from 'firebase/firestore';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

async function logToFirestore(errInfo: FirestoreErrorInfo) {
  try {
    await addDoc(collection(db, 'systemLogs'), {
      timestamp: new Date().toISOString(),
      level: 'error',
      message: errInfo.error,
      details: JSON.stringify(errInfo),
      userId: errInfo.authInfo.userId || 'anonymous',
      userEmail: errInfo.authInfo.email || 'anonymous',
      operationType: errInfo.operationType,
      path: errInfo.path
    });
  } catch (logError) {
    // Fallback to console if logging fails
    console.error('Failed to log error to Firestore:', logError);
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errMsg = error instanceof Error ? error.message : String(error);
  const isQuotaError = errMsg.toLowerCase().includes('quota') || errMsg.toLowerCase().includes('limit exceeded');

  const errInfo: FirestoreErrorInfo = {
    error: errMsg,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  
  if (isQuotaError) {
    console.warn('Firestore Quota/Limit Exceeded (gracefully bypassed logging/throwing):', errMsg);
    return;
  }
  
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  
  // Fire and forget logging
  logToFirestore(errInfo);
  
  throw new Error(JSON.stringify(errInfo));
}
