# Firebase and SMS setup

The website is a static HTML/CSS/JavaScript app. Firebase provides phone OTP
authentication, complaint history (Cloud Firestore), and private evidence
uploads (Cloud Storage). A Firebase Cloud Function uses Twilio to text the
handler's response to the complainant.

The app currently accepts 10-digit Indian mobile numbers and adds `+91` when
requesting an OTP or sending an SMS.

## Current project status

- Firebase project `anti-corruption-portal-genz` is connected in `firebase.js`,
  and its web app is registered.
- Phone sign-in is enabled, `pasma45.github.io` is an authorised domain, and
  the SMS policy allows India.
- Firebase currently limits this project to 10 sent SMS messages per day
  without billing. Firebase Authentication displays this quota in its
  Sign-in method settings; add billing only if a higher SMS quota is needed.
- The standard Cloud Firestore default database exists in Delhi
  (`asia-south2`) in Native mode. It is currently on the free tier.
- Firestore security rules are deployed. Cloud Storage is not set up because
  the project needs a billing account to enable it; evidence uploads will not
  work until Storage is set up and its rules are deployed.
- The Twilio SMS function has not been deployed. The local website changes
  are published to GitHub Pages at
  `https://pasma45.github.io/anticorruption_GEN-Z-/`.

## 1. Create and configure Firebase

1. Open [Firebase Console](https://console.firebase.google.com/) and select
   `anti-corruption-portal-genz`. The default Firestore database is already
   created in `asia-south2`.
2. Phone sign-in, the `pasma45.github.io` authorised domain, and India SMS
   region policy are already configured. Add `localhost` to authorised
   domains only if testing on a local development server. For development, use
   Firebase's fictional test phone numbers instead of sending repeated real
   SMS messages.
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

5. Register each authorised handler in **Firestore Database**. Create a
   collection named `handlers`, then a document whose ID is the handler's
   10-digit mobile number, for example `9876543210`. Add the boolean field
   `active` with value `true`. Do not add public write access to this
   collection; the deployed rules intentionally deny client-side changes.

## 2. Configure actual response SMS

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

3. Deploy the SMS function:

   ```powershell
   firebase deploy --only functions
   ```

The function sends a text only when a complaint's response is added or changed.
It includes the Query ID, status, and response. Check **Firebase → Functions**
logs and Twilio message logs if a text is not delivered. Firebase phone OTP
messages and Twilio response messages are separate services.

## 3. Run and publish the site

Serve the project over HTTP while developing (ES modules do not work when the
HTML file is opened directly):

```powershell
python -m http.server 8000
```

Open `http://localhost:8000`, verify OTP and complaint submission, and add
`localhost` to Firebase's authorised domains. After deployment, GitHub Pages
must serve `index.html`, `script.js`, and `firebase.js` from the same
publication root. Never use Firebase test/open rules on a live site.

## Data and access

- Authenticated complainants can create complaints using only their verified
  mobile number and read their own complaint records.
- Only phone-authenticated numbers with an active `handlers/{mobile}` record
  can see the handler dashboard, all complaints, and uploaded evidence or
  post a response.
- Evidence files are limited to 5 MB. Firestore and Storage rules are in
  `firestore.rules` and `storage.rules`.
- The client stores Firebase's download URLs with complaint records so the
  handler can display evidence. Treat those URLs as private: anyone who gets a
  download URL may be able to access that file.
- This portal is not an official government reporting service. Do not submit
  sensitive or emergency information here.
