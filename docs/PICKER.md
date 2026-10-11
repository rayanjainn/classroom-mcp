# Reading PDFs and Word files

`read_attachment` returns a one-time link to a small page (`/pick/`). There the student can **upload the file they downloaded from Classroom** (needs no setup and no Google sign-in) or **pick it from Google Drive** (needs the Google Cloud setup below; optional).

## Optional: Google Drive picking

Google only lets this app open Drive files that the student picks, so reading PDFs and Word files goes through a small page on `classroom.raycode.tech/pick/`. It needs three things in Google Cloud:

1. **Enable the Google Picker API** (APIs & Services > Library).
2. **Create an API key** (APIs & Services > Credentials > Create credentials > API key). Restrict it:
   - Application restriction: Websites, add `https://classroom.raycode.tech/*`
   - API restriction: Google Picker API
3. **Authorized JavaScript origins**: open your OAuth web client and add `https://classroom.raycode.tech`.
4. Note the **project number** (Cloud console > Dashboard > Project info; digits only, not the project ID).

Then put the key and project number in `apps/gateway/wrangler.toml` under `[vars]`:

```
PICKER_API_KEY = "AIza..."
GCP_PROJECT_NUMBER = "1234567890"
```

(The API key is public by design; the referrer restriction protects it.) Deploy both Workers:

```
cd apps/gateway && npx wrangler deploy
cd ../web && npx wrangler deploy
```

Until both vars are set, `read_attachment` simply reports that PDF/Word files cannot be read.

Also add `https://www.googleapis.com/auth/drive.file` to the consent screen's Data Access list if it is not there yet (it is a non-sensitive scope).

How it works: `read_attachment` returns a one-time link; the student opens it, signs in (drive.file only), picks the file; the page downloads it in the browser, extracts the text (pdf.js / mammoth, self-hosted under `/vendor`) and sends only the text to the gateway, which stores it encrypted for 30 days.

## Troubleshooting

**"There was an error! The API developer key is invalid."** (shown inside the Google window)

Open the picker link with `&debug=1` added to see the exact key (masked), project number and origin the page uses, then check, in this order:

1. **Restrictions.** In Credentials, edit the key and set Application restrictions to *None* and API restrictions to *Don't restrict key* just to test. If the picker then works, tighten them again: Websites `https://classroom.raycode.tech/*` **and** `https://classroom.raycode.tech`, APIs: Google Picker API (add Google Drive API too if it still fails). Changes can take up to 5 minutes.
2. **Same project.** The API key, the OAuth client and the project number must all belong to the *same* Google Cloud project, and the Picker API must be enabled in that project.
3. **Value in `wrangler.toml`.** No quotes or spaces inside the string, and deployed with `npx wrangler deploy` from `apps/gateway`. The `&debug=1` view shows the length of the key (39 characters for a standard key).
4. **Browser.** Brave Shields or privacy extensions can strip the referrer Google checks. Try a normal Chrome window, or lower Shields for `classroom.raycode.tech`.

**"500. That's an error. There was an error. Please try again later."** inside the Google window: Google's generic failure, most often from a Picker view that is too narrow or from signing in with a different Google account than the one that owns the Classroom. The page now offers a normal chooser (My Drive and Shared with me tabs, filtered to PDF/Word/text) and whatever file you pick becomes the content of the attachment. If it persists, try an incognito window with only the school account signed in, and note whether the 500 appears inside Google's window or on the ClassroomPilot page.

**Still "The API developer key is invalid" after fixing the API restrictions.** Open the picker link with `&debug=1`: the page now calls Google itself and prints whether the key is accepted from `https://classroom.raycode.tech`. Website restrictions must list **both** `https://classroom.raycode.tech` and `https://classroom.raycode.tech/*` (the Picker sends the bare origin, which the `/*` pattern alone does not match). Browser extensions (wallets, ad blockers) can add noise to the console but are not the cause.
