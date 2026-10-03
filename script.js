/* =====================================================
   ANTI CORRUPTION PORTAL  (Firebase version)

   Data is stored in Firestore / Storage (see firebase.js).
   Nothing is saved in localStorage any more.
   ===================================================== */


let complaints = [];            // live list for the handler dashboard

let currentComplaint = null;

let handlerLoggedIn = false;

let stopListening = null;

let knownIds = null;            // used to announce NEW complaints

let verifiedConsumerMobile = "";


const PROTECTED_PAGES = [
  "dashboard",
  "give-solution",
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

  toast.textContent = message;

  toast.classList.add("show");


  setTimeout(() => {

    toast.classList.remove("show");

  }, 3500);

}


function otpFailureMessage(error) {

  const code = error && typeof error.code === "string"
    ? error.code
    : "";
  const detail = error && typeof error.message === "string"
    ? error.message.replace(/\s+/g, " ").slice(0, 180)
    : "";

  switch (code) {

    case "auth/unauthorized-domain":
      return "Firebase rejected this website domain. Add pasma45.github.io under Authentication > Settings > Authorised domains.";

    case "auth/quota-exceeded":
      return "Firebase's free OTP SMS limit may be reached (10 per day). Try again tomorrow or link billing to increase the limit.";

    case "auth/too-many-requests":
      return "Too many OTP attempts. Wait before trying again, or use Firebase test phone numbers during development.";

    case "auth/billing-not-enabled":
      return "Firebase requires a billing account to send more OTP messages. Check the project's SMS quota in Firebase Authentication.";

    case "auth/captcha-check-failed":
    case "auth/missing-app-credential":
    case "auth/invalid-app-credential":
      return "Firebase could not verify this browser. Reload the page and try again; check that pasma45.github.io is an authorised domain.";

    case "auth/operation-not-allowed":
      return "Phone OTP sign-in is disabled in Firebase Authentication.";

    case "auth/invalid-phone-number":
      return "Firebase rejected this phone number. Enter a valid Indian 10-digit mobile number.";

    case "auth/network-request-failed":
      return "The OTP request could not reach Firebase. Check your internet connection and try again.";

    default:
      return code
        ? `OTP request failed (${code})${detail ? `: ${detail}` : "."}`
        : `OTP request failed${detail ? `: ${detail}` : ". Check your connection and contact the site administrator if it continues."}`;

  }

}


async function handlerProviderSignIn(provider) {

  if (!window.fb) {

    showToast("Still connecting. Try again in a moment.");

    return;

  }

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


$("mobile").addEventListener("input", function () {

  verifiedConsumerMobile = "";

  $("consumerOtpBox").style.display = "none";

});


async function consumerSendOtp() {

  const mobile = $("mobile").value.trim();

  if (!/^\d{10}$/.test(mobile)) {

    showToast("Enter a valid 10-digit mobile number.");

    $("mobile").focus();

    return;

  }

  if (!window.fb) {

    showToast("Still connecting. Try again in a moment.");

    return;

  }

  try {

    await fb.sendOtp(mobile);

    $("consumerOtpBox").style.display = "flex";

    $("consumerOtp").focus();

    showToast("OTP sent to " + maskMobile(mobile));

  } catch (error) {

    console.error(error);

    showToast(otpFailureMessage(error));

  }

}


async function verifyConsumerOtp() {

  const mobile = $("mobile").value.trim();

  try {

    await fb.confirmOtp($("consumerOtp").value.trim());

    verifiedConsumerMobile = mobile;

    $("consumerOtp").value = "";

    $("consumerOtpBox").style.display = "none";

    showToast("Mobile number verified.");

  } catch (error) {

    console.error(error);

    showToast("Wrong or expired OTP.");

  }

}


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

    const mobile = $("mobile").value.trim();


    if (!/^\d{10}$/.test(mobile)) {

      showToast("Enter a valid 10-digit mobile number.");

      $("mobile").focus();

      return;

    }

    if (verifiedConsumerMobile !== mobile) {

      showToast("Verify your mobile number with the OTP before submitting.");

      return;

    }


    const imageFile = $("image").files[0];

    const docFile = $("document").files[0];


    for (const file of [imageFile, docFile]) {

      if (file && file.size > MAX_FILE_BYTES) {

        showToast("Each file must be smaller than 5 MB.");

        return;

      }

    }


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

        mobile: mobile,

        name: $("name").value.trim() || "Anonymous",

        location: $("location").value.trim(),

        issue: $("issue").value,

        details: $("details").value.trim()

      };


      await fb.createComplaint(complaint, imageFile, docFile);


      $("submittedId").textContent =
        "Query ID: " + complaint.id;

      form.reset();

      $("charCount").textContent = "0/1000";

      showPage("submitted");

    }

    catch (error) {

      console.error(error);

      showToast("Could not submit the complaint. Please try again.");

    }

    finally {

      button.disabled = false;

      button.textContent = label;

    }

  }
);


/* =====================================================
   TRACK FROM HOME
   ===================================================== */


