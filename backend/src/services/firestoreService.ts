import * as admin from 'firebase-admin';

// Initialize Firebase Admin
let db: admin.firestore.Firestore | null = null;

export function initializeFirebase() {
  if (admin.apps.length === 0) {
    try {
      admin.initializeApp({
        credential: admin.credential.applicationDefault()
      });
      db = admin.firestore();
      console.log('Firebase initialized successfully');
    } catch (error) {
      console.error('Firebase initialization error:', error);
    }
  }
  return db;
}

export async function saveAnalysisToFirestore(
  companyId: string,
  analysisData: any
): Promise<void> {
  if (!db) {
    console.warn('Firestore not initialized. Skipping save.');
    return;
  }

  try {
    await db.collection('analyses').doc(companyId).set({
      ...analysisData,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    console.log(`Analysis saved to Firestore: ${companyId}`);
  } catch (error) {
    console.error('Firestore save error:', error);
  }
}

export async function getAnalysisFromFirestore(
  companyId: string
): Promise<any | null> {
  if (!db) {
    return null;
  }

  try {
    const doc = await db.collection('analyses').doc(companyId).get();
    return doc.exists ? doc.data() : null;
  } catch (error) {
    console.error('Firestore read error:', error);
    return null;
  }
}
