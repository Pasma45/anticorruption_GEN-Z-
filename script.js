/* =====================================================
   ANTI CORRUPTION PORTAL  (Firebase version)

   Complaints and evidence are stored in Firestore / Storage (see firebase.js).
   localStorage is limited to language preferences and translated UI copy.
   ===================================================== */


let complaints = [];            // live list for the handler dashboard

let currentComplaint = null;

let handlerLoggedIn = false;

let stopListening = null;

let knownIds = null;            // used to announce NEW complaints

let complaintAudioFile = null;
let complaintAudioUrl = null;
let complaintAudioRecorder = null;
let complaintAudioStream = null;
let complaintAudioFinalizing = false;
let interfaceTextTranslations = new Map();

const PROTECTED_PAGES = [
  "dashboard",
  "complaint-history",
  "give-solution",
  "solution-sent",
  "profile"
];


/* =====================================================
   BASIC FUNCTIONS
   ===================================================== */


function $(id) {
  return document.getElementById(id);
}


/* only allow https links (stops javascript: links) */
function safeUrl(url) {
  return /^https:\/\//.test(url || "") ? url : "";
}


/* =====================================================
   PAGE NAVIGATION
   ===================================================== */


function showPage(id) {

  if (activeRecognition) activeRecognition.stop();
  if (
    id !== "consumer"
    && complaintAudioRecorder
    && complaintAudioRecorder.state !== "inactive"
  ) {
    complaintAudioFinalizing = true;
    complaintAudioRecorder.stop();
  }
  if (
    id !== "give-solution"
    && solutionAudioRecorder
    && solutionAudioRecorder.state !== "inactive"
  ) {
    solutionAudioFinalizing = true;
    solutionAudioRecorder.stop();
  }

  /* handler pages need a verified handler login */
  if (PROTECTED_PAGES.includes(id) && !handlerLoggedIn) {

    id = "handler-login";

    showToast("Please log in as a service handler.");

  }


  document
    .querySelectorAll(".page")
    .forEach(page => page.classList.remove("active"));


  const page = $(id);

  if (!page) return;

  page.classList.add("active");


  if (id === "dashboard") renderDashboard();

  if (id === "complaint-history") renderHistory();

  if (id === "give-solution") populateSolutionSelect();

  if (id === "take-action") renderActions();


  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });

}


/* =====================================================
   TOAST
   ===================================================== */


function showToast(message) {

  const toast = $("toast");

  toast.textContent = interfaceTextTranslations.get(message) || message;

  toast.classList.add("show");


  setTimeout(() => {

    toast.classList.remove("show");

  }, 3500);

}


window.handlerProviderSignIn = async function handlerProviderSignIn(provider) {

  if (!window.fb) {

    showToast("Still connecting. Try again in a moment.");

    return;

  };

  try {

    const user = await fb.signInHandler(provider);
    startHandlerSession();
    showPage("dashboard");
    showToast("Signed in as " + (user.displayName || user.email) + ".");

  } catch (error) {

    console.error(error);

    if (error && error.code === "auth/operation-not-allowed") {
      showToast("This sign-in provider is not enabled in Firebase Authentication yet.");
    } else if (error && error.code === "auth/popup-closed-by-user") {
      showToast("Sign-in was cancelled.");
    } else {
      showToast(error && error.message
        ? error.message
        : "Could not sign in. Please try again.");
    }

  }

}


async function consumerProviderSignIn(provider) {

  if (!window.fb) {

    showToast("Still connecting. Try again in a moment.");

    return;

  }

  try {

    const user = await fb.signInConsumer(provider);

    updateConsumerAuthUI(user);

    showToast("Signed in as " + (user.displayName || user.email) + ".");

  } catch (error) {

    console.error(error);

    if (error && error.code === "auth/operation-not-allowed") {
      showToast("This sign-in provider is not enabled in Firebase Authentication yet.");
    } else if (error && error.code === "auth/popup-closed-by-user") {
      showToast("Sign-in was cancelled.");
    } else {
      showToast(error && error.message
        ? error.message
        : "Could not sign in. Please try again.");
    }

  }

}


function updateConsumerAuthUI(user) {

  const signedIn = Boolean(user && window.fb && fb.isConsumer());

  const statuses = {
    consumerAuthStatus: signedIn
      ? "Signed in as " + user.email + ". You can submit a complaint."
      : "Sign in with Google or Apple to submit and track your complaints.",
    trackAuthStatus: signedIn
      ? "Signed in as " + user.email + ". Leave Query ID blank to find complaints submitted with this account."
      : "Sign in with Google or Apple to find complaints submitted with that account."
  };

  for (const [id, message] of Object.entries(statuses)) {

    const status = $(id);
    if (status) {
      status.textContent = message;
    }
  }

  for (const id of ["consumerAuthButtons", "trackAuthButtons"]) {

    const buttons = $(id);

    if (buttons) buttons.style.display = signedIn ? "none" : "flex";

  }

  for (const id of ["consumerSignOut", "trackSignOut"]) {

    const button = $(id);

    if (button) button.style.display = signedIn ? "block" : "none";

  }

  const submitButton = $("submitComplaintBtn");

  if (submitButton) submitButton.disabled = !signedIn;

}


/* =====================================================
   CHARACTER COUNTER
   ===================================================== */


$("details").addEventListener(
  "input",
  function () {

    $("charCount").textContent =
      this.value.length + "/1000";

  }
);


const speechLocaleIds = [
  "complaintSpeechLanguage",
  "trackSpeechLanguage",
  "solutionSpeechLanguage"
];
let activeRecognition = null;
let activeRecognitionButton = null;

for (const id of speechLocaleIds) {
  const select = $(id);
  if (select) {
    select.value = localStorage.getItem("portalSpeechLanguage") || "en-IN";
    select.addEventListener("change", function () {
      localStorage.setItem("portalSpeechLanguage", this.value);
      for (const otherId of speechLocaleIds) {
        const other = $(otherId);
        if (other) other.value = this.value;
      }
    });
  }
}

function activeSpeechLocale() {
  const select = document.querySelector(".page.active .speech-language");
  return select ? select.value : "en-IN";
}

function readAloud(text, language) {
  if (!("speechSynthesis" in window)) {
    showToast("Read-aloud is not supported by this browser.");
    return;
  }
  const content = String(text || "").trim();
  if (!content) {
    showToast("There is no text to read yet.");
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(content);
  utterance.lang = language || activeSpeechLocale();
  window.speechSynthesis.speak(utterance);
}

function startDictation(textareaId, statusId, language) {
  const button = textareaId === "details"
    ? $("dictateComplaintBtn")
    : $("dictateSolutionBtn");
  if (activeRecognition) {
    if (activeRecognitionButton === button) {
      activeRecognition.stop();
      return;
    }
    activeRecognition.stop();
  }
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showToast("Voice typing is not supported in this browser. Try Chrome.");
    return;
  }
  const textarea = $(textareaId);
  const status = $(statusId);
  const recognition = new SpeechRecognition();
  recognition.lang = language || activeSpeechLocale();
  recognition.continuous = true;
  recognition.interimResults = false;
  status.textContent = "Listening...";
  recognition.onresult = event => {
    const spoken = Array.from(event.results)
      .slice(event.resultIndex)
      .map(result => result[0].transcript.trim())
      .filter(Boolean)
      .join(" ");
    if (spoken) {
      const separator = textarea.value && !/\s$/.test(textarea.value) ? " " : "";
      const remaining = 1000 - textarea.value.length;
      textarea.value += (separator + spoken).slice(0, remaining);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    }
  };
  recognition.onerror = event => {
    status.textContent = "Voice typing stopped: " + event.error + ".";
    console.error("Voice recognition failed.", event.error);
  };
  recognition.onend = () => {
    if (status.textContent === "Listening...") status.textContent = "Voice typing stopped.";
    if (activeRecognition === recognition) {
      activeRecognition = null;
      activeRecognitionButton = null;
    }
  };
  try {
    activeRecognition = recognition;
    activeRecognitionButton = button;
    recognition.start();
    status.textContent = "Listening... Press the microphone button again to stop.";
  } catch (error) {
    activeRecognition = null;
    activeRecognitionButton = null;
    console.error("Could not start voice recognition.", error);
    status.textContent = "Could not start voice typing. Check microphone permission.";
  }
}

