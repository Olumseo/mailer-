import type { ParsedRow } from "./types";

// Column headers we accept (case-insensitive, first match wins).
const NAME_KEYS = ["name", "company", "company name"];
const EMAIL_KEYS = ["emails", "email", "e-mail"];
const WEBSITE_KEYS = ["website", "url", "site"];
const PHONE_KEYS = ["phone", "phone number", "telephone"];
const SERVICE_KEYS = ["professional services", "service", "services", "category"];

// ─── Company name normalisation ──────────────────────────────────────
// Scraped directory lists put the whole SEO page title in the name column:
//   "ZMC Express Cargo | Air Shipping Company | Custom Clearance | ..."
// That string reaches the recipient verbatim through {{company}}, so reduce
// it to the name a human would actually write in a sentence.

// Separators an SEO tail hangs off. Hyphens and dashes must be space-padded
// so "Al-Futtaim" and "Trans-Gulf" survive; a colon needs trailing space so
// "24:00 Logistics" does too.
const TITLE_SEPARATOR = /\s*[|•·]\s*|\s+[-–—](?=[\s(])\s*|\s*::\s*|:\s+/;

// Navigational boilerplate that can sit *before* the real name, as in
// "Home | Acme Shipping LLC" — skip it and take the next segment.
const TITLE_BOILERPLATE =
  /^(home|homepage|welcome(\s+to)?|about(\s+us)?|contact(\s+us)?|index|official\s+(web)?site|services?|products?)$/i;

// The same boilerplate also shows up glued to the front of the real name,
// as in "Welcome to Falcon Logistics - Cargo Services".
const LEADING_BOILERPLATE = /^(welcome\s+to|home\s+of|official\s+website\s+of)\s+/i;

/** A trailing descriptor in brackets, closed or left unclosed by the scraper:
 *  "Orient Freight Solutions ( Air Cargo & Sea Freight Forwarder)". Only ever
 *  matches at the end, so "Acme (Dubai) LLC" keeps its middle bracket. */
const TRAILING_BRACKET = /\s*[([{][^)\]}]*[)\]}]?\s*$/;

// A parent-company credit tacked onto the end, which is never the name the
// recipient calls themselves: "The Abroad Campus (...)- A unit of EMBARK ...".
const PARENT_CREDIT = /\s*[-–—]?\s*\b(an?\s+(unit|division|brand|venture|initiative)\s+of)\b.*$/i;

// Industry boilerplate that trails the brand with no separator to cut on:
// "SIEC Study Abroad, Overseas Education Consultant in New Delhi". Generic
// business words plus the vertical's vocabulary; extend per vertical.
const DESCRIPTOR_WORDS = new Set(
  `study abroad overseas education educational educate consultant consultants consultancy
   consulting services service solutions immigration visa coaching classes centre center
   helpline institute institution academy career careers admission admissions counsellor
   counselor counselling ielts pte toefl gmat gre mbbs ms mba college university
   best top leading no1 official head office branch in at near for and of the
   pvt pte ltd limited llp inc llc co company corporation`
    // "global" and "international" are deliberately absent — they are part of
    // the brand far more often than not (IOA Global, Edwise International).
    .split(/\s+/)
    .filter(Boolean)
);

// Cities that appear as a trailing location with no "in" to anchor them
// ("... Helpline Mumbai Thane"). Unbounded in principle — these are the
// metros the current lead lists cover.
const LOCATION_WORDS = new Set(
  `delhi ncr gurgaon gurugram noida mumbai thane navi borivali malad santacruz vashi
   bandra andheri dadar coimbatore kovai chennai bangalore bengaluru hyderabad pune
   kolkata ahmedabad jaipur kochi cochin dubai sharjah abudhabi
   new old west east north south central nagar`
    // "india" and "uae" are absent on purpose — far more often part of the
    // brand ("Cea India", "IDP India") than a trailing location.
    .split(/\s+/)
    .filter(Boolean)
);

/** Only trim descriptors off names long enough that a brand clearly precedes
 *  them. Below this, the descriptor *is* the name ("Dream Overseas Education",
 *  "Meridean Overseas Education Consultants") and must be left whole. */
