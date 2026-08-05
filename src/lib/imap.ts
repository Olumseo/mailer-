import type { Sender } from "./types";

// ─── Zoho IMAP reply polling (replaces Graph Mail.Read) ──────────────

export interface InboxMessage {
  fromAddress: string;
  fromName: string;
  subject: string;
  receivedDateTime: string;
  preview: string;
}

/** Fetch INBOX messages received after `sinceIso` for reply detection. */
export async function pollInbox(
  sender: Sender,
  sinceIso: string,
  top = 25
): Promise<InboxMessage[]> {
  if (!sender.email || !sender.pass) {
    throw new Error(`Zoho IMAP not configured for sender ${sender.key}`);
  }

  const { ImapFlow } = await import("imapflow");
  const client = new ImapFlow({
    host: sender.imapHost,
    port: sender.imapPort,
    secure: true,
    auth: { user: sender.user, pass: sender.pass },
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  // imapflow emits 'error' on its EventEmitter; an unhandled one crashes the
  // whole process. Swallow it — the try/catch below surfaces failures cleanly.
  client.on("error", () => {});

  const since = new Date(sinceIso);
  const out: InboxMessage[] = [];

  // Hard cap so a hung IMAP session can never freeze the cron tick.
  const guard = setTimeout(() => client.close(), 25_000);

  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uids = (await client.search({ since }, { uid: true })) || [];
      const recent = Array.isArray(uids) ? uids.slice(-top) : [];
      if (recent.length === 0) return out;

      for await (const msg of client.fetch(
        recent,
        { envelope: true, internalDate: true },
        { uid: true }
      )) {
        const env = msg.envelope;
        const from = env?.from?.[0];
        const received = msg.internalDate
          ? new Date(msg.internalDate).toISOString()
          : env?.date
            ? new Date(env.date).toISOString()
            : new Date().toISOString();
        if (new Date(received) <= since) continue; // IMAP `since` is date-granular; refine
        out.push({
          fromAddress: (from?.address ?? "").toLowerCase(),
          fromName: from?.name ?? "",
          subject: env?.subject ?? "",
          receivedDateTime: received,
          preview: "",
        });
      }
    } finally {
      lock.release();
    }
  } finally {
    clearTimeout(guard);
    await client.logout().catch(() => {});
  }

  return out;
}