$("dictateComplaintBtn").addEventListener("click", () =>
  startDictation("details", "complaintVoiceStatus", $("complaintSpeechLanguage").value)
);
$("dictateSolutionBtn").addEventListener("click", () =>
  startDictation("solutionText", "solutionVoiceStatus", $("solutionSpeechLanguage").value)
);
$("readComplaintBtn").addEventListener("click", () =>
  readAloud(
    [$("issue").value, $("details").value].filter(Boolean).join(". "),
    $("complaintSpeechLanguage").value
  )
);

function clearComplaintAudio() {
  if (complaintAudioRecorder && complaintAudioRecorder.state !== "inactive") {
    complaintAudioRecorder.stop();
  }
  if (complaintAudioStream) {
    complaintAudioStream.getTracks().forEach(track => track.stop());
  }
  if (complaintAudioUrl) URL.revokeObjectURL(complaintAudioUrl);
  complaintAudioFile = null;
  complaintAudioUrl = null;
  complaintAudioRecorder = null;
  complaintAudioStream = null;
  complaintAudioFinalizing = false;
  $("complaintAudioPreview").removeAttribute("src");
  $("complaintAudioPreview").hidden = true;
  $("removeComplaintAudioBtn").hidden = true;
  $("recordComplaintAudioBtn").disabled = false;
  $("stopComplaintAudioBtn").disabled = true;
  $("complaintAudioStatus").textContent =
    "Optional audio attachment, up to 5 MB. Your recording is stored with this complaint.";
}

async function startComplaintAudioRecording() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
    showToast("Audio recording is not supported in this browser.");
    return;
  }
  if (complaintAudioFile) {
    showToast("Remove the current recording before recording another.");
    return;
  }
  try {
    complaintAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const preferredType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : undefined;
    complaintAudioRecorder = preferredType
      ? new MediaRecorder(complaintAudioStream, { mimeType: preferredType })
      : new MediaRecorder(complaintAudioStream);
    const recorder = complaintAudioRecorder;
    const recordingStream = complaintAudioStream;
    const chunks = [];
    recorder.addEventListener("dataavailable", event => {
      if (event.data.size) chunks.push(event.data);
    });
    recorder.addEventListener("stop", () => {
      const mimeType = recorder.mimeType || (chunks[0] && chunks[0].type);
      const blob = new Blob(chunks, { type: mimeType || "audio/webm" });
      recordingStream.getTracks().forEach(track => track.stop());
      if (complaintAudioRecorder !== recorder) return;
      complaintAudioStream = null;
      complaintAudioRecorder = null;
      complaintAudioFinalizing = false;
      $("recordComplaintAudioBtn").disabled = false;
      $("stopComplaintAudioBtn").disabled = true;
      if (blob.size > MAX_FILE_BYTES) {
        $("complaintAudioStatus").textContent =
          "Recording is larger than 5 MB. Make a shorter recording and try again.";
        return;
      }
      if (!blob.size) {
        $("complaintAudioStatus").textContent = "No audio was recorded.";
        return;
      }
      const extension = blob.type.includes("mp4") ? "mp4"
        : blob.type.includes("ogg") ? "ogg" : "webm";
      complaintAudioFile = new File(
        [blob],
        `complaint-audio-${Date.now()}.${extension}`,
        { type: blob.type }
      );
      complaintAudioUrl = URL.createObjectURL(complaintAudioFile);
      $("complaintAudioPreview").src = complaintAudioUrl;
      $("complaintAudioPreview").hidden = false;
      $("removeComplaintAudioBtn").hidden = false;
      $("complaintAudioStatus").textContent =
        "Recording ready (" + (blob.size / 1024 / 1024).toFixed(2) + " MB).";
    }, { once: true });
    recorder.start();
    complaintAudioFinalizing = false;
    $("recordComplaintAudioBtn").disabled = true;
    $("stopComplaintAudioBtn").disabled = false;
    $("complaintAudioStatus").textContent =
      "Recording... Select Stop recording when finished.";
  } catch (error) {
    if (complaintAudioStream) {
      complaintAudioStream.getTracks().forEach(track => track.stop());
    }
    complaintAudioStream = null;
    complaintAudioRecorder = null;
    console.error("Could not start complaint audio recording.", error);
    $("complaintAudioStatus").textContent =
      "Could not start recording. Check microphone permission and try again.";
  }
}

$("recordComplaintAudioBtn").addEventListener("click", startComplaintAudioRecording);
$("stopComplaintAudioBtn").addEventListener("click", () => {
  if (complaintAudioRecorder && complaintAudioRecorder.state !== "inactive") {
    complaintAudioFinalizing = true;
    complaintAudioRecorder.stop();
  }
});
$("removeComplaintAudioBtn").addEventListener("click", clearComplaintAudio);


async function fillCurrentLocation() {
  const button = $("useLocationBtn");
  const status = $("locationStatus");
  if (!navigator.geolocation) {
    status.textContent = "This browser does not support location access.";
    return;
  }
  button.disabled = true;
  status.textContent = "Waiting for location permission...";
  try {
    const position = await new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0
      })
    );
    status.textContent = "Looking up the approximate village and state...";
    const { latitude, longitude } = position.coords;
    const response = await fetch(
      "https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&addressdetails=1&lat="
      + encodeURIComponent(latitude) + "&lon=" + encodeURIComponent(longitude),
      { headers: { Accept: "application/json" } }
    );
    if (!response.ok) throw new Error("Address lookup returned HTTP " + response.status);
    const result = await response.json();
    const address = result.address || {};
    const village = address.village || address.hamlet || address.town
      || address.city || address.suburb || address.county || "";
    if (!village && !address.state) {
      throw new Error("No village or state was found near this location.");
    }
    if (village) $("locationVillage").value = village;
    if (address.state) $("locationState").value = address.state;
    const area = [address.county, address.state].filter(Boolean).join(", ");
    if (area) $("location").value = area;
    status.textContent = "Location filled from an approximate GPS lookup. Please check and correct it if needed.";
  } catch (error) {
    console.error("Could not fill the complaint location.", error);
    status.textContent = error.code === 1
      ? "Location permission was denied. You can enter the area, village and state manually."
      : error.message || "Location lookup failed. You can enter the location manually.";
  } finally {
    button.disabled = false;
  }
}

$("useLocationBtn").addEventListener("click", fillCurrentLocation);


const previewUrls = new Map();