const MIN_WORDS_TO_TRIM = 5;

const isDroppable = (word: string): boolean => {
  if (/^[([{].{0,4}[)\]}][.,]?$/.test(word)) return true; // "(P)" of "(P) Ltd."
  const w = word.toLowerCase().replace(/[^a-z0-9]/g, "");
  return w === "" || DESCRIPTOR_WORDS.has(w) || LOCATION_WORDS.has(w);
};

/** Drop the trailing run of industry/location words, keeping the brand head.
 *  Deliberately gated on this segment's own length: gating on the whole raw
 *  title instead reduces "Europe Study Centre" to "Europe" and "Fly n Study
 *  Overseas" to "Fly n", because a descriptor-looking word is often part of
 *  the brand. Under-trimming is recoverable; a wrong name in a cold email
 *  is not. */
function stripTrailingDescriptors(name: string): string {
  const words = name.split(" ");
  if (words.length < MIN_WORDS_TO_TRIM) return name;
  let end = words.length;
  while (end > 1 && isDroppable(words[end - 1])) end--;
  // Everything looked generic — keep the original rather than guess.
  return end === 0 ? name : words.slice(0, end).join(" ");
}

/** SCREAMING directory entries read as shouting in a sentence. Title-case
 *  them, but leave short single words alone so acronyms (SIEC, IDP, AECC,
 *  IMFS) survive — and styled brands (upGrad, GoStudy) aren't all-caps to
 *  begin with, so they never reach here. */
function fixAllCaps(name: string): string {
  if (name !== name.toUpperCase()) return name;
  if (!name.includes(" ") && name.replace(/[^A-Z]/g, "").length < 6) return name;
  return name
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\b(And|Of|The|In|At|For)\b/g, (w) => w.toLowerCase());
}

/** The registrable label of a URL: "https://www.siecindia.com/x" -> "siecindia".
 *  Multi-part public suffixes (.co.in, .co.uk, .com.au) are handled by dropping
 *  known suffix parts from the right. */
