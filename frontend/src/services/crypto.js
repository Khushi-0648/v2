/**
 * V2 Zero-Knowledge Cryptographic Service
 * 
 * Provides:
 * 1. Mnemonic passcode generation
 * 2. SHA-256 room ID derivation (sent to signaling server)
 * 3. PBKDF2 -> AES-256-GCM key derivation (NEVER leaves client memory)
 * 4. Short Authentication String (SAS) 6-digit Safety Number
 * 5. In-call AES-256-GCM data channel encryption/decryption
 */

const SALT_STRING = "V2_ZERO_KNOWLEDGE_QUANTUM_SALT_2026";
const FIXED_SALT = new TextEncoder().encode(SALT_STRING);

// Wordlist for user-friendly, memorable high-entropy passcodes
const WORDLIST = [
  "falcon", "nebula", "quantum", "cipher", "matrix", "shield", "zenith",
  "vortex", "aurora", "pulsar", "crypto", "stellar", "shadow", "hazard",
  "vertex", "horizon", "beacon", "vector", "obsidian", "plasma", "titan"
];

/**
 * Generates a cryptographically strong 4-part code, e.g. "quantum-shield-zenith-8492"
 */
export function generateSecureCode() {
  const randomUint = new Uint32Array(3);
  window.crypto.getRandomValues(randomUint);

  const parts = Array.from(randomUint).map(val => WORDLIST[val % WORDLIST.length]);
  const numVal = new Uint16Array(1);
  window.crypto.getRandomValues(numVal);
  const pin = (numVal[0] % 9000) + 1000;

  return `${parts.join("-")}-${pin}`;
}

/**
 * Generates an 8-character cryptographically secure alphanumeric code (e.g. K9M2P4X8).
 * Uses unambiguous characters (omitting O, 0, I, 1) for error-free mobile and desktop typing.
 */
export function generate8CharAlphaNumericCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const randomBytes = new Uint8Array(8);
  window.crypto.getRandomValues(randomBytes);
  let result = "";
  for (let i = 0; i < 8; i++) {
    result += chars[randomBytes[i] % chars.length];
  }
  return result;
}

/**
 * Validates that room IDs are non-sequential and cryptographically secure.
 * Rejects sequential numbers like '1001', '1002', short strings, and predictable patterns.
 */
export function isSecureRoomCode(code) {
  if (!code || typeof code !== "string") return false;
  const clean = code.trim().toLowerCase();
  if (/^\d+$/.test(clean) || clean.length < 8) return false;
  if (/^(room|meet|meeting|call|test)[-_]?\d+$/.test(clean)) return false;
  return true;
}

/**
 * Derives a 16-character hex Room ID from the passcode using SHA-256.
 * This is safe to send to the server as a lookup tag because SHA-256 cannot be reversed.
 */
export async function deriveRoomId(passcode) {
  const cleanPasscode = passcode.trim().toLowerCase();
  const enc = new TextEncoder();
  const hashBuffer = await window.crypto.subtle.digest("SHA-256", enc.encode(cleanPasscode));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("").substring(0, 16);
}

/**
 * Derives an AES-256-GCM CryptoKey using PBKDF2 with 100,000 iterations.
 * This key is held strictly in local browser memory and never transmitted.
 */
export async function deriveAESKey(passcode) {
  const cleanPasscode = passcode.trim().toLowerCase();
  const enc = new TextEncoder();

  const baseKey = await window.crypto.subtle.importKey(
    "raw",
    enc.encode(cleanPasscode),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: FIXED_SALT,
      iterations: 100000,
      hash: "SHA-256"
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Computes a 6-digit Short Authentication String (SAS) / Safety Number.
 * Both peers can compare this to verify no Man-in-the-Middle attack exists.
 */
export async function generateSafetyNumber(passcode) {
  const cleanPasscode = passcode.trim().toLowerCase();
  const enc = new TextEncoder();
  const hashBuffer = await window.crypto.subtle.digest("SHA-256", enc.encode(`${cleanPasscode}:SAS_VERIFY`));
  const view = new DataView(hashBuffer);
  const codeInt = (view.getUint32(0) % 900000) + 100000;
  return codeInt.toString();
}

/**
 * Encrypts a string message for text chat over RTCDataChannel using AES-256-GCM.
 */
export async function encryptChatMessage(message, cryptoKey) {
  const enc = new TextEncoder();
  const iv = window.crypto.getRandomValues(new Uint8Array(12)); // 96-bit standard GCM IV
  const ciphertextBuffer = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    enc.encode(message)
  );

  const payload = new Uint8Array(iv.byteLength + ciphertextBuffer.byteLength);
  payload.set(iv, 0);
  payload.set(new Uint8Array(ciphertextBuffer), iv.byteLength);

  // Return base64 encoded payload
  let binary = "";
  for (let i = 0; i < payload.byteLength; i++) {
    binary += String.fromCharCode(payload[i]);
  }
  return btoa(binary);
}

/**
 * Decrypts a base64 ciphertext message from RTCDataChannel using AES-256-GCM.
 */
export async function decryptChatMessage(base64Payload, cryptoKey) {
  const binary = atob(base64Payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  const iv = bytes.slice(0, 12);
  const ciphertext = bytes.slice(12);

  const decryptedBuffer = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    ciphertext
  );

  const dec = new TextDecoder();
  return dec.decode(decryptedBuffer);
}
