/**
 * GSTIN validation (India). Pure, no dependencies, safe for client and server.
 *
 * Checks the 15-character structure, the state code and the mod-36 check digit.
 * A valid result only means the number is well formed. It does NOT prove the registration
 * exists or is active; that needs a lookup against the GST portal.
 */

const CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const STRUCTURE = /^(\d{2})([A-Z]{5}\d{4}[A-Z])([1-9A-Z])Z([0-9A-Z])$/;

/** GST state / UT codes in use (01-38, plus 97 Other Territory and 99 Centre Jurisdiction). */
const STATE_CODES = new Set([
  ...Array.from({ length: 38 }, (_, i) => String(i + 1).padStart(2, "0")),
  "97",
  "99",
]);

export const GST_STATE_NAMES: Record<string, string> = {
  "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand",
  "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim",
  "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura",
  "17": "Meghalaya", "18": "Assam", "19": "West Bengal", "20": "Jharkhand", "21": "Odisha",
  "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat", "26": "Dadra & Nagar Haveli and Daman & Diu",
  "27": "Maharashtra", "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu",
  "34": "Puducherry", "35": "Andaman & Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh",
  "38": "Ladakh", "97": "Other Territory", "99": "Centre Jurisdiction",
};

/** Check character for the first 14 characters. */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = CHARSET.indexOf(first14[i]);
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARSET[(36 - (sum % 36)) % 36];
}

export function normalizeGstin(input: string): string {
  return input.replace(/\s+/g, "").toUpperCase();
}

export type GstinResult =
  | { valid: true; gstin: string; stateCode: string; stateName: string; pan: string }
  | { valid: false; reason: string };

export function validateGstin(input: string): GstinResult {
  const gstin = normalizeGstin(input);
  if (gstin.length !== 15) return { valid: false, reason: "GSTIN must be 15 characters" };
  const m = STRUCTURE.exec(gstin);
  if (!m) return { valid: false, reason: "GSTIN format is invalid (expected e.g. 27AAPFU0939F1ZV)" };
  const [, stateCode, pan] = m;
  if (!STATE_CODES.has(stateCode)) return { valid: false, reason: `Unknown GST state code ${stateCode}` };
  if (gstinCheckChar(gstin.slice(0, 14)) !== gstin[14]) return { valid: false, reason: "GSTIN check digit does not match" };
  return { valid: true, gstin, stateCode, stateName: GST_STATE_NAMES[stateCode] ?? stateCode, pan };
}
