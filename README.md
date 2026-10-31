# Gaspari Transport Contacts

An Android app for looking up Shell carrier contacts on the go and building email distribution lists, built from the **Shell Carrier Contact List** master `.xlsx`.

## Install on your phone

### iPhone (or any browser)

Open **https://histscot.github.io/Contact_Dashboard/** in Safari, tap **Share → Add to Home Screen**, then open it from the new icon and upload the contact list under **Update**. It works offline after the first visit.

### Android

1. On your Android phone, open this repo's **[Releases](../../releases/latest)** page.
2. Under **Assets**, tap `GaspariTransportContacts-1.0.N.apk` to download it.
3. Open the download. The first time, Android asks you to allow your browser to install unknown apps. Allow it, then tap **Install**.
4. Open the app, go to **Update**, and upload the contact list `.xlsx` (from Downloads, Drive, OneDrive or a saved email attachment).

Every push to `main` builds a new APK automatically (**Actions → Build Android APK**) and publishes it as a new release.

## Using the app

- **Lookup**: search by carrier name or SCAC, or tap a recent carrier. Each carrier has:
  - a big **Copy emails** button (semicolon-separated, ready to paste into Outlook) and an **Email** button
  - a **Copy** button next to every email address and a **Call** button for every phone number
  - service-type filter chips
  - a checkbox next to every email address: tick the ones you want and the big button copies **only those** (**Select all shown** works with the service-type filter, so you can tick Safety contacts, switch to Escalation and add more)
- **Distros**: build an email list in steps:
  1. **Start with** a service capability (Pack / Bulk / Both) or service types (for example Driver Check-in). The carriers this finds become your carrier base.
  2. **Then add from those same carriers**: tick more service types (for example Escalation Contact or Safety) to add those contacts at only those carriers. Untick **Keep the step 1 contacts** to get just the added ones.
  3. **Copy your list**: the pinned **Copy** bar is always on screen. Use **Choose carriers → Clear** to pick only a few carriers.
- **Update**: upload the latest `.xlsx`. The summary shows how many rows have Service Type filled in compared with the last upload, plus any carriers newly crossed out, back in, added or removed.

Highlights: yellow = driver check-in, red = safety / quality / claims, purple = bulk planning.
Crossed-out (strikethrough) carriers and contacts in the spreadsheet are left out automatically.

## Privacy

This repo is public, so **no contact data is stored in it**. The spreadsheet is read on the phone and saved only in the app's storage on that phone. `.gitignore` blocks `.xlsx`, `.xls` and `.csv` files from being committed. Use **Update → Remove contact data** to delete the data from the phone.

## Keeping updates installable (optional)

Android installs a new version over an old one only when both are signed with the same key. To keep the key the same across builds, add a repository secret named `ANDROID_DEBUG_KEYSTORE_B64`: the base64 of a `debug.keystore` with alias `androiddebugkey` and passwords `android`. Without the secret, each build is signed with a new key, so uninstall the old app before installing a new build. You'll then need to upload the spreadsheet again.

## Project layout

| Path | What it is |
|---|---|
| `www/index.html`, `www/css/app.css`, `www/js/app.js` | The app UI |
| `www/js/contacts-data.js` | `.xlsx` reader and contact-list rules (same as the desktop dashboard) |
| `assets/` | App icon and splash screen sources |
| `capacitor.config.json` | App id and name |
| `.github/workflows/android.yml` | Builds the APK and publishes the release |

To try the UI in a desktop browser, run `npx http-server www` and open the printed address.