function updateMediaPreview(inputId, previewId, removeId, type) {
  const input = $(inputId);
  const preview = $(previewId);
  const remove = $(removeId);
  const oldUrl = previewUrls.get(inputId);
  if (oldUrl) URL.revokeObjectURL(oldUrl);
  previewUrls.delete(inputId);
  preview.replaceChildren();
  const file = input.files[0];
  remove.hidden = !file;
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) {
    showToast("This file is larger than 5 MB and will not upload. You can remove it and continue with your complaint.");
  }
  const url = URL.createObjectURL(file);
  previewUrls.set(inputId, url);
  const player = document.createElement(type === "video" ? "video" : "img");
  player.src = url;
  if (type === "video") {
    player.controls = true;
    player.playsInline = true;
  } else {
    player.alt = "Selected photo preview";
  }
  preview.append(player);
}

for (const [inputId, previewId, removeId, type] of [
  ["image", "imagePreview", "removeImageBtn", "image"],
  ["video", "videoPreview", "removeVideoBtn", "video"]
]) {
  $(inputId).addEventListener("change", () =>
    updateMediaPreview(inputId, previewId, removeId, type)
  );
  $(removeId).addEventListener("click", () => {
    $(inputId).value = "";
    updateMediaPreview(inputId, previewId, removeId, type);
  });
}

$("document").addEventListener("change", function () {
  if (this.files[0] && this.files[0].size > MAX_FILE_BYTES) {
    showToast("This document is larger than 5 MB and will not upload. You can remove it and continue with your complaint.");
  }
});


/* =====================================================
  QUERY ID  (9 random digits, hard to guess)
   ===================================================== */


function generateQueryId() {

  const n =
    crypto.getRandomValues(new Uint32Array(1))[0] % 900000000
    + 100000000;

  return "AC-" + new Date().getFullYear() + "-" + n;

}


/* =====================================================
   CONSUMER COMPLAINT  (saves to Firestore + Storage)
   ===================================================== */


const MAX_FILE_BYTES = 5 * 1024 * 1024;


$("complaintForm").addEventListener(
  "submit",
  async function (event) {

    event.preventDefault();

    const form = this;

    if (!window.fb || !fb.isConsumer()) {

      showToast("Sign in with Google or Apple before submitting your complaint.");

      return;

    }

    if (
      complaintAudioFinalizing
      || (complaintAudioRecorder && complaintAudioRecorder.state !== "inactive")
    ) {
      showToast("Stop the audio recording before submitting the complaint.");
      return;
    }

    const imageFile = $("image").files[0];

    const docFile = $("document").files[0];
    const videoFile = $("video").files[0];
    const audioFile = complaintAudioFile;


    const selectedEvidenceCount = [imageFile, docFile, videoFile, audioFile].filter(Boolean).length;
    const oversizedEvidenceCount = [imageFile, docFile, videoFile, audioFile]
      .filter(file => file && file.size > MAX_FILE_BYTES).length;
    const uploadImage = imageFile && imageFile.size <= MAX_FILE_BYTES ? imageFile : null;
    const uploadDocument = docFile && docFile.size <= MAX_FILE_BYTES ? docFile : null;
    const uploadVideo = videoFile && videoFile.size <= MAX_FILE_BYTES ? videoFile : null;
    const uploadAudio = audioFile && audioFile.size <= MAX_FILE_BYTES ? audioFile : null;


    if (!window.fb) {

      showToast("Still connecting. Try again in a moment.");

      return;

    }


    const button = form.querySelector('button[type="submit"]');

    const label = button.textContent;

    button.disabled = true;

    button.textContent = "Submitting...";


    try {

      const complaint = {

        id: generateQueryId(),

        name: $("name").value.trim() || "Anonymous",

        location: $("location").value.trim(),
        locationState: $("locationState").value.trim(),
        locationVillage: $("locationVillage").value.trim(),
        issue: $("issue").value,
        details: $("details").value.trim()
      };

      let evidenceStatus = null;

      const result = await fb.createComplaint(
        complaint,
        uploadImage,
        uploadDocument,
        uploadVideo,
        uploadAudio,
        update => {
          evidenceStatus = { ...update };
          if (update.status === "uploading" && oversizedEvidenceCount) {
            evidenceStatus.message += ` ${oversizedEvidenceCount} file(s) exceed the 5 MB upload limit.`;
          } else if (update.status !== "uploading" && oversizedEvidenceCount) {
            evidenceStatus.errors = (update.errors || 0) + oversizedEvidenceCount;
            evidenceStatus.total = selectedEvidenceCount;
            evidenceStatus.status = "partial";
            evidenceStatus.message =
              `Complaint submitted, but ${evidenceStatus.errors} of ${selectedEvidenceCount} evidence file(s) could not be uploaded (5 MB maximum per file).`;
          }
          $("submissionProgress").hidden = false;
          $("submissionProgress").textContent = evidenceStatus.message;
          button.textContent = evidenceStatus.message;
          if ($("submitted").classList.contains("active")) {
            renderSubmittedEvidenceStatus(evidenceStatus);
          }
        }
      );


      $("submittedId").textContent =
        "Query ID: " + complaint.id;
      $("submittedId").dataset.queryId = complaint.id;
      $("submittedConsumerEmail").textContent =
        fb.currentUser().email || "Your verified sign-in email";
      $("submittedHandlerEmail").textContent =
        "A handler contact will appear when your case is assigned.";

      renderSubmittedEvidenceStatus(evidenceStatus || {
        status: result.evidencePending ? "uploading" : oversizedEvidenceCount ? "partial" : "complete",
        errors: oversizedEvidenceCount,
        total: selectedEvidenceCount,
        message: result.evidencePending
          ? "Your complaint is saved and visible in the handler inbox. Evidence is uploading in the background."
            + (oversizedEvidenceCount ? ` ${oversizedEvidenceCount} file(s) exceed the 5 MB limit.` : "")
          : oversizedEvidenceCount
            ? `Your complaint is saved, but ${oversizedEvidenceCount} evidence file(s) exceed the 5 MB upload limit.`
            : "Your complaint has been saved and sent to the handler inbox."
      });

      form.reset();
      clearComplaintAudio();
      for (const [inputId, previewId, removeId, type] of [
        ["image", "imagePreview", "removeImageBtn", "image"],
        ["video", "videoPreview", "removeVideoBtn", "video"]
      ]) {
        updateMediaPreview(inputId, previewId, removeId, type);
      }

      $("charCount").textContent = "0/1000";
      $("submissionProgress").hidden = true;

      updateConsumerAuthUI(fb.currentUser());

      showPage("submitted");

    }

    catch (error) {

      console.error(error);

      const reason = error && (error.code || error.message);
      showToast(
        "Complaint was not submitted"
        + (reason ? " (" + reason + ")." : ". Please try again.")
      );
      $("submissionProgress").hidden = true;

    }

    finally {

      button.disabled = false;

      button.textContent = label;

    }

  }
);

function renderSubmittedEvidenceStatus(update) {
  const notice = $("submittedEvidenceNotice");
  if (!update || (!update.total && update.status === "complete")) {
    notice.hidden = true;
    return;
  }
  notice.hidden = false;
  notice.textContent = update.status === "uploading"
    ? "Your complaint is saved and visible in the handler inbox. Evidence is uploading in the background; keep this page open until it finishes."
    : update.errors
      ? update.message + " The complaint itself remains saved in the handler inbox."
      : "Complaint and selected evidence have been uploaded successfully.";
}


