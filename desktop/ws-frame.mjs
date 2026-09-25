import crypto from "node:crypto";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** @param {string} key */
export function acceptKey(key) {
  return crypto.createHash("sha1").update(String(key) + GUID).digest("base64");
}

/** @param {Buffer} buf */
export function decodeFrame(buf) {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let off = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    off = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    if (buf.readUInt32BE(2) !== 0) return null;
    len = buf.readUInt32BE(6);
    off = 10;
  }
  if (len > 700_000) return { opcode: 8, payload: Buffer.alloc(0), rest: buf.length };
  const maskLen = masked ? 4 : 0;
  if (buf.length < off + maskLen + len) return null;
  let payload = buf.subarray(off + maskLen, off + maskLen + len);
  if (masked) {
    const mask = buf.subarray(off, off + 4);
    const copy = Buffer.from(payload);
    for (let i = 0; i < copy.length; i += 1) copy[i] ^= mask[i & 3];
    payload = copy;
  }
  return { opcode, payload, rest: off + maskLen + len };
}

/** @param {string} text */
export function encodeFrame(text) {
  const payload = Buffer.from(text);
  const head = payload.length < 126 ? Buffer.from([0x81, payload.length]) : Buffer.concat([Buffer.from([0x81, 126]), Buffer.from([(payload.length >> 8) & 255, payload.length & 255])]);
  return Buffer.concat([head, payload]);
}
