import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signOut
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
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

const DEFAULT_COUNTRY_CODE = "+91";
const MAX_FILE_BYTES = 5 * 1024 * 1024;
let confirmationResult = null;
let recaptchaVerifier = null;
let auth = null;

function normalizeMobile(value) {
  const mobile = String(value || "").replace(/\D/g, "");
  if (!/^\d{10}$/.test(mobile)) {
    throw new Error("Enter a valid 10-digit mobile number.");
  }
  return mobile;
}

function mobileFromPhone(phoneNumber) {
  const digits = String(phoneNumber || "").replace(/\D/g, "");
  if (!digits.startsWith("91") || digits.length !== 12) {
    throw new Error("This portal currently supports Indian 10-digit mobile numbers.");
  }
  return digits.slice(2);
}

function requireUser() {
  if (!auth.currentUser) {
    throw new Error("Verify your mobile number before continuing.");
  }
  return auth.currentUser;
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
    const user = requireUser();
    const mobile = mobileFromPhone(user.phoneNumber);
    const snapshot = await getDoc(doc(db, "handlers", mobile));
    return snapshot.exists() && snapshot.data().active === true;
  }

  async function sendOtp(mobileValue) {
    const mobile = normalizeMobile(mobileValue);
    confirmationResult = null;
    if (recaptchaVerifier) {
      recaptchaVerifier.clear();
    }
    recaptchaVerifier = new RecaptchaVerifier(auth, "recaptcha-container", {
      size: "invisible"
    });
    confirmationResult = await signInWithPhoneNumber(
      auth,
      `${DEFAULT_COUNTRY_CODE}${mobile}`,
      recaptchaVerifier
    );
  }

  async function confirmOtp(code) {
    if (!confirmationResult) {
      throw new Error("Request a new OTP first.");
    }
    if (!/^\d{6}$/.test(String(code || "").trim())) {
      throw new Error("Enter the 6-digit OTP.");
    }
    const result = await confirmationResult.confirm(String(code).trim());
    confirmationResult = null;
    if (recaptchaVerifier) {
      recaptchaVerifier.clear();
      recaptchaVerifier = null;
    }
    return result;
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
    const user = requireUser();
    const mobile = mobileFromPhone(user.phoneNumber);
    if (mobile !== normalizeMobile(complaint.mobile)) {
      throw new Error("Verify the same mobile number entered on the form.");
    }

    const uploaded = [];
    try {
      const image = await uploadEvidence(user, complaint.id, imageFile, "image");
      if (image) uploaded.push(image.path);
      const document = await uploadEvidence(user, complaint.id, docFile, "document");
      if (document) uploaded.push(document.path);

      const now = new Date().toLocaleString();
      await setDoc(doc(db, "complaints", complaint.id), {
        ...complaint,
        mobile,
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
    const snapshot = await getDoc(doc(db, "complaints", id));
    return snapshot.exists() ? snapshot.data() : null;
  }

  async function listByMobile(mobileValue) {
    const user = requireUser();
    const mobile = normalizeMobile(mobileValue);
    if (mobileFromPhone(user.phoneNumber) !== mobile) {
      throw new Error("Verify the mobile number used for the complaint.");
    }
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
    sendOtp,
    confirmOtp,
    createComplaint,
    listen,
    getComplaint,
    listByMobile,
    respond,
    isHandler: handlerRecord,
    logout: () => signOut(auth)
  };

  onAuthStateChanged(auth, user => {
    window.dispatchEvent(new CustomEvent("fb-auth", { detail: user }));
  });
}
