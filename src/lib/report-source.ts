// Where the product-feedback campaign gets its users from.
//
//   feed — live from olum-backend's /auth/outreach/users (the same feed
//          activity outreach reads): who signed up, what they ran, which
//          landing page they came in through, which sections they opened.
//   xlsx — the Olum users report, uploaded by hand (the old way; still works).
//
// Both produce the same ReportUser rows, so segmentation, exclusions and the
// per-segment letters behave identically.

import { parseUsersReport, userFromFeed, type ReportParseResult, type ReportUser } from "./report";
import { fetchFeed } from "./activity";
import { getActivityConfig, getInternalDomains, getTeamEmailHints } from "./env";

export type ReportSource = "feed" | "xlsx";

export function feedConfigured(): boolean {
  const cfg = getActivityConfig();
  return Boolean(cfg.feedUrl && cfg.feedKey);
}

export async function loadReportUsers(source: ReportSource, file: File | null): Promise<ReportParseResult> {
  const exclude = { internalDomains: getInternalDomains(), teamHints: getTeamEmailHints() };

  if (source === "xlsx") {
    if (!file || file.size === 0) throw new Error("No file provided.");
    return parseUsersReport(await file.arrayBuffer(), exclude);
  }

  const cfg = getActivityConfig();
  if (!cfg.feedUrl || !cfg.feedKey) {
    throw new Error("The live users feed isn't configured — set OLUM_FEED_URL and OLUM_FEED_KEY.");
  }
  const feed = await fetchFeed(cfg);
  const seen = new Set<string>();
  const users: ReportUser[] = [];
  let duplicates = 0;
  let skipped = 0;
  for (const f of feed) {
    const u = userFromFeed(f, exclude);
    if (u.excluded === "no_email") {
      skipped++;
      continue;
    }
    if (seen.has(u.email)) {
      duplicates++;
      continue;
    }
    seen.add(u.email);
    users.push(u);
  }
  return { users, sheetName: "Live users feed", sheets: [], duplicates, skipped };
}
