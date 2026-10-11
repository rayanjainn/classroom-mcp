(() => {
  "use strict";
  const API = "https://mcp.classroom.raycode.tech";
  const MAX_CHARS = 150000;
  const $ = (id) => document.getElementById(id);
  const say = (msg, cls) => {
    const el = $("status");
    el.textContent = msg;
    el.className = cls || "";
  };
  const sid = new URLSearchParams(location.search).get("s") || "";
  let session = null;

  const loadScript = (src) =>
    new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Could not load " + src));
      document.head.appendChild(s);
    });

  async function init() {
    if (!/^[a-f0-9]{32}$/.test(sid)) return say("This link is not valid. Ask your assistant for a new one.", "err");
    let r;
    try {
      r = await fetch(`${API}/pick/${sid}`);
    } catch {
      return say("Could not reach ClassroomPilot. Check your connection and reload.", "err");
    }
    if (!r.ok) return say("This link has expired. Ask your assistant to read the file again.", "err");
    session = await r.json();
    if (!session.apiKey || !session.appId) return say("File picking is not configured on this server yet.", "err");
    if (new URLSearchParams(location.search).has("debug")) {
      const mask = (v) => (v ? v.slice(0, 6) + "\u2026" + v.slice(-4) + " (" + v.length + " chars)" : "(missing)");
      $("debug").hidden = false;
      $("debug").textContent = [
        "page origin:  " + location.origin,
        "API key:      " + mask(session.apiKey),
        "project no.:  " + (session.appId || "(missing)"),
        "OAuth client: " + mask(session.clientId),
        "expected file: " + (session.expectFileId || "(any)"),
        "referrer sent: " + (document.referrer || "(none)"),
        "user agent:   " + navigator.userAgent,
      ].join("\n");
    }
    if (new URLSearchParams(location.search).has("debug") && session.apiKey) runKeyTest();
    if (session.name) $("fname").textContent = session.name;
    $("go").disabled = false;
    say("Ready. Click the button to choose the file.");
  }

  // Calls Google from this page, so the key is checked against this exact origin and referrer.
  async function runKeyTest() {
    const out = [];
    const probe = async (label, url) => {
      try {
        const r = await fetch(url);
        const j = await r.json().catch(() => ({}));
        const reason = (j.error && (j.error.details && j.error.details[0] && j.error.details[0].reason || j.error.errors && j.error.errors[0] && j.error.errors[0].reason)) || "";
        out.push(label + ": HTTP " + r.status + " " + reason + " " + ((j.error && j.error.message) || "").slice(0, 120));
      } catch (e) {
        out.push(label + ": request failed (" + e.message + ")");
      }
      $("debug").textContent = $("debug").textContent.split("\n--- key test ---")[0] + "\n--- key test ---\n" + out.join("\n");
    };
    const k = encodeURIComponent(session.apiKey);
    await probe("Drive API files.list  ", `https://www.googleapis.com/drive/v3/files?pageSize=1&key=${k}`);
    await probe("Drive API about       ", `https://content.googleapis.com/drive/v3/about?fields=kind&key=${k}`);
    out.push("Reading the result: 'Login Required' / 401 = key accepted. API_KEY_HTTP_REFERRER_BLOCKED = website restriction does not match this page. API_KEY_SERVICE_BLOCKED = an API is missing from the key's API restrictions. API_KEY_INVALID = wrong key.");
    $("debug").textContent = $("debug").textContent.split("\n--- key test ---")[0] + "\n--- key test ---\n" + out.join("\n");
  }

  async function getToken() {
    await loadScript("https://accounts.google.com/gsi/client");
    return new Promise((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: session.clientId,
        scope: "https://www.googleapis.com/auth/drive.file",
        callback: (resp) => (resp.error ? reject(new Error(resp.error_description || resp.error)) : resolve(resp.access_token)),
        error_callback: (e) => reject(new Error(e && e.type ? "Google sign-in was cancelled or blocked (" + e.type + ")." : "Google sign-in failed.")),
      });
      client.requestAccessToken({ prompt: "" });
    });
  }

  const TYPES = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "text/markdown",
    "application/vnd.google-apps.document",
  ].join(",");

  async function pick(token) {
    await loadScript("https://apis.google.com/js/api.js");
    await new Promise((resolve) => gapi.load("picker", resolve));
    return new Promise((resolve) => {
      const mine = new google.picker.DocsView(google.picker.ViewId.DOCS).setIncludeFolders(true).setMimeTypes(TYPES);
      const shared = new google.picker.DocsView(google.picker.ViewId.DOCS).setOwnedByMe(false).setIncludeFolders(true).setMimeTypes(TYPES);
      new google.picker.PickerBuilder()
        .addView(mine)
        .addView(shared)
        .setOAuthToken(token)
        .setDeveloperKey(session.apiKey)
        .setAppId(session.appId)
        .setOrigin(location.protocol + "//" + location.host)
        .setTitle(session.name ? "Choose: " + session.name : "Choose the file")
        .setCallback((d) => {
          if (d.action === google.picker.Action.PICKED) resolve(d.docs[0]);
          else if (d.action === google.picker.Action.CANCEL) resolve(null);
        })
        .build()
        .setVisible(true);
    });
  }

  async function download(token, doc) {
    const native = doc.mimeType.indexOf("application/vnd.google-apps.") === 0;
    const url = native
      ? `https://www.googleapis.com/drive/v3/files/${doc.id}/export?mimeType=text%2Fplain`
      : `https://www.googleapis.com/drive/v3/files/${doc.id}?alt=media`;
    const r = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    if (!r.ok) throw new Error("Google Drive returned " + r.status + " when reading the file.");
    return native ? { text: await r.text() } : { buf: await r.arrayBuffer() };
  }

  async function extract(doc, data) {
    if (data.text !== undefined) return { text: data.text };
    const mime = doc.mimeType;
    if (mime === "application/pdf") {
      await loadScript("/vendor/pdf.min.js");
      pdfjsLib.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.min.js";
      const pdf = await pdfjsLib.getDocument({ data: data.buf, isEvalSupported: false }).promise;
      const pages = Math.min(pdf.numPages, 300);
      const out = [];
      for (let i = 1; i <= pages; i++) {
        say(`Reading page ${i} of ${pages}…`);
        const content = await (await pdf.getPage(i)).getTextContent();
        out.push(`--- page ${i} ---\n` + content.items.map((it) => it.str + (it.hasEOL ? "\n" : " ")).join(""));
        if (out.join("").length > MAX_CHARS) break;
      }
      return { text: out.join("\n"), pages: pdf.numPages };
    }
    if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      await loadScript("/vendor/mammoth.browser.min.js");
      const r = await mammoth.extractRawText({ arrayBuffer: data.buf });
      return { text: r.value };
    }
    if (mime.indexOf("text/") === 0) return { text: new TextDecoder().decode(data.buf) };
    throw new Error("This file type (" + mime + ") cannot be read yet. Supported: PDF, Word (.docx), text, Google Docs.");
  }

  async function run() {
    $("go").disabled = true;
    try {
      say("Signing in with Google…");
      const token = await getToken();
      say("Choose the file in the Google window…");
      const doc = await pick(token);
      if (!doc) {
        $("go").disabled = false;
        return say("Cancelled. Click the button to try again.");
      }
      say("Downloading…");
      const data = await download(token, doc);
      const ex = await extract(doc, data);
      let text = (ex.text || "").replace(/[ \t]+\n/g, "\n").trim();
      if (!text) {
        $("go").disabled = false;
        return say("No text found. This looks like a scanned or image-only file; ask your assistant to work from a typed copy instead.", "err");
      }
      const truncated = text.length > MAX_CHARS;
      if (truncated) text = text.slice(0, MAX_CHARS);
      say("Sending the text to ClassroomPilot…");
      const r = await fetch(`${API}/pick/${sid}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileId: doc.id, name: doc.name, mime: doc.mimeType, text, pages: ex.pages, truncated }),
      });
      if (!r.ok) throw new Error("ClassroomPilot rejected the upload (" + r.status + "). The link may have expired.");
      say(`Done: "${doc.name}" is ready. Go back to your assistant and ask it to read the file again.`, "ok");
      $("go").disabled = false;
    } catch (e) {
      $("go").disabled = false;
      say(e && e.message ? e.message : "Something went wrong.", "err");
    }
  }

  $("go").addEventListener("click", run);
  init();
})();
