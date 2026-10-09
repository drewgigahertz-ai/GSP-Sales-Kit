const { initializeApp } = require('firebase-admin/app');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');

initializeApp();

const firestore = getFirestore();

exports.captureSalesKitChanges = onDocumentWritten(
  {
    document: '{collectionId}/{documentId}',
    region: 'us-central1'
  },
  async (event) => {
    const { collectionId, documentId } = event.params;
    if (collectionId.startsWith('__saleskit_')) return;

    const before = event.data && event.data.before;
    const after = event.data && event.data.after;
    if (!before || !after) return;

    const operation = !before.exists ? 'created' : !after.exists ? 'deleted' : 'updated';
    const data = after.exists ? after.data() : null;
    await firestore.collection('__saleskit_change_log').doc(event.id).set({
      collection: collectionId,
      documentId,
      operation,
      data,
      changedAtMs: Date.parse(event.time),
      changedAt: FieldValue.serverTimestamp()
    });
  }
);