const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const crypto = require("node:crypto");
const { defineSecret } = require("firebase-functions/params");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const {
  onDocumentCreated,
  onDocumentUpdated
} = require("firebase-functions/v2/firestore");
const nodemailer = require("nodemailer");
const twilio = require("twilio");

initializeApp();

const twilioAccountSid = defineSecret("TWILIO_ACCOUNT_SID");
const twilioAuthToken = defineSecret("TWILIO_AUTH_TOKEN");
const twilioFromNumber = defineSecret("TWILIO_FROM_NUMBER");
const smtpHost = defineSecret("SMTP_HOST");
const smtpPort = defineSecret("SMTP_PORT");
const smtpUser = defineSecret("SMTP_USER");
const smtpPassword = defineSecret("SMTP_PASSWORD");
const smtpFrom = defineSecret("SMTP_FROM");
const googleTranslateApiKey = defineSecret("GOOGLE_TRANSLATE_API_KEY");
const translationRequestsPerHour = 20;
const interfaceTranslationLanguages = new Set([
  "bn", "gu", "hi", "kn", "ml", "mr", "ne", "or", "pa", "ta", "te", "ur"
]);

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

exports.translateInterface = onCall(
  {
    secrets: [googleTranslateApiKey],
    maxInstances: 1
  },
  async request => {
    const target = request.data && request.data.target;
    const texts = request.data && request.data.texts;
    if (!interfaceTranslationLanguages.has(target)) {
      throw new HttpsError("invalid-argument", "Unsupported interface language.");
    }
    if (
      !Array.isArray(texts)
      || texts.length < 1
      || texts.length > 80
      || texts.some(text => typeof text !== "string" || !text.trim() || text.length > 500)
      || texts.reduce((total, text) => total + text.length, 0) > 16000
    ) {
      throw new HttpsError("invalid-argument", "The interface text batch is invalid.");
    }

    const cacheKey = crypto
      .createHash("sha256")
      .update(`${target}\n${JSON.stringify(texts)}`)
      .digest("hex");
    const db = getFirestore();
    const cacheRef = db.collection("uiTranslationCache").doc(cacheKey);
    const cached = await cacheRef.get();
    if (cached.exists) return { translations: cached.data().translations };

    const clientIp = request.rawRequest.ip;
    if (!clientIp) {
      throw new HttpsError("failed-precondition", "Could not apply translation request limits.");
    }
    const rateLimitId = crypto
      .createHash("sha256")
      .update(`${googleTranslateApiKey.value()}:${clientIp}`)
      .digest("hex");
    const rateLimitRef = db.collection("uiTranslationRateLimits").doc(rateLimitId);
    const now = Date.now();
    const allowed = await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(rateLimitRef);
      const previous = snapshot.exists ? snapshot.data() : {};
      const previousStart = Number(previous.windowStart || now);
      const previousCount = Number(previous.count || 0);
      const withinWindow = now - previousStart < 60 * 60 * 1000;
      const count = withinWindow ? previousCount : 0;
      if (count >= translationRequestsPerHour) return false;
      transaction.set(rateLimitRef, {
        windowStart: withinWindow ? previousStart : now,
        count: count + 1
      });
      return true;
    });
    if (!allowed) {
      throw new HttpsError("resource-exhausted", "Translation request limit reached. Try again later.");
    }

    const endpoint = new URL("https://translation.googleapis.com/language/translate/v2");
    endpoint.searchParams.set("key", googleTranslateApiKey.value());
    let response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: texts, target, format: "text" })
      });
    } catch (error) {
      console.error("Could not reach Google Cloud Translation.", error);
      throw new HttpsError("unavailable", "The translation service could not be reached.");
    }
    if (!response.ok) {
      console.error("Google Cloud Translation returned HTTP", response.status);
      throw new HttpsError("unavailable", "Google Cloud Translation could not translate the interface.");
    }
    const payload = await response.json();
    const translations = payload.data && payload.data.translations;
    if (
      !Array.isArray(translations)
      || translations.length !== texts.length
      || translations.some(item => typeof item.translatedText !== "string")
    ) {
      throw new HttpsError("internal", "The translation service returned an invalid response.");
    }

    const translatedTexts = translations.map(item => item.translatedText);
    await cacheRef.set({
      target,
      translations: translatedTexts,
      createdAt: new Date()
    });
    return { translations: translatedTexts };
  }
);

