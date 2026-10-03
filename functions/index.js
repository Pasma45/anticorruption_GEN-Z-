const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { defineSecret } = require("firebase-functions/params");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const twilio = require("twilio");

initializeApp();

const twilioAccountSid = defineSecret("TWILIO_ACCOUNT_SID");
const twilioAuthToken = defineSecret("TWILIO_AUTH_TOKEN");
const twilioFromNumber = defineSecret("TWILIO_FROM_NUMBER");

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
    if (!/^\d{10}$/.test(mobile)) {
      throw new Error(`Complaint ${event.params.complaintId} has an invalid mobile number.`);
    }

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
