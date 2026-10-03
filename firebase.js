import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  GoogleAuthProvider,
  OAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getFirestore,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import {
  deleteObject,
  getDownloadURL,
  getStorage,
  ref,
  uploadBytes
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyCwcxGfPTg3x4KbMg-HiqgvMQg8_7kBT_Y",
  authDomain: "anti-corruption-portal-genz.firebaseapp.com",
  projectId: "anti-corruption-portal-genz",
  storageBucket: "anti-corruption-portal-genz.firebasestorage.app",
  messagingSenderId: "1093062261347",
  appId: "1:1093062261347:web:fcaab57d667853776cd656"
};

const MAX_FILE_BYTES = 5 * 1024 * 1024;
let auth = null;

function isConsumerUser(user) {
  return Boolean(
    user
    && user.email
    && user.emailVerified
    && user.providerData.some(item =>
      item.providerId === "google.com" || item.providerId === "apple.com"
    )
  );
}

function requireConsumerUser() {
  if (!isConsumerUser(auth.currentUser)) {
    throw new Error("Sign in with a verified Google or Apple account first.");
  }
  return auth.currentUser;
}

function authProvider(providerName) {
  if (providerName === "google") {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    return provider;
  }
  if (providerName === "apple") {
    const provider = new OAuthProvider("apple.com");
    provider.addScope("email");
    provider.addScope("name");
    return provider;
  }
  throw new Error("Unsupported sign-in provider.");
}

function isFirebaseConfigured() {
  return firebaseConfig.apiKey !== "YOUR_FIREBASE_API_KEY"
    && firebaseConfig.projectId !== "YOUR_PROJECT_ID"
    && firebaseConfig.appId !== "YOUR_FIREBASE_APP_ID";
}

if (!isFirebaseConfigured()) {
  console.error("Firebase is not configured. Follow FIREBASE_SETUP.md.");
  window.showToast("Connect Firebase first. See FIREBASE_SETUP.md.");
} else {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  const db = getFirestore(app);
  const storage = getStorage(app);

  async function handlerRecord() {
    const user = auth.currentUser;
    if (!isConsumerUser(user)) return false;
    const snapshot = await getDoc(doc(db, "handlerAccounts", user.email));
    return snapshot.exists() && snapshot.data().email === user.email;
  }

  async function signInHandler(providerName) {
    const result = await signInWithPopup(auth, authProvider(providerName));
    const user = result.user;
    if (!(await handlerRecord())) {
      await signOut(auth);
      throw new Error("This Google or Apple account is not approved as a service handler.");
    }

    await addDoc(collection(db, "securityLoginEvents"), {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName || "",
      provider: providerName === "google" ? "google.com" : "apple.com",
      loginAt: serverTimestamp()
    });
    return user;
  }

  async function signInConsumer(providerName) {
    const result = await signInWithPopup(auth, authProvider(providerName));
    if (!isConsumerUser(result.user)) {
      await signOut(auth);
      throw new Error("Use a Google or Apple account with a verified email address.");
    }
    return result.user;
  }

  async function uploadEvidence(user, complaintId, file, kind) {
    if (!file) return null;
    if (file.size > MAX_FILE_BYTES) {
      throw new Error("Each file must be smaller than 5 MB.");
    }
    const fileRef = ref(
      storage,
      `complaints/${user.uid}/${complaintId}/${kind}`
    );
    await uploadBytes(fileRef, file, { contentType: file.type });
    return {
      path: fileRef.fullPath,
      url: await getDownloadURL(fileRef)
    };
  }

  async function createComplaint(complaint, imageFile, docFile) {
    const user = requireConsumerUser();

    const uploaded = [];
    try {
      const image = await uploadEvidence(user, complaint.id, imageFile, "image");
      if (image) uploaded.push(image.path);
      const document = await uploadEvidence(user, complaint.id, docFile, "document");
      if (document) uploaded.push(document.path);

      const now = new Date().toLocaleString();
      await setDoc(doc(db, "complaints", complaint.id), {
        ...complaint,
        ownerUid: user.uid,
        status: "Pending",
        response: "",
        imageUrl: image ? image.url : "",
        imagePath: image ? image.path : "",
        documentUrl: document ? document.url : "",
        documentPath: document ? document.path : "",
        documentName: docFile ? docFile.name : "",
        created: now,
        updated: now,
        createdAt: serverTimestamp()
      });
    } catch (error) {
      await Promise.all(
        uploaded.map(path =>
          deleteObject(ref(storage, path)).catch(cleanupError => {
            console.error("Could not clean up uploaded evidence.", cleanupError);
          })
        )
      );
      throw error;
    }
  }

  function listen(onNext, onError) {
    const complaintsQuery = query(
      collection(db, "complaints"),
      orderBy("createdAt", "desc")
    );
    return onSnapshot(
      complaintsQuery,
      snapshot => onNext(snapshot.docs.map(item => item.data())),
      onError
    );
  }

  async function getComplaint(id) {
    requireConsumerUser();
    const snapshot = await getDoc(doc(db, "complaints", id));
    return snapshot.exists() ? snapshot.data() : null;
  }

  async function listByOwner() {
    const user = requireConsumerUser();
    const complaintsQuery = query(
      collection(db, "complaints"),
      where("ownerUid", "==", user.uid)
    );
    const snapshot = await getDocs(complaintsQuery);
    return snapshot.docs
      .map(item => item.data())
      .sort((first, second) => second.createdAt.toMillis() - first.createdAt.toMillis());
  }

  async function respond(id, status, response) {
    if (!(await handlerRecord())) {
      throw new Error("Only an authorised service handler can respond.");
    }
    await updateDoc(doc(db, "complaints", id), {
      status,
      response,
      updated: new Date().toLocaleString()
    });
  }

  window.fb = {
    createComplaint,
    listen,
    getComplaint,
    listByOwner,
    respond,
    isHandler: handlerRecord,
    isConsumer: () => isConsumerUser(auth.currentUser),
    currentUser: () => auth.currentUser,
    signInHandler,
    signInConsumer,
    logout: () => signOut(auth)
  };

  onAuthStateChanged(auth, user => {
    window.dispatchEvent(new CustomEvent("fb-auth", { detail: user }));
  });
}