async function sendComplaintEmail(complaint, complaintId, notificationId, subject, heading) {
  const db = getFirestore();
  const notificationRef = db.collection("emailNotifications").doc(notificationId);
  const claimed = await db.runTransaction(async transaction => {
    const notification = await transaction.get(notificationRef);
    if (notification.exists && notification.data().status === "sent") return false;
    transaction.set(notificationRef, {
      status: "sending",
      complaintId,
      updatedAt: new Date()
    });
    return true;
  });
  if (!claimed) return;

  try {
    const recipient = await getAuth().getUser(complaint.ownerUid);
    if (!recipient.email || !recipient.emailVerified) {
      throw new Error("Complaint owner has no verified email address.");
    }
    const port = Number(smtpPort.value());
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("SMTP_PORT must be a valid port number.");
    }
    const transporter = nodemailer.createTransport({
      host: smtpHost.value(),
      port,
      secure: port === 465,
      auth: {
        user: smtpUser.value(),
        pass: smtpPassword.value()
      }
    });
    const status = String(complaint.status || "Pending");
    const issue = String(complaint.issue || "Complaint");
    const details = String(complaint.details || "");
    const response = String(complaint.response || "");
    const handlerEmail = String(complaint.handlerEmail || "");
    const location = [
      complaint.locationVillage,
      complaint.locationState,
      complaint.location
    ].filter(Boolean).join(", ");
    const text = [
      heading,
      `Query ID: ${complaintId}`,
      `Status: ${status}`,
      `Issue: ${issue}`,
      ...(location ? [`Location: ${location}`] : []),
      ...(details ? ["", "Complaint details:", details] : []),
      ...(response ? ["", "Service handler response:", response] : []),
      ...(handlerEmail ? ["", `Service handler contact: ${handlerEmail}`] : []),
      "",
      "Build a Better Tomorrow — report safely and keep your Query ID.",
      "https://anti-corruption-portal-genz.web.app/"
    ].join("\n");
    await transporter.sendMail({
      from: smtpFrom.value(),
      to: recipient.email,
      subject,
      text,
      html: `<div style="max-width:640px;margin:auto;font-family:Arial,sans-serif;color:#17395e">
        <header style="padding:24px;background:#08284b;color:#fff;border-radius:12px 12px 0 0">
          <div style="font-size:28px">🛡️ <strong>ANTI CORRUPTION</strong></div>
          <div style="color:#c8e3ff;margin-top:6px">Build a Better Tomorrow</div>
        </header>
        <main style="padding:24px;border:1px solid #dce7f1;border-top:0;border-radius:0 0 12px 12px">
          <h2>${escapeHtml(heading)}</h2>
          <p><b>Query ID:</b> ${escapeHtml(complaintId)}</p>
          <p><b>Status:</b> ${escapeHtml(status)}</p>
          <p><b>Issue:</b> ${escapeHtml(issue)}</p>
          ${location ? `<p><b>Location:</b> ${escapeHtml(location)}</p>` : ""}
          ${details ? `<p><b>Complaint details:</b><br>${escapeHtml(details).replace(/\n/g, "<br>")}</p>` : ""}
          ${response ? `<section style="padding:16px;background:#edf7ff;border-radius:8px"><b>Service handler response:</b><br>${escapeHtml(response).replace(/\n/g, "<br>")}</section>` : ""}
          ${handlerEmail ? `<p><b>Service handler contact:</b> <a href="mailto:${escapeHtml(handlerEmail)}">${escapeHtml(handlerEmail)}</a></p>` : ""}
          <p style="margin-top:24px"><a href="https://anti-corruption-portal-genz.web.app/">Sign in to track your complaint</a></p>
          <p style="color:#647991;font-size:12px">Use lawful channels, provide truthful information, and keep your Query ID safe.</p>
        </main>
      </div>`
    });
    await notificationRef.set({
      status: "sent",
      complaintId,
      recipient: recipient.email,
      updatedAt: new Date()
    });
  } catch (error) {
    console.error(`Could not send ${heading.toLowerCase()} email.`, error);
    try {
      await notificationRef.set({
        status: "failed",
        complaintId,
        error: String(error.message || error).slice(0, 500),
        updatedAt: new Date()
      });
    } catch (recordError) {
      console.error("Could not record the email notification failure.", recordError);
    }
    throw error;
  }
}

exports.sendComplaintReceiptEmail = onDocumentCreated(
  {
    document: "complaints/{complaintId}",
    secrets: [smtpHost, smtpPort, smtpUser, smtpPassword, smtpFrom],
    retry: true
  },
  async event => {
    const complaint = event.data.data();
    await sendComplaintEmail(
      complaint,
      event.params.complaintId,
      `receipt_${event.id}`,
      `Complaint receipt ${event.params.complaintId}: ${complaint.status || "Pending"}`,
      "Your complaint has been received"
    );
  }
);

exports.notifyConsumerOfResponseEmail = onDocumentUpdated(
  {
    document: "complaints/{complaintId}",
    secrets: [smtpHost, smtpPort, smtpUser, smtpPassword, smtpFrom],
    retry: true
  },
  async event => {
    const before = event.data.before.data();
    const after = event.data.after.data();
    if (
      after.response === before.response
      && after.status === before.status
    ) return;
    await sendComplaintEmail(
      after,
      event.params.complaintId,
      `update_${event.id}`,
      `Complaint update ${event.params.complaintId}: ${after.status || "Updated"}`,
      after.response
        ? "Your complaint has a service handler response"
        : "Your complaint status has been updated"
    );
  }
);

exports.notifyConsumerOfResponse = onDocumentUpdated(
  {
    document: "complaints/{complaintId}",
    secrets: [twilioAccountSid, twilioAuthToken, twilioFromNumber],
    retry: true
  },
  async event => {
    const before = event.data.before.data();
    const after = event.data.after.data();
    if (!after.response || after.response === before.response) return;

    const mobile = String(after.mobile || "");
    if (!/^\d{10}$/.test(mobile)) return;

    const db = getFirestore();
    const notificationRef = db.collection("smsNotifications").doc(event.id);
    const claimed = await db.runTransaction(async transaction => {
      const notification = await transaction.get(notificationRef);
      if (notification.exists && notification.data().status === "sent") return false;
      transaction.set(notificationRef, {
        status: "sending",
        complaintId: event.params.complaintId,
        updatedAt: new Date()
      });
      return true;
    });
    if (!claimed) return;

    try {
      const client = twilio(
        twilioAccountSid.value(),
        twilioAuthToken.value()
      );
      const message = [
        `Complaint ${event.params.complaintId} update: ${after.status}.`,
        `Service handler response: ${after.response}`
      ].join(" ");
      await client.messages.create({
        body: message,
        from: twilioFromNumber.value(),
        to: `+91${mobile}`
      });
      await notificationRef.set({
        status: "sent",
        complaintId: event.params.complaintId,
        updatedAt: new Date()
      });
    } catch (error) {
      await notificationRef.set({
        status: "failed",
        complaintId: event.params.complaintId,
        error: String(error.message || error).slice(0, 500),
        updatedAt: new Date()
      });
      throw error;
    }
  }
);
