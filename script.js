/* =====================================================
   ANTI CORRUPTION PORTAL
   ===================================================== */


const STORAGE_KEY = "antiCorruptionComplaints";

let complaints =
  JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");

let currentComplaint = null;

let captchaAnswer = null;


/* =====================================================
   BASIC FUNCTIONS
   ===================================================== */


function $(id) {
  return document.getElementById(id);
}


function saveComplaints() {

  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(complaints)
  );

}


/* =====================================================
   PAGE NAVIGATION
   ===================================================== */


function showPage(id) {

  document
    .querySelectorAll(".page")
    .forEach(page => {

      page.classList.remove("active");

    });


  const page = $(id);

  if (!page) return;


  page.classList.add("active");


  if (id === "dashboard") {

    renderDashboard();

  }


  if (id === "give-solution") {

    populateSolutionSelect();

  }


  if (id === "take-action") {

    renderActions();

  }


  if (id === "handler-login") {

    generateCaptcha();

  }


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

  }, 3000);

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


/* =====================================================
   QUERY ID
   ===================================================== */


function generateQueryId() {

  const year =
    new Date().getFullYear();


  let id;


  do {

    id =
      "AC-" +
      year +
      "-" +
      Math.floor(
        100000 +
        Math.random() * 900000
      );

  }

  while (
    complaints.some(
      complaint => complaint.id === id
    )
  );


  return id;

}


/* =====================================================
   CONSUMER COMPLAINT
   ===================================================== */


