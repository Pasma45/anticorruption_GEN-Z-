# Firebase and SMS setup

The website is a static HTML/CSS/JavaScript app. Firebase provides Google and
Apple authentication, complaint history (Cloud Firestore), and private
evidence uploads (Cloud Storage). New complaints do not collect or store phone
numbers.

## Current project status

- Firebase project `anti-corruption-portal-genz` is connected in `firebase.js`,
  and its web app is registered.
- Complaint filing and tracking use verified Google or Apple accounts.
  Complaint forms do not ask for a phone number.
- Handler login uses verified Google or Apple accounts only. Google is
  enabled; Apple still requires Apple Developer credentials and must be
  enabled in Firebase Authentication.
- Only verified emails explicitly listed in `handlerAccounts/{email}` are
  authorised to access the handler dashboard. Consumers can sign in with any
  verified Google/Apple email.
- The standard Cloud Firestore default database exists in Delhi
  (`asia-south2`) in Native mode. It is currently on the free tier.
- Firestore security rules are deployed. Cloud Storage is not set up because
  the project needs a billing account to enable it. Complaint records are
  saved to Firestore before evidence uploads are attempted, so an unavailable
  Storage bucket will not prevent a complaint from reaching the handler inbox.
  The confirmation page reports whether each selected attachment was
  uploaded. Evidence will not appear for consumers or handlers until the
  default Storage bucket is created and its rules are deployed.
- The portal has been published to Firebase Hosting at
  `https://anti-corruption-portal-genz.web.app/`. The GitHub Pages site remains
  a separate publication target and will not update unless its repository is
  updated and published.
- GPS autofill is requested only when the complainant clicks the location
  button. Device coordinates are sent to OpenStreetMap Nominatim to look up an
  approximate village and state; raw coordinates are not saved in the complaint.
- Voice typing and read-aloud use browser speech support and the selected
  Indian language. These controls do not automatically translate typed text.
- The Twilio SMS function has not been deployed. The previous website version
  is also published to GitHub Pages at
  `https://pasma45.github.io/anticorruption_GEN-Z-/`.
- The response-email function is source code only until Firebase is on the
  Blaze plan and SMTP secrets are configured.

## 1. Create and configure Firebase