/* =====================================================
   TRACK FROM HOME
   ===================================================== */


function trackFromHome() {

  $("trackQueryId").value = $("homeTrackQueryId").value.trim();


  showPage("track");


  trackComplaint();

}


function trackSubmittedComplaint() {

  $("trackQueryId").value = $("submittedId").dataset.queryId || "";

  showPage("track");

  trackComplaint();

}


/* =====================================================
   TRACK COMPLAINT

   Only complaints owned by the signed-in Google/Apple
   account can be loaded.
   ===================================================== */


function renderTrack(list) {

  if (!list.length) {

    $("trackResult").innerHTML = `
      <div class="panel">
        <p>${escapeHTML(uiText("No complaint found for this account and filter."))}</p>
      </div>`;

    return;

  }


  $("trackResult").innerHTML = list.map(c => `

    <div class="panel complaint-result">

      <h2>
        ${escapeHTML(c.id)}
        <span class="status ${escapeHTML(c.status).replace(/\s.*/, "")}">
          ${escapeHTML(c.status)}
        </span>
      </h2>

      <p><b>${escapeHTML(uiText("Issue:"))}</b> ${escapeHTML(c.issue)}</p>

      <p><b>${escapeHTML(uiText("Submitted:"))}</b> ${escapeHTML(c.created)}</p>

      <p>${escapeHTML(c.details)}</p>

      ${c.location
        ? `<p><b>${escapeHTML(uiText("Location:"))}</b> ${escapeHTML(c.location)}</p>` : ""}

      ${(c.locationVillage || c.locationState)
        ? `<p><b>${escapeHTML(uiText("Village / Town:"))}</b> ${escapeHTML(c.locationVillage || "—")} &nbsp; <b>${escapeHTML(uiText("State:"))}</b> ${escapeHTML(c.locationState || "—")}</p>`
        : ""}

      ${safeUrl(c.imageUrl)
        ? `<p><a href="${escapeHTML(safeUrl(c.imageUrl))}"
              target="_blank" rel="noopener">
              <img class="evidence-img"
                   src="${escapeHTML(safeUrl(c.imageUrl))}"
                   alt="Attached image"></a></p>` : ""}

      ${safeUrl(c.complaintAudioUrl)
        ? `<p><b>${escapeHTML(uiText("Audio complaint:"))}</b><br><audio controls preload="none" src="${escapeHTML(safeUrl(c.complaintAudioUrl))}"></audio></p>` : ""}

      ${safeUrl(c.videoUrl)
        ? `<p><b>${escapeHTML(uiText("Attached video:"))}</b><br><video controls playsinline class="evidence-video" src="${escapeHTML(safeUrl(c.videoUrl))}"></video></p>` : ""}

      ${safeUrl(c.documentUrl)
        ? `<p class="muted">${escapeHTML(uiText("Document:"))}
              <a href="${escapeHTML(safeUrl(c.documentUrl))}"
                 target="_blank" rel="noopener">
                 ${escapeHTML(c.documentName)}</a></p>` : ""}

      <div class="notice">
        ${c.response
          ? `<b>${escapeHTML(uiText("Officer Response:"))}</b> ${escapeHTML(c.response)}`
          : "⏳ " + escapeHTML(uiText("Your complaint is under review. The service officer will reply soon."))}
      </div>

      ${c.handlerEmail
        ? `<p class="notice"><b>${escapeHTML(uiText("Service handler contact:"))}</b> <a href="mailto:${escapeHTML(c.handlerEmail)}">${escapeHTML(c.handlerEmail)}</a></p>`
        : ""}

      ${safeUrl(c.responseAudioUrl)
        ? `<p><b>${escapeHTML(uiText("Voice response:"))}</b><br><audio controls preload="none" src="${escapeHTML(safeUrl(c.responseAudioUrl))}"></audio></p>` : ""}

      <p class="muted">
        <b>${escapeHTML(uiText("Last updated:"))}</b> ${escapeHTML(c.updated)}
      </p>

    </div>

  `).join("");

}


async function trackComplaint() {

  const queryId = $("trackQueryId").value.trim().toUpperCase();

  if (!window.fb) {

    showToast("Still connecting. Try again in a moment.");

    return;

  }

  if (!fb.isConsumer()) {

    showToast("Sign in with the account used to submit your complaint.");

    return;

  }


  try {

    let list;

    if (/^AC-\d{4}-\d{9}$/i.test(queryId)) {

      const complaint = await fb.getComplaint(queryId);

      list = complaint ? [complaint] : [];

    } else {

      list = await fb.listByOwner();
      if (queryId) {
        list = list.filter(c => [
          c.id,
          c.issue,
          c.location,
          c.locationVillage,
          c.locationState,
          c.details,
          c.response
        ].some(value => String(value || "").toLowerCase().includes(queryId.toLowerCase())));
      }

    }

    renderTrack(list);

  }

  catch (error) {

    console.error(error);

    showToast("Could not access that complaint. Check the Query ID and sign in with the account used to submit it.");

  }

}


/* keeps the handler signed in after a page reload */

window.addEventListener("fb-auth", async function (event) {

  const user = event.detail;

  updateConsumerAuthUI(user);

  if (
    interfaceLanguageSelect.value !== "en"
    && appliedInterfaceLanguage !== interfaceLanguageSelect.value
    && !interfaceTranslationBusy
  ) {
    changeInterfaceLanguage(interfaceLanguageSelect.value);
  }

  if (!user || handlerLoggedIn) return;

  try {

    if (await fb.isHandler()) startHandlerSession();

  } catch (error) {

    console.error(error);

    showToast("Could not verify service-handler access.");

  }

});


/* =====================================================
   LIVE COMPLAINT LIST  (new complaints appear instantly)
   ===================================================== */


function startHandlerSession() {

  handlerLoggedIn = true;

  if (stopListening) stopListening();

  knownIds = null;


  stopListening = fb.listen(

    function (list) {

      if (knownIds) {

        const fresh = list.filter(c => !knownIds.has(c.id));

        if (fresh.length) {

          showToast("New complaint received: " + fresh[0].id);

        }

      }

      knownIds = new Set(list.map(c => c.id));

      complaints = list;


      if ($("dashboard").classList.contains("active")) {

        renderDashboard();

      }
      if ($("complaint-history").classList.contains("active")) renderHistory();
      if ($("give-solution").classList.contains("active")) populateSolutionSelect();

    },

    function (error) {

      console.error(error);

      showToast("Could not load complaints.");

    }

  );

}