$("complaintForm").addEventListener(
  "submit",
  function (event) {

    event.preventDefault();


    const mobile =
      $("mobile").value.trim();


    if (!/^\d{10}$/.test(mobile)) {

      showToast(
        "Enter a valid 10-digit mobile number."
      );

      $("mobile").focus();

      return;

    }


    const complaint = {

      id: generateQueryId(),

      mobile: mobile,

      name:
        $("name").value.trim() ||
        "Anonymous",

      location:
        $("location").value.trim(),

      issue:
        $("issue").value,

      details:
        $("details").value.trim(),

      imageName:
        $("image").files[0]?.name || "",

      documentName:
        $("document").files[0]?.name || "",

      status: "Pending",

      response: "",

      created:
        new Date().toLocaleString(),

      updated:
        new Date().toLocaleString()

    };


    complaints.unshift(
      complaint
    );


    saveComplaints();


    currentComplaint =
      complaint;


    $("submittedId").textContent =
      "Query ID: " +
      complaint.id;


    this.reset();


    $("charCount").textContent =
      "0/1000";


    showPage("submitted");

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
   ===================================================== */


function trackComplaint() {

  const mobile =
    $("trackMobile")
      .value
      .trim();


  const queryId =
    $("trackQueryId")
      .value
      .trim()
      .toUpperCase();


  if (
    mobile &&
    !/^\d{10}$/.test(mobile)
  ) {

    showToast(
      "Enter a valid 10-digit mobile number."
    );

    return;

  }


  if (!mobile && !queryId) {

    showToast(
      "Enter your mobile number or Query ID."
    );

    return;

  }


  let list =
    complaints;


  if (mobile) {

    list =
      list.filter(
        complaint =>
          complaint.mobile === mobile
      );

  }


  if (queryId) {

    list =
      list.filter(
        complaint =>
          complaint.id === queryId
      );

  }


  if (!list.length) {

    $("trackResult").innerHTML = `

      <div class="panel">

        <p>
          No complaint found.
          Check your mobile number
          and Query ID.
        </p>

      </div>

    `;

    return;

  }


  $("trackResult").innerHTML =

    list.map(complaint => `

      <div class="panel complaint-result">

        <h2>

          ${escapeHTML(complaint.id)}

          <span class="status ${escapeHTML(
            complaint.status
          )}">

            ${escapeHTML(
              complaint.status
            )}

          </span>

        </h2>


        <p>

          <b>Issue:</b>

          ${escapeHTML(
            complaint.issue
          )}

        </p>


        <p>

          <b>Submitted:</b>

          ${escapeHTML(
            complaint.created
          )}

        </p>


        <p>

          ${escapeHTML(
            complaint.details
          )}

        </p>


        ${
          complaint.location

          ? `

            <p>

              <b>Location:</b>

              ${escapeHTML(
                complaint.location
              )}

            </p>

          `

          : ""

        }


        ${
          complaint.imageName

          ? `

            <p class="muted">

              Image attached:

              ${escapeHTML(
                complaint.imageName
              )}

            </p>

          `

          : ""

        }


        ${
          complaint.documentName

          ? `

            <p class="muted">

              Document attached:

              ${escapeHTML(
                complaint.documentName
              )}

            </p>

          `

          : ""

        }


        <div class="notice">

          ${
            complaint.response

            ? `

              <b>
                Officer Response:
              </b>

              ${escapeHTML(
                complaint.response
              )}

            `

            : `

              ⏳ Your complaint is
              under review.

              The service officer
              will reply soon.

            `

          }

        </div>


        <p class="muted">

          📱 Mobile notification:

          ${
            complaint.response

            ? "Solution/status notification prepared for "

            : "Status notification prepared for "

          }

          ${maskMobile(
            complaint.mobile
          )}

        </p>


        <p class="muted">

          <b>
            Last updated:
          </b>

          ${escapeHTML(
            complaint.updated
          )}

        </p>

      </div>

    `).join("");

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
   CAPTCHA
   ===================================================== */


function generateCaptcha() {

  const a =
    Math.floor(
      Math.random() * 9
    ) + 1;


  const b =
    Math.floor(
      Math.random() * 9
    ) + 1;


  captchaAnswer =
    a + b;


  $("captchaQuestion")
    .textContent =
      `${a} + ${b} = ?`;


  $("captchaAnswer")
    .value = "";

}


/* =====================================================
   SERVICE HANDLER LOGIN
   ===================================================== */


$("loginForm").addEventListener(
  "submit",
  function (event) {

    event.preventDefault();


    const username =
      $("username")
        .value
        .trim();


    const password =
      $("password")
        .value;


    const answer =
      Number(
        $("captchaAnswer").value
      );


    /*
      DEMO LOGIN

      Username:
      officer

      Password:
      1234

      IMPORTANT:
      For a real website these credentials
      must NOT be stored in JavaScript.
    */


    if (

      username === "officer" &&

      password === "1234" &&

      answer === captchaAnswer

    ) {

      sessionStorage.setItem(
        "handlerLoggedIn",
        "true"
      );


      showPage("dashboard");


      showToast(
        "Service handler login successful."
      );

    }

    else {

      showToast(
        "Invalid credentials or CAPTCHA."
      );


      generateCaptcha();

    }

  }
);


/* =====================================================
   LOGOUT
   ===================================================== */


function logout() {

  sessionStorage.removeItem(
    "handlerLoggedIn"
  );


  showPage("home");


  showToast(
    "Logged out successfully."
  );

}


/* =====================================================
   DASHBOARD
   ===================================================== */


function renderDashboard() {

  const total =
    complaints.length;


  const valid =
    complaints.filter(
      complaint =>
        complaint.status !== "Rejected"
    ).length;


  const pending =
    complaints.filter(
      complaint =>
        complaint.status === "Pending" ||
        complaint.status === "Under Review"
    ).length;


  const resolved =
    complaints.filter(
      complaint =>
        complaint.status === "Resolved"
    ).length;


  $("totalStat").textContent =
    total;


  $("validStat").textContent =
    valid;


  $("pendingStat").textContent =
    pending;


  $("resolvedStat").textContent =
    resolved;


  $("complaintsTable").innerHTML =

    complaints.map(
      complaint => `

        <tr>

          <td>
            ${escapeHTML(
              complaint.id
            )}
          </td>

          <td>
            ${escapeHTML(
              complaint.name
            )}
          </td>

          <td>
            ${escapeHTML(
              complaint.issue
            )}
          </td>

          <td>

            <span
              class="status ${escapeHTML(
                complaint.status
              )}">

              ${escapeHTML(
                complaint.status
              )}

            </span>

          </td>

          <td>

            <button
              class="secondary"
              onclick="openComplaint('${escapeJS(
                complaint.id
              )}')">

              View

            </button>

          </td>

        </tr>

      `
    ).join("");


  if (!complaints.length) {

    $("complaintsTable").innerHTML = `

      <tr>

        <td colspan="5">

          No complaints yet.

        </td>

      </tr>

    `;

  }

}


/* =====================================================
   OPEN COMPLAINT
   ===================================================== */


function openComplaint(id) {

  const complaint =
    complaints.find(
      item =>
        item.id === id
    );


  if (!complaint) return;


  currentComplaint =
    complaint;


  showPage(
    "give-solution"
  );


  $("solutionComplaint")
    .value =
      complaint.id;


  $("solutionText")
    .value =
      complaint.response || "";


  $("solutionStatus")
    .value =
      complaint.status === "Resolved"

        ? "Resolved"

        : complaint.status === "Rejected"

        ? "Rejected"

        : "Under Review";

}


/* =====================================================
   SOLUTION SELECT
   ===================================================== */


function populateSolutionSelect() {

  $("solutionComplaint")
    .innerHTML =

      complaints.map(
        complaint => `

          <option
            value="${escapeHTML(
              complaint.id
            )}">

            ${escapeHTML(
              complaint.id
            )}

            —

            ${escapeHTML(
              complaint.name
            )}

            —

            ${escapeHTML(
              complaint.issue
            )}

          </option>

        `
      ).join("");


  if (!complaints.length) {

    $("solutionComplaint")
      .innerHTML =

      `<option value="">
        No complaints
      </option>`;

    return;

  }


  if (currentComplaint) {

    $("solutionComplaint")
      .value =
        currentComplaint.id;

  }

}


/* =====================================================
   SOLUTION SELECT CHANGE
   ===================================================== */


$("solutionComplaint")
  .addEventListener(
    "change",
    function () {

      const complaint =
        complaints.find(
          item =>
            item.id === this.value
        );


      if (!complaint) return;


      $("solutionText")
        .value =
          complaint.response || "";


      $("solutionStatus")
        .value =
          complaint.status === "Resolved"

            ? "Resolved"

            : complaint.status === "Rejected"

            ? "Rejected"

            : "Under Review";

    }
  );


/* =====================================================
   SEND SOLUTION
   ===================================================== */


function sendSolution() {

  const id =
    $("solutionComplaint")
      .value;


  const complaint =
    complaints.find(
      item =>
        item.id === id
    );


  if (!complaint) {

    showToast(
      "No complaint selected."
    );

    return;

  }


  const response =
    $("solutionText")
      .value
      .trim();


  if (!response) {

    showToast(
      "Write a response first."
    );

    return;

  }


  complaint.response =
    response;


  complaint.status =
    $("solutionStatus")
      .value;


  complaint.updated =
    new Date()
      .toLocaleString();


  /*
    Notification preview.

    Real SMS requires a backend.
  */


  complaint.notification = {

    type: "SMS preview",

    preparedAt:
      new Date()
        .toLocaleString(),

    mobile:
      complaint.mobile

  };


  saveComplaints();


  showToast(
    "Solution recorded. Consumer notification updated."
  );


  showPage(
    "dashboard"
  );

}


/* =====================================================
   VALID COMPLAINT FILTER
   ===================================================== */


function filterComplaints(status) {

  if (status !== "Valid")
    return;


  const valid =
    complaints.filter(
      complaint =>
        complaint.status !== "Rejected"
    );


  $("complaintsTable")
    .innerHTML =

      valid.map(
        complaint => `

          <tr>

            <td>
              ${escapeHTML(
                complaint.id
              )}
            </td>

            <td>
              ${escapeHTML(
                complaint.name
              )}
            </td>

            <td>
              ${escapeHTML(
                complaint.issue
              )}
            </td>

            <td>

              <span class="status ${
                escapeHTML(
                  complaint.status
                )
              }">

                ${escapeHTML(
                  complaint.status
                )}

              </span>

            </td>

            <td>

              <button
                class="secondary"
                onclick="openComplaint('${escapeJS(
                  complaint.id
                )}')">

                View

              </button>

            </td>

          </tr>

        `
      ).join("");


  showToast(
    "Showing valid complaints."
  );

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