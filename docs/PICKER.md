# Enabling the file picker (PDF / Word reading)

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
