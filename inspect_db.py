import firebase_admin
from firebase_admin import credentials, firestore

# Path to your JSON key file
KEY_PATH = r"D:\SALESKIT\saleskit-key.json"  # Adjust filename if different

cred = credentials.Certificate(KEY_PATH)
firebase_admin.initialize_app(cred)
db = firestore.client()

print("--- Scanning Firestore Collections ---\n")

# Retrieve all root-level collections
collections = db.collections()

found_any = False
for collection in collections:
    found_any = True
    print(f"📁 Collection Name (Table): {collection.id}")
    
    # Grab the first document to see what fields/columns exist
    docs = list(collection.limit(1).stream())
    if docs:
        doc = docs[0]
        data = doc.to_dict()
        print(f"   📄 Sample Document ID: {doc.id}")
        print("   🔑 Field Names (Columns):")
        for key, value in data.items():
            print(f"      - {key} (type: {type(value).__name__})")
    else:
        print("   (Collection is empty)")
    print("-" * 40)

if not found_any:
    print("No collections found in this Firestore database.")