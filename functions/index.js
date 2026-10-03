const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const { defineSecret } = require("firebase-functions/params");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
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

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

exports.notifyConsumerOfResponseEmail = onDocumentUpdated(
  {
    document: "complaints/{complaintId}",
    secrets: [smtpHost, smtpPort, smtpUser, smtpPassword, smtpFrom],
    retry: true
  },
  async event => {
    const before = event.data.before.data();
    const after = event.data.after.data();
    if (!after.response || after.response === before.response) return;

    const db = getFirestore();
    const notificationRef = db.collection("emailNotifications").doc(event.id);
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
      const recipient = await getAuth().getUser(after.ownerUid);
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
      const response = String(after.response);
      const status = String(after.status || "Updated");
      const complaintId = String(event.params.complaintId);
      await transporter.sendMail({
        from: smtpFrom.value(),
        to: recipient.email,
        subject: `Complaint ${complaintId}: ${status}`,
        text: [
          `There is an update to your complaint ${complaintId}.`,
          `Status: ${status}`,
          "",
          "Service handler response:",
          response,
          "",
          "Sign in to the Anti Corruption Portal to track your complaint:",
          "https://pasma45.github.io/anticorruption_GEN-Z-/"
        ].join("\n"),
        html: `<p>There is an update to your complaint <b>${escapeHtml(complaintId)}</b>.</p>
          <p><b>Status:</b> ${escapeHtml(status)}</p>
          <p><b>Service handler response:</b></p>
          <p>${escapeHtml(response).replace(/\n/g, "<br>")}</p>
          <p><a href="https://pasma45.github.io/anticorruption_GEN-Z-/">Sign in to track your complaint</a></p>`
      });
      await notificationRef.set({
        status: "sent",
        complaintId,
        recipient: recipient.email,
        updatedAt: new Date()
      });
    } catch (error) {
      console.error("Could not email the complaint response.", error);
      try {
        await notificationRef.set({
          status: "failed",
          complaintId: event.params.complaintId,
          error: String(error.message || error).slice(0, 500),
          updatedAt: new Date()
        });
      } catch (recordError) {
        console.error("Could not record the email notification failure.", recordError);
      }
      throw error;
    }
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
