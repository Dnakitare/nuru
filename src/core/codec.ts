// Byte-level codecs for the fmb1_ wire format: CRC-32 (integrity) and base64url
// (URL-safe envelope). Hand-rolled, dependency-free, cross-environment.

// ── CRC-32 (IEEE 802.3, polynomial 0xEDB88320) ───────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 of `bytes` as an unsigned 32-bit number. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ── base64url (RFC 4648 §5), no padding ──────────────────────────────────────

const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const B64URL_INV = (() => {
  const inv = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64URL.length; i++) inv[B64URL.charCodeAt(i)] = i;
  return inv;
})();

export function base64urlEncode(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += B64URL[(n >>> 18) & 63]! + B64URL[(n >>> 12) & 63]! + B64URL[(n >>> 6) & 63]! + B64URL[n & 63]!;
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i]! << 16;
    out += B64URL[(n >>> 18) & 63]! + B64URL[(n >>> 12) & 63]!;
  } else if (rem === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += B64URL[(n >>> 18) & 63]! + B64URL[(n >>> 12) & 63]! + B64URL[(n >>> 6) & 63]!;
  }
  return out;
}

export function base64urlDecode(s: string): Uint8Array {
  const len = s.length;
  if (len % 4 === 1) throw new Error("invalid base64url length");
  const outLen = Math.floor((len * 3) / 4);
  const out = new Uint8Array(outLen);
  let o = 0;
  let i = 0;
  for (; i + 3 < len; i += 4) {
    const n = (dec(s, i) << 18) | (dec(s, i + 1) << 12) | (dec(s, i + 2) << 6) | dec(s, i + 3);
    out[o++] = (n >>> 16) & 0xff;
    out[o++] = (n >>> 8) & 0xff;
    out[o++] = n & 0xff;
  }
  const rem = len - i;
  if (rem === 2) {
    const n = (dec(s, i) << 18) | (dec(s, i + 1) << 12);
    out[o++] = (n >>> 16) & 0xff;
  } else if (rem === 3) {
    const n = (dec(s, i) << 18) | (dec(s, i + 1) << 12) | (dec(s, i + 2) << 6);
    out[o++] = (n >>> 16) & 0xff;
    out[o++] = (n >>> 8) & 0xff;
  }
  return out;
}

function dec(s: string, i: number): number {
  const code = s.charCodeAt(i);
  const v = code < 128 ? B64URL_INV[code]! : -1;
  if (v < 0) throw new Error(`invalid base64url char at ${i}`);
  return v;
}
