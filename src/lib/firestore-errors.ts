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
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
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
  }
  
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  
  // Fire and forget logging
  logToFirestore(errInfo);
  
  throw new Error(JSON.stringify(errInfo));
}
