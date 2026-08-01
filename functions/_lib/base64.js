// UTF-8-safe base64 helpers.
//
// Workers give us atob/btoa, but those only speak latin1 — passing a note that
// contains ₹, an en-dash or a curly quote straight to btoa throws. So text
// always goes through TextEncoder/TextDecoder first.
const enc = new TextEncoder();
const dec = new TextDecoder();

export function bytesToBase64(bytes) {
  let bin = '';
  // Chunked: String.fromCharCode(...arr) blows the argument limit on big files.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function base64ToBytes(b64) {
  // GitHub's Contents API returns base64 wrapped in newlines; atob rejects them.
  const bin = atob(b64.replace(/\s/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const utf8ToBase64 = (s) => bytesToBase64(enc.encode(s));
export const base64ToUtf8 = (b64) => dec.decode(base64ToBytes(b64));

const toUrl = (b64) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
// base64url drops the padding; atob wants it back.
const fromUrl = (s) => {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  return t + '='.repeat((4 - (t.length % 4)) % 4);
};

export const utf8ToBase64Url = (s) => toUrl(utf8ToBase64(s));
export const base64UrlToUtf8 = (s) => base64ToUtf8(fromUrl(s));
export const bytesToBase64Url = (b) => toUrl(bytesToBase64(b));
export const base64UrlToBytes = (s) => base64ToBytes(fromUrl(s));