async function refreshHandlerInbox() {
  if (!window.fb || !handlerLoggedIn) {
    showToast("Sign in as an authorised service handler to refresh the inbox.");
    return;
  }

  const button = $("refreshComplaintsBtn");
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Refreshing...";
  try {
    complaints = await fb.refreshComplaints();
    knownIds = new Set(complaints.map(complaint => complaint.id));
    renderDashboard();
    renderHistory();
    if ($("give-solution").classList.contains("active")) populateSolutionSelect();
    showToast("Complaint inbox refreshed.");
  } catch (error) {
    console.error("Could not refresh the complaint inbox.", error);
    showToast(
      "Could not refresh the complaint inbox"
      + (error.code ? " (" + error.code + ")." : ". Check your connection and handler access.")
    );
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}


async function logout() {

  if (stopListening) stopListening();

  stopListening = null;

  handlerLoggedIn = false;

  complaints = [];
  clearSolutionAudio();

  try { await fb.logout(); } catch (error) { console.error(error); }


  showPage("home");

  showToast("Logged out successfully.");

}


/* =====================================================
   DASHBOARD
   ===================================================== */


function evidenceHTML(c) {

  const url = safeUrl(c.imageUrl);
  const audioUrl = safeUrl(c.complaintAudioUrl);
  const videoUrl = safeUrl(c.videoUrl);
  const documentUrl = safeUrl(c.documentUrl);
  const evidence = [];

  if (url) evidence.push(
    `<a href="${escapeHTML(url)}" target="_blank" rel="noopener"><img class="thumb" src="${escapeHTML(url)}" alt="Photo evidence"></a>`
  );
  if (audioUrl) evidence.push(
    `<audio controls preload="none" aria-label="${escapeHTML(uiText("Audio complaint:"))}" src="${escapeHTML(audioUrl)}"></audio>`
  );
  if (videoUrl) evidence.push(
    `<a href="${escapeHTML(videoUrl)}" target="_blank" rel="noopener">${escapeHTML(c.videoName || "Video")}</a>`
  );
  if (documentUrl) evidence.push(
    `<a href="${escapeHTML(documentUrl)}" target="_blank" rel="noopener">${escapeHTML(c.documentName || "Document")}</a>`
  );
  return evidence.join("<br>") || "—";

}


function renderRows(list) {

  if (!list.length) {

    $("complaintsTable").innerHTML =
      `<tr><td colspan="6">${escapeHTML(uiText("No complaints yet."))}</td></tr>`;

    return;

  }


  $("complaintsTable").innerHTML = list.map(c => `

    <tr>

      <td>${escapeHTML(c.id)}</td>

      <td>${escapeHTML(c.name)}</td>

      <td>${escapeHTML(c.issue)}</td>

      <td>
        <span class="status ${escapeHTML(c.status).replace(/\s.*/, "")}">
          ${escapeHTML(c.status)}
        </span>
      </td>

      <td>${evidenceHTML(c)}</td>

      <td>
        <button class="secondary"
                onclick="openComplaint('${escapeJS(c.id)}')">
          View
        </button>
      </td>

    </tr>

  `).join("");

}


function renderDashboard() {

  $("totalStat").textContent = complaints.length;

  $("validStat").textContent =
    complaints.filter(c => c.status !== "Rejected").length;

  $("pendingStat").textContent =
    complaints.filter(
      c => c.status === "Pending" || c.status === "Under Review"
    ).length;

  $("resolvedStat").textContent =
    complaints.filter(c => c.status === "Resolved").length;


  const search = $("handlerSearch").value.trim().toLowerCase();
  renderRows(complaints.filter(c =>
    !["Resolved", "Rejected"].includes(c.status)
    && matchesComplaintSearch(c, search)
  ));

}

function matchesComplaintSearch(complaint, search) {
  if (!search) return true;
  return [
    complaint.id,
    complaint.name,
    complaint.issue,
    complaint.location,
    complaint.locationVillage,
    complaint.locationState,
    complaint.details,
    complaint.response
  ].some(value => String(value || "").toLowerCase().includes(search));
}

function renderHistory() {
  const search = $("historySearch").value.trim().toLowerCase();
  const historical = complaints.filter(c =>
    ["Resolved", "Rejected"].includes(c.status)
    && matchesComplaintSearch(c, search)
  );
  renderRowsTo("historyTable", historical);
}

function renderRowsTo(tableId, list) {
  const table = $(tableId);
  if (!list.length) {
    table.innerHTML = `<tr><td colspan="6">No matching complaints.</td></tr>`;
    return;
  }
  table.innerHTML = list.map(c => `
    <tr>
      <td>${escapeHTML(c.id)}</td>
      <td>${escapeHTML(c.name)}</td>
      <td>${escapeHTML(c.issue)}</td>
      <td><span class="status ${escapeHTML(c.status).replace(/\s.*/, "")}">${escapeHTML(c.status)}</span></td>
      <td>${evidenceHTML(c)}</td>
      <td><button class="secondary" onclick="openComplaint('${escapeJS(c.id)}')">View</button></td>
    </tr>
  `).join("");
}


function filterComplaints(status) {

  if (status !== "Valid") return;

  renderRows(complaints.filter(c => c.status !== "Rejected"));

  showToast("Showing valid complaints.");

}


/* =====================================================
   GIVE SOLUTION
   ===================================================== */


function renderSolutionDetails(id) {

  const c = complaints.find(item => item.id === id);

  const box = $("solutionDetails");

  if (!c) {

    box.innerHTML = "";

    return;

  }


  const image = safeUrl(c.imageUrl);
  const audio = safeUrl(c.complaintAudioUrl);
  const file = safeUrl(c.documentUrl);

  const video = safeUrl(c.videoUrl);
  const responseAudio = safeUrl(c.responseAudioUrl);


  box.innerHTML = `

    <b>${escapeHTML(uiText("Location:"))}</b> ${escapeHTML(c.location || "—")}<br>
    <b>${escapeHTML(uiText("Village / Town:"))}</b> ${escapeHTML(c.locationVillage || "—")}<br>
    <b>${escapeHTML(uiText("State:"))}</b> ${escapeHTML(c.locationState || "—")}<br>

    <b>${escapeHTML(uiText("Submitted:"))}</b> ${escapeHTML(c.created)}<br><br>

    <b>${escapeHTML(uiText("Details:"))}</b> ${escapeHTML(c.details)}

    ${image
      ? `<br><br><a href="${escapeHTML(image)}" target="_blank" rel="noopener">
           <img class="evidence-img" src="${escapeHTML(image)}"
                alt="${escapeHTML(uiText("Image uploaded by the consumer"))}"></a>`
      : ""}

    ${audio
      ? `<br><br><b>${escapeHTML(uiText("Consumer audio complaint:"))}</b><br><audio controls preload="none" src="${escapeHTML(audio)}"></audio>`
      : ""}

    ${file
      ? `<br><br>📎 <a href="${escapeHTML(file)}" target="_blank"
           rel="noopener">${escapeHTML(c.documentName)}</a>`
      : ""}

    ${video
      ? `<br><br><video controls playsinline class="evidence-video" src="${escapeHTML(video)}"></video>`
      : ""}

    ${responseAudio
      ? `<br><br><b>${escapeHTML(uiText("Previous voice response:"))}</b><br><audio controls preload="none" src="${escapeHTML(responseAudio)}"></audio>`
      : ""}

  `;


  $("solutionText").value = c.response || "";

  $("solutionStatus").value =
    c.status === "Resolved" || c.status === "Rejected"
      ? c.status
      : "Under Review";

}


function openComplaint(id) {

  const complaint = complaints.find(item => item.id === id);

  if (!complaint) return;

  currentComplaint = complaint;

  showPage("give-solution");

}


function populateSolutionSelect() {

  if (!complaints.length) {

    $("solutionComplaint").innerHTML =
      `<option value="">${escapeHTML(uiText("No complaints"))}</option>`;

    $("solutionDetails").innerHTML = "";

    return;

  }


  $("solutionComplaint").innerHTML = complaints.map(c => `

    <option value="${escapeHTML(c.id)}">
      ${escapeHTML(c.id)} — ${escapeHTML(c.name)} — ${escapeHTML(c.issue)}
    </option>

  `).join("");


  if (currentComplaint) {

    $("solutionComplaint").value = currentComplaint.id;

  }


  renderSolutionDetails($("solutionComplaint").value);

}


$("solutionComplaint").addEventListener(
  "change",
  function () {

    clearSolutionAudio();

    currentComplaint =
      complaints.find(item => item.id === this.value) || null;

    renderSolutionDetails(this.value);

  }
);

let solutionAudioFile = null;
let solutionAudioUrl = null;
let solutionAudioRecorder = null;
let solutionAudioStream = null;
let solutionAudioComplaintId = "";
let solutionAudioFinalizing = false;

function clearSolutionAudio() {
  if (solutionAudioRecorder && solutionAudioRecorder.state !== "inactive") {
    solutionAudioRecorder.stop();
  }
  if (solutionAudioStream) {
    solutionAudioStream.getTracks().forEach(track => track.stop());
  }
  if (solutionAudioUrl) URL.revokeObjectURL(solutionAudioUrl);
  solutionAudioFile = null;
  solutionAudioUrl = null;
  solutionAudioRecorder = null;
  solutionAudioStream = null;
  solutionAudioComplaintId = "";
  solutionAudioFinalizing = false;
  $("solutionAudioPreview").removeAttribute("src");
  $("solutionAudioPreview").hidden = true;
  $("removeSolutionAudioBtn").hidden = true;
  $("recordSolutionAudioBtn").disabled = false;
  $("stopSolutionAudioBtn").disabled = true;
  $("solutionAudioStatus").textContent =
    "Optional voice recording, up to 5 MB. It is attached only when you send the response.";
}

async function startSolutionAudioRecording() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
    showToast("Voice recording is not supported in this browser.");
    return;
  }
  if (!$("solutionComplaint").value) {
    showToast("Select a complaint before recording a voice response.");
    return;
  }
  if (solutionAudioFile) {
    showToast("Remove the current recording before recording a new one.");
    return;
  }
  try {
    solutionAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const preferredType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : undefined;
    solutionAudioRecorder = preferredType
      ? new MediaRecorder(solutionAudioStream, { mimeType: preferredType })
      : new MediaRecorder(solutionAudioStream);
    const recorder = solutionAudioRecorder;
    const recordingStream = solutionAudioStream;
    solutionAudioComplaintId = $("solutionComplaint").value;
    const chunks = [];
    recorder.addEventListener("dataavailable", event => {
      if (event.data.size) chunks.push(event.data);
    });
    recorder.addEventListener("stop", () => {
      const mimeType = recorder.mimeType || (chunks[0] && chunks[0].type);
      const blob = new Blob(chunks, { type: mimeType || "audio/webm" });
      recordingStream.getTracks().forEach(track => track.stop());
      if (solutionAudioRecorder !== recorder) return;
      solutionAudioStream = null;
      solutionAudioRecorder = null;
      solutionAudioFinalizing = false;
      $("recordSolutionAudioBtn").disabled = false;
      $("stopSolutionAudioBtn").disabled = true;
      if (blob.size > MAX_FILE_BYTES) {
        solutionAudioComplaintId = "";
        $("solutionAudioStatus").textContent =
          "Recording is larger than 5 MB. Please make a shorter recording.";
        return;
      }
      if (!blob.size) {
        solutionAudioComplaintId = "";
        $("solutionAudioStatus").textContent = "No audio was recorded.";
        return;
      }
      const extension = blob.type.includes("mp4") ? "mp4"
        : blob.type.includes("ogg") ? "ogg" : "webm";
      solutionAudioFile = new File(
        [blob],
        `voice-response-${Date.now()}.${extension}`,
        { type: blob.type }
      );
      solutionAudioUrl = URL.createObjectURL(solutionAudioFile);
      $("solutionAudioPreview").src = solutionAudioUrl;
      $("solutionAudioPreview").hidden = false;
      $("removeSolutionAudioBtn").hidden = false;
      $("solutionAudioStatus").textContent =
        "Recording ready (" + (blob.size / 1024 / 1024).toFixed(2) + " MB).";
    }, { once: true });
    solutionAudioRecorder.start();
    solutionAudioFinalizing = false;
    $("recordSolutionAudioBtn").disabled = true;
    $("stopSolutionAudioBtn").disabled = false;
    $("solutionAudioStatus").textContent = "Recording... Select Stop recording when finished.";
  } catch (error) {
    if (solutionAudioStream) {
      solutionAudioStream.getTracks().forEach(track => track.stop());
    }
    solutionAudioStream = null;
    solutionAudioRecorder = null;
    console.error("Could not start voice recording.", error);
    $("solutionAudioStatus").textContent =
      "Could not start recording. Check microphone permission and try again.";
  }
}