function trackFromHome() {

  const mobile =
    $("homeTrackMobile")
      .value
      .trim();


  $("trackMobile").value =
    mobile;


  $("trackQueryId").value =
    "";


  showPage("track");


  trackComplaint();

}


/* =====================================================
   TRACK COMPLAINT

   - With a Query ID  -> loaded directly.
   - Mobile number only -> an OTP is sent first, so nobody
     can read another person's complaints.
   ===================================================== */


function renderTrack(list) {

  if (!list.length) {

    $("trackResult").innerHTML = `
      <div class="panel">
        <p>No complaint found. Check your mobile number and Query ID.</p>
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

      <p><b>Issue:</b> ${escapeHTML(c.issue)}</p>

      <p><b>Submitted:</b> ${escapeHTML(c.created)}</p>

      <p>${escapeHTML(c.details)}</p>

      ${c.location
        ? `<p><b>Location:</b> ${escapeHTML(c.location)}</p>` : ""}

      ${safeUrl(c.imageUrl)
        ? `<p><a href="${escapeHTML(safeUrl(c.imageUrl))}"
              target="_blank" rel="noopener">
              <img class="evidence-img"
                   src="${escapeHTML(safeUrl(c.imageUrl))}"
                   alt="Attached image"></a></p>` : ""}

      ${safeUrl(c.documentUrl)
        ? `<p class="muted">Document:
              <a href="${escapeHTML(safeUrl(c.documentUrl))}"
                 target="_blank" rel="noopener">
                 ${escapeHTML(c.documentName)}</a></p>` : ""}

      <div class="notice">
        ${c.response
          ? `<b>Officer Response:</b> ${escapeHTML(c.response)}`
          : "⏳ Your complaint is under review. The service officer will reply soon."}
      </div>

      <p class="muted">
        📱 SMS updates go to ${maskMobile(c.mobile)}
      </p>

      <p class="muted">
        <b>Last updated:</b> ${escapeHTML(c.updated)}
      </p>

    </div>

  `).join("");

}


async function trackComplaint() {

  const mobile = $("trackMobile").value.trim();

  const queryId = $("trackQueryId").value.trim().toUpperCase();


  if (mobile && !/^\d{10}$/.test(mobile)) {

    showToast("Enter a valid 10-digit mobile number.");

    return;

  }


  if (!mobile && !queryId) {

    showToast("Enter your mobile number or Query ID.");

    return;

  }


  if (!window.fb) {

    showToast("Still connecting. Try again in a moment.");

    return;

  }


  try {

    if (queryId) {

      if (!mobile) {

        showToast("Enter the mobile number linked to this Query ID.");

        return;

      }


    }

    await fb.sendOtp(mobile);

    $("trackOtpBox").style.display = "flex";

    showToast("OTP sent to " + maskMobile(mobile));

  }

  catch (error) {

    console.error(error);

    showToast(otpFailureMessage(error));

  }

}


async function verifyTrackOtp() {

  try {

    await fb.confirmOtp($("trackOtp").value.trim());

    const queryId = $("trackQueryId").value.trim().toUpperCase();
    let list;

    if (queryId) {

      const complaint = await fb.getComplaint(queryId);

      list = complaint && complaint.mobile === $("trackMobile").value.trim()
        ? [complaint]
        : [];

    } else {

      list = await fb.listByMobile($("trackMobile").value.trim());

    }

    $("trackOtp").value = "";

    $("trackOtpBox").style.display = "none";

    renderTrack(list);

  }

  catch (error) {

    console.error(error);

    showToast("Wrong or expired OTP.");

  }

}


/* =====================================================
   MASK MOBILE
   ===================================================== */


function maskMobile(mobile) {

  return (
    mobile.slice(0, 2) +
    "******" +
    mobile.slice(-2)
  );

}


/* =====================================================
   SERVICE HANDLER LOGIN  (mobile number + OTP)

   Only numbers listed in the Firestore "handlers"
   collection are accepted (see firestore.rules).
   ===================================================== */


async function handlerSendOtp() {

  const mobile = $("handlerMobile").value.trim();


  if (!/^\d{10}$/.test(mobile)) {

    showToast("Enter a valid 10-digit mobile number.");

    return;

  }


  if (!window.fb) {

    showToast("Still connecting. Try again in a moment.");

    return;

  }


  try {

    await fb.sendOtp(mobile);

    $("otpBox").style.display = "flex";

    $("handlerOtp").focus();

    showToast("OTP sent to " + maskMobile(mobile));

  }

  catch (error) {

    console.error(error);

    showToast(otpFailureMessage(error));

  }

}


$("loginForm").addEventListener(
  "submit",
  async function (event) {

    event.preventDefault();

    try {

      await fb.confirmOtp($("handlerOtp").value.trim());

    }

    catch (error) {

      showToast("Wrong or expired OTP.");

      return;

    }


    if (!(await fb.isHandler())) {

      await fb.logout();

      showToast("This number is not registered as a service handler.");

      return;

    }


    $("handlerOtp").value = "";

    $("otpBox").style.display = "none";

    startHandlerSession();

    showPage("dashboard");

    showToast("Service handler login successful.");

  }
);


