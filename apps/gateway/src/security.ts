const enc = new TextEncoder();

const b64 = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function hmac(secret: string, data: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

/** JSON with object keys sorted, so the same arguments always hash the same. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value).sort().filter((k) => (value as any)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical((value as any)[k])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export async function sha256(text: string) {
  return b64(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

/** Stateless confirm token binding user + action + exact arguments, valid for ttl seconds. */
export async function issueConfirm(secret: string, userId: string, action: string, argsHash: string, ttl = 600) {
  const exp = Math.floor(Date.now() / 1000) + ttl;
  return `${exp}.${await hmac(secret, `${userId}|${action}|${argsHash}|${exp}`)}`;
}

export async function checkConfirm(secret: string, token: string, userId: string, action: string, argsHash: string) {
  const [exp, sig] = token.split(".");
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  return (await hmac(secret, `${userId}|${action}|${argsHash}|${exp}`)) === sig;
}