$("recordSolutionAudioBtn").addEventListener("click", startSolutionAudioRecording);
$("stopSolutionAudioBtn").addEventListener("click", () => {
  if (solutionAudioRecorder && solutionAudioRecorder.state !== "inactive") {
    solutionAudioFinalizing = true;
    solutionAudioRecorder.stop();
  }
});
$("removeSolutionAudioBtn").addEventListener("click", clearSolutionAudio);

for (const id of ["handlerSearch", "historySearch"]) {
  $(id).addEventListener("input", () => {
    if (id === "handlerSearch") renderDashboard();
    else renderHistory();
  });
}

function useSolutionTemplate(text) {
  $("solutionText").value = text;
  $("solutionText").focus();
}


async function sendSolution() {

  const id = $("solutionComplaint").value;

  const response = $("solutionText").value.trim();
  const sendButton = document.querySelector("#give-solution button[onclick=\"sendSolution()\"]");
  const originalLabel = sendButton.textContent;


  const selectedComplaint = complaints.find(item => item.id === id);
  if (!selectedComplaint) {

    showToast("No complaint selected.");

    return;

  }


  if (!response && $("solutionStatus").value === selectedComplaint.status) {

    showToast("Write a response or choose a different status.");

    return;

  }

  if (
    solutionAudioFinalizing
    || (solutionAudioRecorder && solutionAudioRecorder.state !== "inactive")
  ) {
    showToast("Stop the voice recording before sending the response.");
    return;
  }

  if (solutionAudioFile && solutionAudioComplaintId !== id) {
    showToast("The voice recording belongs to a different complaint. Record it again.");
    clearSolutionAudio();
    return;
  }

  sendButton.disabled = true;
  sendButton.textContent = "Sending solution...";

  try {

    const result = await fb.respond(
      id,
      $("solutionStatus").value,
      response,
      solutionAudioFile
    );

    const complaint = complaints.find(item => item.id === id);
    const handlerEmail = fb.currentUser().email || "";
    $("solutionSentId").textContent = id;
    $("solutionSentTitle").textContent = response ? "Solution Sent" : "Status Updated";
    $("solutionSentStatus").textContent = $("solutionStatus").value;
    $("solutionSentConsumerEmail").textContent =
      complaint && complaint.consumerEmail
        ? complaint.consumerEmail
        : "Notification goes to the verified email on the consumer's account.";
    $("solutionSentHandlerEmail").textContent = handlerEmail;
    $("solutionSentResponse").textContent = response;
    $("solutionSentResponseLabel").hidden = !response;
    $("solutionSentResponse").hidden = !response;

    showToast(result.audioError
      ? "Text solution saved, but the voice recording could not be uploaded."
      : "Solution saved. The complaint status has been updated.");

    if (!result.audioError) clearSolutionAudio();

    showPage("solution-sent");

  }

  catch (error) {

    console.error(error);

    showToast(
      "Could not save the solution"
      + (error && (error.code || error.message)
        ? " (" + (error.code || error.message) + ")."
        : ". Check your login and connection.")
    );

  } finally {
    sendButton.disabled = false;
    sendButton.textContent = originalLabel;
  }

}


