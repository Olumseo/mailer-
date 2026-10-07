import type { Sender } from "./types";
import type { InboxMessage } from "./imap";

// ─── Microsoft Graph transport (Microsoft 365 / Outlook mailboxes) ───
// Client-credentials flow: an Azure app registration with the *Application*
// permissions Mail.Send (send) and Mail.Read (reply polling), admin-consented
// in the tenant. No mailbox password — M365 has retired basic-auth SMTP, so
// this is the only supported way to drive an @olum.ai mailbox from a server.

const GRAPH = "https://graph.microsoft.com/v1.0";

/** Cached app-only tokens, keyed by tenant+client (one app may cover many
 *  mailboxes, so the cache is per credential pair, not per sender). */
const tokens = new Map<string, { value: string; expiresAt: number }>();

function assertConfigured(sender: Sender): void {
  const missing: string[] = [];
  if (!sender.email) missing.push(`SENDER_EMAIL_${sender.key}`);
  if (!sender.graphTenantId) missing.push(`GRAPH_TENANT_ID (or GRAPH_TENANT_ID_${sender.key})`);
  if (!sender.graphClientId) missing.push(`GRAPH_CLIENT_ID_${sender.key}`);
  if (!sender.graphClientSecret) missing.push(`GRAPH_CLIENT_SECRET_${sender.key}`);
  if (missing.length) {
    throw new Error(
      `Graph not configured for sender ${sender.key} — set ${missing.join(", ")}.`
    );
  }
}

async function getToken(sender: Sender): Promise<string> {
  assertConfigured(sender);
  const cacheKey = `${sender.graphTenantId}:${sender.graphClientId}`;
  const hit = tokens.get(cacheKey);
  // 60s buffer so a token can't expire mid-request.
  if (hit && Date.now() < hit.expiresAt - 60_000) return hit.value;

  const res = await fetch(
    `https://login.microsoftonline.com/${sender.graphTenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: sender.graphClientId,
        client_secret: sender.graphClientSecret,
        scope: "https://graph.microsoft.com/.default",
      }).toString(),
      signal: AbortSignal.timeout(15_000),
    }
  );

  const text = await res.text();
  if (!res.ok) {
    // AADSTS7000222 = the client secret expired; say so plainly, it's the
    // single most common failure a year after setup.
    const hint = /AADSTS7000215|AADSTS7000222/.test(text)
      ? " — the client secret is wrong or expired; issue a new one in Azure Portal → App registrations → Certificates & secrets."
      : "";
    throw new Error(`Graph token request failed (${res.status})${hint}`);
  }

  const data = JSON.parse(text) as { access_token: string; expires_in: number };
  tokens.set(cacheKey, {
    value: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  });
  return data.access_token;
}

async function graphFetch(sender: Sender, path: string, init?: RequestInit): Promise<Response> {
  const token = await getToken(sender);
  return fetch(`${GRAPH}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(25_000),
  });
}

/** Turn a Graph error body into something readable without leaking the token. */
async function graphError(res: Response, what: string, sender: Sender): Promise<Error> {
  let detail = "";
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    detail = [body.error?.code, body.error?.message].filter(Boolean).join(": ");
  } catch {
    detail = await res.text().catch(() => "");
  }
  let hint = "";
  if (res.status === 403) {
    hint =
      " — the app registration is missing admin-consented Application permission (Mail.Send / Mail.Read), or an Exchange Application Access Policy excludes this mailbox.";
  } else if (res.status === 404) {
    hint = ` — no mailbox '${sender.email}' in this tenant; check the address and that it has an Exchange licence.`;
  }
  return new Error(`Graph ${what} failed (${res.status}): ${detail.slice(0, 300)}${hint}`);
}

export interface GraphSendArgs {
  sender: Sender;
  to: string;
  subject: string;
  html: string;
  text?: string;
  headers?: Record<string, string>;
}

/** Send one message as the sender's mailbox. Graph answers 202 with no body. */
export async function sendMailGraph(args: GraphSendArgs): Promise<void> {
  const { sender } = args;
  const res = await graphFetch(
    sender,
    `/users/${encodeURIComponent(sender.email)}/sendMail`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject: args.subject,
          body: { contentType: "HTML", content: args.html },
          toRecipients: [{ emailAddress: { address: args.to } }],
          from: { emailAddress: { name: sender.displayName, address: sender.email } },
          replyTo: [{ emailAddress: { address: sender.email } }],
          // List-Unsubscribe etc. Graph rejects headers it owns, so only
          // x-prefixed and internet headers are allowed here.
          internetMessageHeaders: Object.entries(args.headers ?? {})
            .filter(([n]) => /^x-/i.test(n))
            .slice(0, 5)
            .map(([name, value]) => ({ name, value })),
        },
        saveToSentItems: true, // shows in Sent Items, like a human send
      }),
    }
  );
  if (res.status !== 202) throw await graphError(res, "sendMail", sender);
}

/** INBOX messages received after `sinceIso`, for reply detection (Mail.Read). */
export async function pollInboxGraph(
  sender: Sender,
  sinceIso: string,
  top = 25
): Promise<InboxMessage[]> {
  const query = new URLSearchParams({
    $filter: `receivedDateTime gt ${new Date(sinceIso).toISOString()}`,
    $select: "from,subject,receivedDateTime,bodyPreview",
    $orderby: "receivedDateTime desc",
    $top: String(top),
  });
  const res = await graphFetch(
    sender,
    `/users/${encodeURIComponent(sender.email)}/mailFolders/inbox/messages?${query}`
  );
  if (!res.ok) throw await graphError(res, "message list", sender);

  const data = (await res.json()) as {
    value?: Array<{
      from?: { emailAddress?: { address?: string; name?: string } };
      subject?: string;
      receivedDateTime?: string;
      bodyPreview?: string;
    }>;
  };

  return (data.value ?? []).map((m) => ({
    fromAddress: (m.from?.emailAddress?.address ?? "").toLowerCase(),
    fromName: m.from?.emailAddress?.name ?? "",
    subject: m.subject ?? "",
    receivedDateTime: m.receivedDateTime ?? new Date().toISOString(),
    preview: m.bodyPreview ?? "",
  }));
}

/** Prove the credentials work and the mailbox is reachable, without sending. */
export async function verifyGraph(sender: Sender): Promise<void> {
  const res = await graphFetch(
    sender,
    `/users/${encodeURIComponent(sender.email)}?$select=mail,userPrincipalName`
  );
  if (!res.ok) throw await graphError(res, "mailbox lookup", sender);
}
