/**
 * Secret scanner for staged (or all tracked) files.
 *
 *   npx tsx scripts/check-secrets.ts            # staged changes only
 *   npx tsx scripts/check-secrets.ts --all      # every tracked file
 *
 * Wired into .githooks/pre-commit. Exits non-zero on a hit so the commit
 * aborts. Deliberately noisy-but-few rules: it should catch a pasted DB URL
 * or app password, not lint the codebase.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

type Rule = { name: string; re: RegExp };

const RULES: Rule[] = [
  { name: "DB URL with password", re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/"']+:[^\s:@/"']+@[^\s/"']+/i },
  { name: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: "OpenAI/Anthropic key", re: /\bsk-(ant-)?[A-Za-z0-9_-]{20,}\b/ },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "Private key block", re: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: "JWT", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  // Assignment of a long literal to a secret-looking name.
  {
    name: "hardcoded secret assignment",
    re: /\b(pass|password|passwd|secret|api[_-]?key|apikey|token|client[_-]?secret)\b\s*[:=]\s*["'][^"'\s]{12,}["']/i,
  },
];

// Placeholder values that should never trip the scanner.
const ALLOW = /example|placeholder|change[-_]?me|your[-_]|dummy|<[A-Z_]+>|xxx+|\*\*\*|process\.env/i;

// Never scanned: lockfiles and build output are full of hashes.
const SKIP = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|node_modules\/|\.next\/)|\.(png|jpe?g|gif|ico|woff2?|pdf|xlsx?|map)$/i;

function git(args: string[]): string[] {
  return execFileSync("git", args, { encoding: "utf8" })
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

const all = process.argv.includes("--all");
const files = all
  ? git(["ls-files"])
  : git(["diff", "--cached", "--name-only", "--diff-filter=ACM"]);

// A committed .env is the failure mode this whole exercise is about.
const envFiles = files.filter((f) => /(^|\/)\.env($|\.)/.test(f) && !f.endsWith(".env.example"));

const findings: string[] = [];
for (const f of envFiles) findings.push(`${f}:0  env file must never be committed`);

for (const f of files) {
  if (SKIP.test(f) || envFiles.includes(f)) continue;
  let text: string;
  try {
    if (statSync(f).size > 2_000_000) continue;
    text = readFileSync(f, "utf8");
  } catch {
    continue; // deleted, or not a regular readable file
  }
  if (text.includes("\0")) continue; // binary

  text.split("\n").forEach((line, i) => {
    if (line.length > 1000 || ALLOW.test(line)) return;
    for (const r of RULES) {
      if (r.re.test(line)) {
        findings.push(`${f}:${i + 1}  ${r.name}\n    ${line.trim().slice(0, 120)}`);
        break;
      }
    }
  });
}

if (findings.length) {
  console.error(`\n✖ Possible secrets in ${all ? "tracked" : "staged"} files:\n`);
  for (const f of findings) console.error("  " + f);
  console.error(
    "\nMove the value into .env (gitignored) and read it via process.env.\n" +
      "If it's genuinely a placeholder, make that obvious (example/your-/<PLACEHOLDER>).\n" +
      "To override once: git commit --no-verify\n"
  );
  process.exit(1);
}

console.log(`✓ no secrets found in ${files.length} ${all ? "tracked" : "staged"} file(s)`);