/* =====================================================
   TAKE ACTION CONTENT
   ===================================================== */


const actionContent = {

  en: {

    title: "Take Action",

    intro:
      "General guidance for reporting suspected corruption and following a complaint.",

    cards: [

      [
        "1",
        "Record the facts",
        "Write what happened, when and where it happened, and which service or office was involved. Keep the description factual."
      ],

      [
        "2",
        "Keep supporting material",
        "If you already have lawful supporting documents, receipts, messages or photographs, keep them safely. Do not put yourself in danger to obtain evidence."
      ],

      [
        "3",
        "Submit the complaint",
        "Use the Consumer Portal and sign in with Google or Apple. Describe the issue clearly. A unique Query ID is generated after submission."
      ],

      [
        "4",
        "Track the case",
        "Sign in with the same Google or Apple account on Track Complaint. Enter the Query ID or view your complaint list."
      ],

      [
        "5",
        "Read the officer response",
        "When a service handler posts a response, it appears in the complaint record."
      ],

      [
        "6",
        "Escalate when appropriate",
        "If a case requires higher-level review, the service handler can record an escalation. Actual escalation rules depend on the responsible authority."
      ]

    ],

    notice:
      "Safety note: Use lawful channels and provide truthful information. Do not confront, threaten, bribe, or put yourself at risk. This demo does not send real SMS messages or create an official government complaint."

  },


  hi: {

    title:
      "कार्रवाई करें",

    intro:
      "भ्रष्टाचार की आशंका होने पर शिकायत दर्ज करने और शिकायत की स्थिति देखने के लिए सामान्य मार्गदर्शन।",

    cards: [

      [
        "1",
        "तथ्य लिखें",
        "क्या हुआ, कब और कहाँ हुआ तथा कौन-सी सेवा या कार्यालय संबंधित था—इसे तथ्यात्मक रूप से लिखें।"
      ],

      [
        "2",
        "सहायक सामग्री सुरक्षित रखें",
        "यदि आपके पास वैध दस्तावेज, रसीद, संदेश या फोटो पहले से हैं, तो उन्हें सुरक्षित रखें। सबूत जुटाने के लिए खुद को खतरे में न डालें।"
      ],

      [
        "3",
        "शिकायत जमा करें",
        "Consumer Portal का उपयोग करें और Google या Apple से साइन इन करें। समस्या स्पष्ट रूप से लिखें। जमा करने के बाद एक अलग Query ID बनती है।"
      ],

      [
        "4",
        "शिकायत ट्रैक करें",
        "Track Complaint में उसी Google या Apple खाते से साइन इन करें। Query ID डालें या अपनी शिकायतों की सूची देखें।"
      ],

      [
        "5",
        "अधिकारी का उत्तर देखें",
        "Service Handler द्वारा उत्तर देने पर वह शिकायत रिकॉर्ड में दिखाई देता है।"
      ],

      [
        "6",
        "जरूरत होने पर आगे भेजें",
        "यदि उच्च स्तर की समीक्षा चाहिए तो Service Handler escalation दर्ज कर सकता है। वास्तविक नियम संबंधित प्राधिकरण पर निर्भर करते हैं।"
      ]

    ],

    notice:
      "सुरक्षा नोट: कानूनी माध्यमों का उपयोग करें और सही जानकारी दें। किसी व्यक्ति को धमकी या रिश्वत न दें और खुद को जोखिम में न डालें। यह डेमो वास्तविक SMS या सरकारी शिकायत दर्ज नहीं करता।"

  },


  bn: {

    title:
      "পদক্ষেপ নিন",

    intro:
      "দুর্নীতির সন্দেহ হলে অভিযোগ করা এবং অভিযোগের অবস্থা অনুসরণ করার সাধারণ নির্দেশনা।",

    cards: [

      [
        "১",
        "তথ্য লিখুন",
        "কি ঘটেছে, কখন ও কোথায় ঘটেছে এবং কোন পরিষেবা বা দপ্তর জড়িত ছিল—তথ্যভিত্তিকভাবে লিখুন।"
      ],

      [
        "২",
        "সহায়ক তথ্য নিরাপদে রাখুন",
        "আপনার কাছে আগে থেকেই থাকা বৈধ নথি, রসিদ, বার্তা বা ছবি নিরাপদে রাখুন। প্রমাণ সংগ্রহ করতে নিজেকে ঝুঁকিতে ফেলবেন না।"
      ],

      [
        "৩",
        "অভিযোগ জমা দিন",
        "Consumer Portal ব্যবহার করুন এবং Google বা Apple দিয়ে সাইন ইন করুন। সমস্যাটি পরিষ্কারভাবে লিখুন। জমা দেওয়ার পর একটি আলাদা Query ID তৈরি হবে।"
      ],

      [
        "৪",
        "অভিযোগ ট্র্যাক করুন",
        "Track Complaint-এ একই Google বা Apple অ্যাকাউন্ট দিয়ে সাইন ইন করুন। Query ID লিখুন বা নিজের অভিযোগের তালিকা দেখুন।"
      ],

      [
        "৫",
        "কর্মকর্তার উত্তর দেখুন",
        "Service Handler উত্তর দিলে তা অভিযোগের রেকর্ডে দেখা যাবে।"
      ],

      [
        "৬",
        "প্রয়োজনে উচ্চ পর্যায়ে পাঠান",
        "উচ্চ পর্যায়ের পর্যালোচনা দরকার হলে Service Handler escalation নথিভুক্ত করতে পারেন। বাস্তব নিয়ম সংশ্লিষ্ট কর্তৃপক্ষের উপর নির্ভর করে।"
      ]

    ],

    notice:
      "নিরাপত্তা নোট: আইনসম্মত মাধ্যম ব্যবহার করুন এবং সত্য তথ্য দিন। কাউকে হুমকি বা ঘুষ দেবেন না এবং নিজেকে ঝুঁকিতে ফেলবেন না। এই ডেমো বাস্তব SMS বা সরকারি অভিযোগ পাঠায় না।"

  }

};


/* =====================================================
   LANGUAGE
   ===================================================== */


function setLanguage(language) {

  localStorage.setItem(
    "actionLanguage",
    language
  );


  renderActions();

}

const interfaceLanguageToSpeechLocale = {
  as: "as-IN",
  bn: "bn-IN",
  gu: "gu-IN",
  hi: "hi-IN",
  kn: "kn-IN",
  ks: "ks-IN",
  kok: "kok-IN",
  mai: "mai-IN",
  ml: "ml-IN",
  mni: "mni-IN",
  mr: "mr-IN",
  ne: "ne-IN",
  or: "or-IN",
  pa: "pa-IN",
  sa: "sa-IN",
  sat: "sat-IN",
  sd: "sd-IN",
  ta: "ta-IN",
  te: "te-IN",
  ur: "ur-IN"
};
let interfaceCopy = [];
let appliedInterfaceLanguage = "en";
let interfaceTranslationBusy = false;

