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
  the project needs a billing account to enable it; evidence uploads will not
  work until Storage is set up and its rules are deployed.
- The Twilio SMS function has not been deployed. The local website changes
  are published to GitHub Pages at
  `https://pasma45.github.io/anticorruption_GEN-Z-/`.

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

The function can send texts only for older complaint records that already
contain a valid phone number. New complaints have no phone number, so no SMS
is sent. Check **Firebase → Functions** logs and Twilio message logs for
legacy notifications.

## 3. Run and publish the site

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
- The client stores Firebase's download URLs with complaint records so the
  handler can display evidence. Treat those URLs as private: anyone who gets a
  download URL may be able to access that file.
- This portal is not an official government reporting service. Do not submit
  sensitive or emergency information here.