function domainLabel(website: string): string | null {
  const host = website
    .trim()
    .replace(/^[a-z]+:\/\//i, "")
    .split(/[/?#]/)[0]
    .replace(/^www\./i, "")
    .toLowerCase();
  if (!host.includes(".")) return null;
  const parts = host.split(".").filter(Boolean);
  const SUFFIX = new Set(["com", "net", "org", "edu", "gov", "co", "in", "ae", "uk", "au", "io", "info", "biz"]);
  while (parts.length > 1 && SUFFIX.has(parts[parts.length - 1])) parts.pop();
  const label = parts[parts.length - 1];
  return label && label.length >= 3 ? label.replace(/[^a-z0-9]/g, "") : null;
}

/**
 * Use the website domain as evidence for where the brand ends.
 *
 * Walks the title's leading words, concatenating them, and keeps the longest
 * run the domain still starts with — "SIEC Study Abroad, Overseas Education
 * Consultant in New Delhi" + siecindia.com -> "SIEC". Casing comes from the
 * title, so upGrad and GeeBee keep their styling.
 *
 * Returns null unless the match is convincing, because a partial one is
 * actively harmful: "Blue Deebaj Shipping LLC" + bluedeeb.com must not become
 * "Blue". A run is convincing only when it consumes the whole label or the
 * leftover is itself boilerplate ("india" in siecindia).
 */
function shortNameFromDomain(title: string, website?: string): string | null {
  const label = website ? domainLabel(website) : null;
  if (!label) return null;

  const words = title.split(" ");
  let acc = "";
  let best: string | null = null;
  for (let i = 0; i < words.length; i++) {
    acc += words[i].toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!label.startsWith(acc)) break;
    const leftover = label.slice(acc.length);
    if (acc.length >= 3 && (leftover === "" || isDroppable(leftover))) {
      best = words.slice(0, i + 1).join(" ");
    }
  }
  return best;
}

/**
 * Reduce a scraped page title to the company name alone.
 *
 * `website` (same row) is used as corroboration for the brand boundary when
 * present — the cases word heuristics can't call are usually obvious from the
 * domain. Falls back to the (whitespace-collapsed) input if nothing survives,
 * so a name is never lost to an unexpected shape.
 */
export function cleanCompanyName(raw: string, website?: string): string {
  const flat = raw.replace(/\s+/g, " ").trim().replace(PARENT_CREDIT, "");
  const segments = flat.split(TITLE_SEPARATOR).map((s) => s.trim()).filter(Boolean);
  const chosen = segments.find((s) => !TITLE_BOILERPLATE.test(s)) ?? segments[0] ?? "";
  const base = chosen
    .replace(LEADING_BOILERPLATE, "")
    .replace(TRAILING_BRACKET, "")
    .replace(/[,;:&\-–—]+$/, "") // leftover conjunction from a cut descriptor
    .trim();
  // The domain settles the brand boundary when it can; word heuristics decide
  // the rest.
  const named = shortNameFromDomain(base, website) ?? stripTrailingDescriptors(base);
  const cleaned = fixAllCaps(named).replace(/[,;:&\-–—]+$/, "").trim();
  return cleaned || flat;
}

function pick(row: Record<string, unknown>, keys: string[]): string {
  const lowerMap = new Map<string, unknown>();
  for (const [k, v] of Object.entries(row)) lowerMap.set(k.trim().toLowerCase(), v);
  for (const key of keys) {
    const v = lowerMap.get(key);
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

/** Validate + normalise one row into a ParsedRow, or null if unusable. */
function rowToParsed(row: Record<string, unknown>): ParsedRow | null {
  const website = pick(row, WEBSITE_KEYS);
  const name = cleanCompanyName(pick(row, NAME_KEYS), website);
  let email = pick(row, EMAIL_KEYS);
  if (!name || !email) return null;

  email = email.replace(/^[,\s]+|[,\s]+$/g, "");
  if (email.includes(",")) email = email.split(",")[0].trim(); // first of a list
  if (!email.includes("@") || !email.includes(".")) return null;

  return {
    name,
    email,
    website: website || undefined,
    phone: pick(row, PHONE_KEYS) || undefined,
    service: pick(row, SERVICE_KEYS) || undefined,
  };
}

export interface ParseResult {
  rows: ParsedRow[]; // unique, valid recipients
  duplicates: number; // rows dropped because their email was already seen
  invalid: number; // rows dropped for missing/malformed name or email
  total: number; // total data rows scanned
}

/**
 * Parse the workbook, clean + dedupe by email. If `sheets` is given and
 * non-empty, only those sheets are read; otherwise all sheets are merged.
 * Also reports how many duplicate/invalid rows were dropped.
 */
export async function parseWorkbook(
  buf: ArrayBuffer,
  sheets?: string[]
): Promise<ParseResult> {
  // Loaded lazily so this CommonJS package isn't statically bundled into the
  // server-action graph (that triggers "__webpack_modules__[id] is not a function").
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { type: "array" });
  const wanted = sheets && sheets.length > 0 ? new Set(sheets) : null;

  const seen = new Set<string>();
  const out: ParsedRow[] = [];
  let duplicates = 0;
  let invalid = 0;
  let total = 0;

  for (const sheetName of wb.SheetNames) {
    if (wanted && !wanted.has(sheetName)) continue;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName]);
    for (const row of rows) {
      total++;
      const parsed = rowToParsed(row);
      if (!parsed) {
        invalid++;
        continue;
      }
      const key = parsed.email.toLowerCase();
      if (seen.has(key)) {
        duplicates++;
        continue;
      }
      seen.add(key);
      out.push(parsed);
    }
  }
  return { rows: out, duplicates, invalid, total };
}

/** List sheet names with their valid-recipient counts (for the picker UI). */
export async function listSheets(
  buf: ArrayBuffer
): Promise<Array<{ name: string; count: number }>> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { type: "array" });
  return wb.SheetNames.map((name) => {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name]);
    let count = 0;
    for (const row of rows) if (rowToParsed(row)) count++;
    return { name, count };
  });
}