1. Open [Firebase Console](https://console.firebase.google.com/) and select
   `anti-corruption-portal-genz`. The default Firestore database is already
   created in `asia-south2`.
2. Google sign-in is enabled. Add `localhost` to authorised domains only if
   testing on a local development server.
3. In **Storage → Get started**, create the default bucket in `ASIA-SOUTH2` to
   keep uploaded evidence in the same region as Firestore. Apply the rules in
   `storage.rules`; do not use test mode on the live site. If Firebase requires
   a billing-plan upgrade, stop and obtain the project owner's approval first.
4. Install Node.js 20 and the Firebase CLI, open a terminal in this project,
   then run:

   ```powershell
   npm install --prefix functions
   firebase login
   firebase use --add
   ```

   Select `anti-corruption-portal-genz`. After Storage is created, deploy the
   database and storage rules with:

   ```powershell
   firebase deploy --only firestore:rules,storage
   ```

5. To allow Google sign-in, open **Authentication → Sign-in method**, enable
   Google, and configure the project's public-facing name and support email.
   To allow Apple sign-in, enable Apple and configure it with an Apple
   Developer Services ID, Team ID, Key ID, and private key. Add
   `https://anti-corruption-portal-genz.firebaseapp.com/__/auth/handler` as
   the Apple Services ID return URL. Apple sign-in will not work until this
   configuration is complete. Keep the Apple private key out of website files
   and source control.
6. For each approved Google/Apple officer, create a Firestore document in
   `handlerAccounts` whose document ID is the exact verified email address.
   Add an `email` field with the same verified email. Access is denied until
   this record is added. Delete the record to revoke access.
8. Successful approved Google/Apple officer sign-ins append a record to
   `securityLoginEvents` containing the provider name, Firebase UID, verified
   email, display name, and server login timestamp. These records are not
   readable from the website client; inspect them in the Firebase Console.
   Deploy the updated rules before enabling officer sign-in:

   ```powershell
   firebase deploy --only firestore:rules
   ```

## 2. Enable response email notifications

The `sendComplaintReceiptEmail` function sends a receipt when a complaint is
created. `notifyConsumerOfResponseEmail` emails the consumer when a handler
changes the response or status. Both send to the verified Google/Apple account
associated with the complaint. Email is sent server-side; no mail credentials
are exposed to the website. Firebase Functions deployment requires the Blaze
plan. Choose an SMTP provider and configure its credentials as Firebase
secrets from the project directory (do not paste credentials into source files
or chat):

```powershell
firebase functions:secrets:set SMTP_HOST
firebase functions:secrets:set SMTP_PORT
firebase functions:secrets:set SMTP_USER
firebase functions:secrets:set SMTP_PASSWORD
firebase functions:secrets:set SMTP_FROM
```

`SMTP_FROM` must be an address the SMTP provider permits you to send from.
After the secrets are configured, deploy both complaint email functions:

```powershell
firebase deploy --only functions:sendComplaintReceiptEmail,functions:notifyConsumerOfResponseEmail
```

Check **Firebase → Functions → Logs** and the SMTP provider's delivery log if
an email does not arrive. The functions record delivery state in the
server-only `emailNotifications` collection. Until a mail provider is
configured and the functions are deployed, complaints and responses remain
available in the consumer's signed-in complaint tracker, but no email is sent.

## 3. Translate the fixed interface

The top-bar language selector translates the page's fixed interface copy only.
Complaint fields, uploaded files, consumer/handler responses, tracking results,
and receipt contents are excluded and stay in their original language. The
translation function accepts bounded text batches, stores reusable
translations in a server-only Firestore cache, and keeps the Google API key in
Firebase Secret Manager.

Google Cloud Translation currently supports Bengali, Gujarati, Hindi, Kannada,
Malayalam, Marathi, Nepali, Odia (experimental), Punjabi, Tamil, Telugu, and
Urdu from the scheduled-language list. Other scheduled languages remain
available in the voice controls but are disabled for interface translation
until the provider supports them. Voice transcription/playback support still
depends on the user's device and browser. Machine translation is not legal
advice and should be reviewed by fluent speakers before publication.

1. In Google Cloud Console, enable the Cloud Translation API for the Firebase
   project. Create an API key, restrict it to the Cloud Translation API, and
   configure conservative request/character quotas and billing alerts.
2. Store the key as a Firebase secret; do not put it in `firebase.js` or the
   website:

   ```powershell
   firebase functions:secrets:set GOOGLE_TRANSLATE_API_KEY
   ```

3. Deploy the callable translation function:

   ```powershell
   firebase deploy --only functions:translateInterface
   ```

If translation is unavailable, the selector returns to English and reports
the setup problem. Firebase Authentication and Firestore remain independent
of the translation provider.

## 4. Configure legacy response SMS

1. Create a Twilio account, obtain a sender number that can text the
   complainants' country, and complete any carrier or regulatory registration
   Twilio requires. SMS fees and delivery restrictions depend on the
   destination and sender.
2. Set the three secrets from the project directory. The CLI prompts for each
   secret value; do not put credentials in website code or commit them:

   ```powershell
   firebase functions:secrets:set TWILIO_ACCOUNT_SID
   firebase functions:secrets:set TWILIO_AUTH_TOKEN
   firebase functions:secrets:set TWILIO_FROM_NUMBER
   ```

3. Deploy only the legacy SMS function (do not use `--only functions`, which
   also selects the email function and requires its SMTP secrets):

   ```powershell
   firebase deploy --only functions:notifyConsumerOfResponse
   ```

The function can send texts only for older complaint records that already
contain a valid phone number. New complaints have no phone number, so no SMS
is sent. Check **Firebase → Functions** logs and Twilio message logs for
legacy notifications.

## 5. Run and publish the site

Serve the project over HTTP while developing (ES modules do not work when the
HTML file is opened directly):

```powershell
python -m http.server 8000
```

Open `http://localhost:8000`, test Google sign-in and complaint submission,
and add `localhost` to Firebase's authorised domains. After deployment, GitHub Pages
must serve `index.html`, `script.js`, and `firebase.js` from the same
publication root. Never use Firebase test/open rules on a live site.

## Data and access

- Authenticated complainants can create complaints using Google or Apple and
  read only records owned by their Firebase account. New complaint records do
  not contain a phone number.
- Only Google/Apple accounts with verified emails explicitly listed in
  `handlerAccounts/{email}` can see the handler dashboard, all complaints, and
  uploaded evidence or post a response. Consumer Google/Apple accounts can
  read only their own complaints.
- Evidence files are limited to 5 MB. Firestore and Storage rules are in
  `firestore.rules` and `storage.rules`.
- Complaint records are stored in the existing Firebase project; uploaded
  images, videos, documents, consumer audio complaints and handler voice
  responses use its Cloud Storage bucket. Creating that bucket requires
  completing the Firebase Console setup in section 1; website code cannot
  provision a cloud bucket or billing plan.
- Speech controls list the 22 constitutionally scheduled Indian languages
  plus English. Browser speech recognition and voice playback availability
  depends on the browser and device. The fixed interface can be machine
  translated for the Google-supported subset in section 3. Complaint and
  response text, tracking data, and uploaded files are excluded and stay in
  their original language; fixed interface labels may be machine translated.
- Photo and video inputs can open the device camera on supported phones.
  Selected media can be previewed and removed before submitting. Videos,
  photos, documents, consumer audio complaints, and handler voice recordings
  are each limited to 5 MB; Cloud Storage must be configured for any evidence
  upload to succeed.
- Service handlers can record an optional audio response. The text response is
  saved independently and remains available if the audio upload fails. The
  consumer complaint tracker includes playback controls when an audio response
  has been uploaded.
- GPS autofill requires location permission and an internet connection. State
  and village/town values are editable and should be checked for accuracy.
- Complaint and handler response voice typing uses the browser's speech
  recognition. Consumers may also attach a recorded audio complaint.
  Read-aloud uses the browser's available speech voices; language availability
  depends on the device and browser.
- Complaint receipts and handler response/status updates are emailed by
  server-side functions only after the SMTP secrets and Firebase Functions
  setup above are configured and deployed.
- A submitted complaint receives a Query ID and is stored in Firestore before
  optional evidence uploads. If evidence upload fails, the complaint remains
  available to the handler and the complainant can still track it.
- Complainants can recover forgotten Query IDs by signing in with the same
  verified Google or Apple account and leaving the Query ID field blank. The
  app lists only records owned by that signed-in Firebase account; it does not
  provide public lookup by arbitrary email address.
- The client stores Firebase's download URLs with complaint records so the
  handler can display evidence. Treat those URLs as private: anyone who gets a
  download URL may be able to access that file.
- This portal is not an official government reporting service. Do not submit
  sensitive or emergency information here.
