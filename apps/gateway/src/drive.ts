import { gget, GoogleError, gpatch, gpost } from "./google.js";

const FILES = "https://www.googleapis.com/drive/v3/files";
const FOLDER = "application/vnd.google-apps.folder";

const q = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
export const safeName = (s: string, fallback = "Untitled") =>
  s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || fallback;

/** Find or create a folder the app owns (drive.file only sees app-created files). */
export async function ensureFolder(token: string, name: string, parentId?: string): Promise<string> {
  const query = `name='${q(name)}' and mimeType='${FOLDER}' and trashed=false${parentId ? ` and '${q(parentId)}' in parents` : ""}`;
  const found = await gget<{ files?: { id: string }[] }>(token, FILES, { q: query, fields: "files(id)", pageSize: 1, spaces: "drive" });
  if (found.files?.[0]) return found.files[0].id;
  const created = await gpost<{ id: string }>(token, `${FILES}?fields=id`, {
    name,
    mimeType: FOLDER,
    ...(parentId ? { parents: [parentId] } : {}),
  });
  return created.id;
}

/** ClassroomPilot/<course>/<assignment> */
export async function ensureFolderPath(token: string, parts: string[]): Promise<string> {
  let parent: string | undefined;
  for (const p of ["ClassroomPilot", ...parts]) parent = await ensureFolder(token, safeName(p), parent);
  return parent!;
}

export async function moveToFolder(token: string, fileId: string, folderId: string) {
  const meta = await gget<{ parents?: string[] }>(token, `${FILES}/${fileId}`, { fields: "parents" });
  const u = new URL(`${FILES}/${fileId}`);
  u.searchParams.set("addParents", folderId);
  if (meta.parents?.length) u.searchParams.set("removeParents", meta.parents.join(","));
  u.searchParams.set("fields", "id");
  await gpatch(token, u.toString());
}

/** Upload a small text file (multipart). Returns id and a link to view it. */
export async function uploadText(token: string, name: string, mime: string, content: string, folderId?: string) {
  const boundary = "cp" + crypto.randomUUID().replace(/-/g, "");
  const meta = JSON.stringify({ name, mimeType: mime, ...(folderId ? { parents: [folderId] } : {}) });
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mime}; charset=UTF-8\r\n\r\n${content}\r\n--${boundary}--`;
  const url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink";
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) throw new GoogleError(res.status, await res.text(), url);
  return (await res.json()) as { id: string; webViewLink?: string };
}
