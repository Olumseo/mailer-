// Next builds this for every runtime (node + edge, since middleware is edge).
// The node-only work (engine + Zoho SMTP/IMAP, which use Node built-ins) lives
// in instrumentation-node.ts, imported ONLY under this NEXT_RUNTIME guard so it
// is excluded from the edge bundle.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