/* keeps the handler signed in after a page reload */

window.addEventListener("fb-auth", async function (event) {

  const user = event.detail;

  if (user && !handlerLoggedIn && await fb.isHandler()) {

    startHandlerSession();

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

    },

    function (error) {

      console.error(error);

      showToast("Could not load complaints.");

    }

  );

}


async function logout() {

  if (stopListening) stopListening();

  stopListening = null;

  handlerLoggedIn = false;

  complaints = [];

  try { await fb.logout(); } catch (error) { console.error(error); }


  showPage("home");

  showToast("Logged out successfully.");

}


/* =====================================================
   DASHBOARD
   ===================================================== */


function evidenceHTML(c) {

  const url = safeUrl(c.imageUrl);

  return url

    ? `<a href="${escapeHTML(url)}" target="_blank" rel="noopener">
         <img class="thumb" src="${escapeHTML(url)}" alt="Evidence"></a>`

    : "—";

}


function renderRows(list) {

  if (!list.length) {

    $("complaintsTable").innerHTML =
      `<tr><td colspan="6">No complaints yet.</td></tr>`;

    return;

  }


  $("complaintsTable").innerHTML = list.map(c => `

    <tr>

      <td>${escapeHTML(c.id)}</td>

      <td>${escapeHTML(c.name)}<br>
          <small>${escapeHTML(c.mobile)}</small></td>

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


  renderRows(complaints);

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

  const file = safeUrl(c.documentUrl);


  box.innerHTML = `

    <b>Mobile:</b> ${escapeHTML(c.mobile)}<br>

    <b>Location:</b> ${escapeHTML(c.location || "—")}<br>

    <b>Submitted:</b> ${escapeHTML(c.created)}<br><br>

    <b>Details:</b> ${escapeHTML(c.details)}

    ${image
      ? `<br><br><a href="${escapeHTML(image)}" target="_blank" rel="noopener">
           <img class="evidence-img" src="${escapeHTML(image)}"
                alt="Image uploaded by the consumer"></a>`
      : ""}

    ${file
      ? `<br><br>📎 <a href="${escapeHTML(file)}" target="_blank"
           rel="noopener">${escapeHTML(c.documentName)}</a>`
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
      `<option value="">No complaints</option>`;

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

    currentComplaint =
      complaints.find(item => item.id === this.value) || null;

    renderSolutionDetails(this.value);

  }
);


async function sendSolution() {

  const id = $("solutionComplaint").value;

  const response = $("solutionText").value.trim();


  if (!complaints.some(item => item.id === id)) {

    showToast("No complaint selected.");

    return;

  }


  if (!response) {

    showToast("Write a response first.");

    return;

  }


  try {

    await fb.respond(id, $("solutionStatus").value, response);

    showToast("Solution saved. An SMS notification will be attempted.");

    showPage("dashboard");

  }

  catch (error) {

    console.error(error);

    showToast("Could not save the solution. Check your login.");

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
        "Use the Consumer Portal. Enter a valid mobile number and describe the issue clearly. A unique Query ID is generated after submission."
      ],

      [
        "4",
        "Track the case",
        "Use your mobile number or Query ID on Track Complaint. The status can move through review and resolution stages."
      ],

      [
        "5",
        "Read the officer response",
        "When a service handler posts a response, it appears in the complaint record. This demo also shows a mobile/SMS notification preview."
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
        "Consumer Portal का उपयोग करें। सही मोबाइल नंबर दें और समस्या स्पष्ट रूप से लिखें। जमा करने के बाद एक अलग Query ID बनती है।"
      ],

      [
        "4",
        "शिकायत ट्रैक करें",
        "Track Complaint में मोबाइल नंबर या Query ID डालें। स्थिति समीक्षा और समाधान के चरणों में बदल सकती है।"
      ],

      [
        "5",
        "अधिकारी का उत्तर देखें",
        "Service Handler द्वारा उत्तर देने पर वह शिकायत रिकॉर्ड में दिखाई देता है। इस डेमो में मोबाइल/SMS notification preview भी दिखता है।"
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
        "Consumer Portal ব্যবহার করুন। সঠিক মোবাইল নম্বর দিন এবং সমস্যাটি পরিষ্কারভাবে লিখুন। জমা দেওয়ার পর একটি আলাদা Query ID তৈরি হবে।"
      ],

      [
        "৪",
        "অভিযোগ ট্র্যাক করুন",
        "Track Complaint-এ মোবাইল নম্বর বা Query ID দিন। অবস্থা পর্যালোচনা ও সমাধানের ধাপে পরিবর্তিত হতে পারে।"
      ],

      [
        "৫",
        "কর্মকর্তার উত্তর দেখুন",
        "Service Handler উত্তর দিলে তা অভিযোগের রেকর্ডে দেখা যাবে। এই ডেমোতে মোবাইল/SMS notification preview-ও দেখা যায়।"
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