function captureInterfaceCopy() {
  const excludedSelectors = [
    "script", "style", "noscript", "textarea", "input",
    ".speech-language", "#interfaceLanguageSelect",
    "#trackResult", "#complaintsTable", "#historyTable",
    "#solutionDetails", "#toast"
  ].join(",");
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    const source = node.nodeValue || "";
    if (
      parent
      && source.trim()
      && !parent.closest(excludedSelectors)
    ) {
      interfaceCopy.push({ kind: "text", target: node, source });
    }
    node = walker.nextNode();
  }

  document.querySelectorAll(
    "input[placeholder], input[title], textarea[placeholder], button[title]"
  )
    .forEach(element => {
      for (const attribute of ["placeholder", "title"]) {
        const source = element.getAttribute(attribute);
        if (source) interfaceCopy.push({ kind: attribute, target: element, source });
      }
    });

  const generatedInterfaceText = [
    "No complaint found for this account and filter.",
    "No complaints yet.",
    "No complaints",
    "Issue:",
    "Submitted:",
    "Location:",
    "Village / Town:",
    "State:",
    "Details:",
    "Audio complaint:",
    "Attached video:",
    "Document:",
    "Officer Response:",
    "Your complaint is under review. The service officer will reply soon.",
    "Service handler contact:",
    "Voice response:",
    "Last updated:",
    "Consumer audio complaint:",
    "Previous voice response:",
    "Photo evidence",
    "Image uploaded by the consumer"
  ];
  generatedInterfaceText.forEach(source =>
    interfaceCopy.push({ kind: "catalog", target: null, source })
  );
}

function interfaceCopyFingerprint() {
  const source = interfaceCopy.map(item => item.source).join("\u001f");
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function applyInterfaceTranslations(translations) {
  interfaceTextTranslations = new Map();
  const decoder = document.createElement("textarea");
  interfaceCopy.forEach((item, index) => {
    const encodedTranslation = translations[index];
    if (typeof encodedTranslation !== "string") return;
    decoder.innerHTML = encodedTranslation;
    const translated = decoder.value;
    interfaceTextTranslations.set(item.source.trim(), translated);
    if (item.kind === "text") {
      const leading = item.source.match(/^\s*/)[0];
      const trailing = item.source.match(/\s*$/)[0];
      item.target.nodeValue = leading + translated + trailing;
    } else if (item.target) {
      item.target.setAttribute(item.kind, translated);
    }
  });
}

function uiText(text) {
  return interfaceTextTranslations.get(text) || text;
}

function setSpeechLocaleForInterface(language) {
  const locale = interfaceLanguageToSpeechLocale[language];
  if (!locale) return;
  for (const id of speechLocaleIds) {
    const select = $(id);
    if (select && Array.from(select.options).some(option => option.value === locale)) {
      select.value = locale;
      localStorage.setItem("portalSpeechLanguage", locale);
    }
  }
}

async function changeInterfaceLanguage(language) {
  const status = $("languageStatus");
  const selector = $("interfaceLanguageSelect");
  const fingerprint = interfaceCopyFingerprint();
  if (language === "en") {
    applyInterfaceTranslations(interfaceCopy.map(item => item.source));
    document.documentElement.lang = "en";
    document.documentElement.dir = "ltr";
    localStorage.setItem("portalInterfaceLanguage", "en");
    appliedInterfaceLanguage = "en";
    status.textContent = "Interface language: English.";
    return;
  }
  if (!window.fb || !fb.translateInterface) {
    status.textContent = "Translation is connecting. Please try again shortly.";
    return;
  }

  selector.disabled = true;
  interfaceTranslationBusy = true;
  status.textContent = "Translating interface labels. Complaint and response text stays unchanged.";
  const cacheKey = `portalInterface-${language}-${fingerprint}`;
  try {
    let translations = null;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) translations = JSON.parse(cached);
    } catch (error) {
      console.warn("Could not read cached interface translations.", error);
    }
    if (!Array.isArray(translations) || translations.length !== interfaceCopy.length) {
      translations = [];
      for (let offset = 0; offset < interfaceCopy.length; offset += 80) {
        const batch = interfaceCopy.slice(offset, offset + 80);
        const translated = await fb.translateInterface(
          language,
          batch.map(item => item.source.trim())
        );
        translations.push(...translated);
      }
      try {
        localStorage.setItem(cacheKey, JSON.stringify(translations));
      } catch (error) {
        console.warn("Could not cache interface translations.", error);
      }
    }
    applyInterfaceTranslations(translations);
    document.documentElement.lang = language;
    document.documentElement.dir = language === "ur" ? "rtl" : "ltr";
    setSpeechLocaleForInterface(language);
    localStorage.setItem("portalInterfaceLanguage", language);
    appliedInterfaceLanguage = language;
    status.textContent = "Interface translated. Machine translation may need human review; complaint and response text was not sent.";
  } catch (error) {
    console.error("Could not translate the interface.", error);
    applyInterfaceTranslations(interfaceCopy.map(item => item.source));
    selector.value = "en";
    document.documentElement.lang = "en";
    document.documentElement.dir = "ltr";
    appliedInterfaceLanguage = "en";
    status.textContent = "Translation failed. English is shown; check Translation API setup and try again.";
    showToast(
      "Could not translate the interface"
      + (error && error.code ? " (" + error.code + ")." : ". Check Firebase Translation API setup.")
    );
  } finally {
    selector.disabled = false;
    interfaceTranslationBusy = false;
  }
}

const interfaceLanguageSelect = $("interfaceLanguageSelect");
interfaceLanguageSelect.addEventListener("change", event =>
  changeInterfaceLanguage(event.target.value)
);

const savedInterfaceLanguage =
  localStorage.getItem("portalInterfaceLanguage") || "en";
if (Array.from(interfaceLanguageSelect.options).some(option =>
  option.value === savedInterfaceLanguage && !option.disabled
)) {
  interfaceLanguageSelect.value = savedInterfaceLanguage;
}


/* =====================================================
   RENDER ACTIONS
   ===================================================== */


function renderActions() {

  const language =
    localStorage.getItem(
      "actionLanguage"
    ) || "en";


  const data =
    actionContent[language] ||
    actionContent.en;


  $("actionTitle")
    .textContent =
      data.title;


  $("actionIntro")
    .textContent =
      data.intro;


  $("actionCards")
    .innerHTML =

      data.cards.map(
        card => `

          <article class="action-card">

            <div class="action-number">

              ${escapeHTML(
                card[0]
              )}

            </div>


            <div>

              <h3>

                ${escapeHTML(
                  card[1]
                )}

              </h3>


              <p>

                ${escapeHTML(
                  card[2]
                )}

              </p>

            </div>

          </article>

        `
      ).join("");


  $("actionNotice")
    .textContent =
      data.notice;

}


/* =====================================================
   SECURITY HELPERS
   ===================================================== */


function escapeHTML(value) {

  return String(value)
    .replace(
      /[&<>"']/g,
      function (character) {

        return {

          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#039;"

        }[character];

      }
    );

}


function escapeJS(value) {

  return String(value)
    .replace(
      /\\/g,
      "\\\\"
    )
    .replace(
      /'/g,
      "\\'"
    );

}


/* =====================================================
   START WEBSITE
   ===================================================== */


renderActions();

showPage("home");
captureInterfaceCopy();
if (savedInterfaceLanguage !== "en" && !interfaceLanguageSelect.options[interfaceLanguageSelect.selectedIndex].disabled) {
  changeInterfaceLanguage(savedInterfaceLanguage);
}