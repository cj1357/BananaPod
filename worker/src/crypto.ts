import { Buffer } from "node:buffer";

export function decodeBase64ToUint8Array(base64: string): Uint8Array {
  const b = Buffer.from(base64, "base64");
  return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
}

export function encodeUint8ArrayToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

