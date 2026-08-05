import { cleanCompanyName } from "../src/lib/excel";

// Scraped directory lists carry the full SEO page title in the name column,
// and that string reaches the recipient through {{company}}. This pins the
// reduction to a usable company name — and, just as importantly, pins the
// names that must survive it untouched.
//   npx tsx scripts/company-name-selftest.ts

const CASES: Array<[input: string, expected: string, website?: string]> = [
  // ── the website domain settles what word heuristics can't ──
  ["SIEC Study Abroad, Overseas Education Consultant in New Delhi", "SIEC", "https://www.siecindia.com/"],
  ["upGrad Study Abroad Consultants - Mumbai", "upGrad", "https://www.upgrad.com/"],
  ["upGrad Study Abroad Consultant Helpline Mumbai Thane", "upGrad", "https://www.upgrad.com/"],
  ["Cea India Overseas Education | Pte | Ielts Coaching", "Cea India", "https://ceaindia.com"],
  ["IMFS Study Abroad- K.P. Singh Education Services Pvt. Ltd.", "IMFS", "http://imfs.co.in/"],
  ["ZMC Express Cargo | Air Shipping Company | Custom Clearance", "ZMC Express", "https://www.zmcexpress.com/"],
  ["Europe Study Centre | Study Abroad Consultants", "Europe Study Centre", "https://europestudycentre.com"],
  // Refuses a partial match rather than truncating a real brand:
  ["Blue Deebaj Shipping LLC", "Blue Deebaj Shipping LLC", "https://bluedeeb.com/"],
  // Unrelated domain -> ignored, heuristics stand:
  ["Orient Freight Solutions ( Air Cargo & Sea Freight)", "Orient Freight Solutions", "https://ofsae.com/"],


  // ── the real rows this was built for ──
  [
    "Orient Freight Solutions ( Air Cargo & Sea Freight Forwarder & Customs Clearance)",
    "Orient Freight Solutions",
  ],
  [
    "Blue Deebaj Shipping LLC - Customs Clearing Agent | Air Freight, Sea Freight & Land Freight Forwarder",
    "Blue Deebaj Shipping LLC",
  ],
  [
    "ZMC Express Cargo | Air Shipping Company | Cargo Company | Custom Clearance | Freight Forwarder",
    "ZMC Express Cargo",
  ],

  // ── other title shapes ──
  ["Al Sharqi Shipping – Freight Forwarder in Dubai", "Al Sharqi Shipping"],
  ["Gulf Cargo :: Sea & Air Freight", "Gulf Cargo"],
  ["Home | Acme Shipping LLC", "Acme Shipping LLC"],
  ["Welcome to Falcon Logistics - Cargo Services", "Falcon Logistics"],
  ["Emirates Freight: Customs Clearance Experts", "Emirates Freight"],
  ["Nova Cargo • Air Freight • Sea Freight", "Nova Cargo"],
  ["Star Shipping (Dubai", "Star Shipping"], // scraper left the bracket unclosed
  ["  Spaced   Out   Logistics  \n LLC ", "Spaced Out Logistics LLC"],

  // ── industry boilerplate with no separator to cut on ──
  ["SIEC Study Abroad, Overseas Education Consultant in New Delhi", "SIEC"],
  ["AECC Study Abroad Consultants in Coimbatore", "AECC"],
  ["upGrad Study Abroad Consultant Helpline Mumbai Thane", "upGrad"],
  ["Chellam Study Abroad Education Consultants STUDY MBBS ABROAD", "Chellam"],
  ["Infos Connect Study Abroad Delhi- Overseas Education Consultant", "Infos Connect"],
  ["Santamonica Study Abroad Pvt. Ltd", "Santamonica"],
  ["Gauranga Study Abroad Consultants (P) Ltd. -(Gauranga Consultancy) MBBS Abroad", "Gauranga"],
  [
    "The Abroad Campus (Center for Foreign Education)- A unit of EMBARK OVERSEAS EDUCATION PRIVATE LIMITED",
    "The Abroad Campus",
  ],
  ["ACCURATE EDUCATION", "Accurate Education"], // stop shouting…
  ["SIEC", "SIEC"], // …but acronyms are not shouting
  ["IDP Education - Study Abroad Consultants in Delhi", "IDP Education"],

  // ── must NOT be over-trimmed: the descriptor IS the brand ──
  ["Europe Study Centre | Study Abroad Consultants | Abroad Education Consultants Delhi NCR", "Europe Study Centre"],
  ["Fly n Study Overseas | Study Abroad Consultants in Coimbatore", "Fly n Study Overseas"],
  ["The Edu Overseas | Best Switzerland Study Abroad Consultants", "The Edu Overseas"],
  ["Dream Overseas Education", "Dream Overseas Education"],
  ["Meridean Overseas Education Consultants", "Meridean Overseas Education Consultants"],
  ["Cea India Overseas Education | Pte | Ielts Coaching", "Cea India Overseas Education"],
  ["IOA Global - IELTS, PTE Coaching and Study Abroad Consultants", "IOA Global"],
  ["Zest Global Education", "Zest Global Education"],

  // ── must NOT be mangled ──
  ["Al-Futtaim Logistics", "Al-Futtaim Logistics"], // unpadded hyphen is part of the name
  ["Trans-Gulf Shipping Co", "Trans-Gulf Shipping Co"],
  ["Acme (Dubai) LLC", "Acme (Dubai) LLC"], // bracket isn't trailing
  ["Blue Deebaj Shipping LLC", "Blue Deebaj Shipping LLC"], // already clean
  ["24:00 Logistics", "24:00 Logistics"], // colon with no trailing space
  ["Home", "Home"], // boilerplate-only: better than returning nothing
];

let failed = 0;
for (const [input, expected, website] of CASES) {
  const actual = cleanCompanyName(input, website);
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(
    `  ${ok ? "ok  " : "FAIL"} ${JSON.stringify(input)}${website ? `  (${website})` : ""}` +
      `\n       -> ${JSON.stringify(actual)}` +
      (ok ? "" : `\n       expected ${JSON.stringify(expected)}`)
  );
}

console.log(
  failed === 0
    ? `\nCompany-name normalisation verified — ${CASES.length} cases.`
    : `\n${failed} of ${CASES.length} cases FAILED.`
);
process.exit(failed === 0 ? 0 : 1);
