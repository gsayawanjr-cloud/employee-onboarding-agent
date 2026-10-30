// Approved policy documents: every Google Doc, .md or .txt file in one Drive folder.
// Adapted from Invoice processing/src/trigger/invoices/lib/drive.ts.
import { getToken } from "./table.js";

export type PolicyDoc = { name: string; text: string; link: string };

const DRIVE = "https://www.googleapis.com/drive/v3/files";
/** Keeps the prompt (and its cost) bounded if someone drops a huge file in the folder. */
const MAX_CHARS_PER_DOC = 40_000;

export async function loadPolicyDocs(): Promise<PolicyDoc[]> {
  const folderId = process.env.POLICY_DRIVE_FOLDER_ID?.trim();
  if (!folderId) throw new Error("POLICY_DRIVE_FOLDER_ID is not set");
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set");
  const token = await getToken(serviceAccountJson);
  const auth = { headers: { Authorization: `Bearer ${token}` } };

  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false`,
    fields: "files(id,name,mimeType,webViewLink)",
    pageSize: "100",
    orderBy: "name",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const list = await fetch(`${DRIVE}?${params}`, auth);
  if (!list.ok) throw new Error(`Google Drive API ${list.status}: ${await list.text()}`);
  const files = ((await list.json()) as { files?: { id: string; name: string; mimeType: string; webViewLink?: string }[] }).files ?? [];

  const docs: PolicyDoc[] = [];
  for (const f of files) {
    const isDoc = f.mimeType === "application/vnd.google-apps.document";
    const isText = f.mimeType.startsWith("text/") || /\.(md|txt)$/i.test(f.name);
    if (!isDoc && !isText) continue;
    const url = isDoc ? `${DRIVE}/${f.id}/export?mimeType=text/plain` : `${DRIVE}/${f.id}?alt=media&supportsAllDrives=true`;
    const response = await fetch(url, auth);
    if (!response.ok) throw new Error(`Could not read policy doc "${f.name}": ${response.status}`);
    docs.push({ name: f.name.replace(/\.(md|txt)$/i, ""), text: (await response.text()).slice(0, MAX_CHARS_PER_DOC), link: f.webViewLink ?? `https://drive.google.com/file/d/${f.id}/view` });
  }
  return docs;
}
