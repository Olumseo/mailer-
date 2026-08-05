import { getSender, NOTIFY_EMAIL, NOTIFY_SENDER } from "./env";
import { sendMail } from "./smtp";
import { logEvent } from "./db";

/** Send an internal alert to NOTIFY_EMAIL (Barath) via the notify sender. */
export async function notifyTeam(
  subject: string,
  html: string,
  event?: { type: string; ref: string | null; detail?: Record<string, unknown> }
): Promise<void> {
  const sender = getSender(NOTIFY_SENDER());
  await sendMail({
    sender,
    to: NOTIFY_EMAIL(),
    subject,
    html,
  });
  if (event) await logEvent(event.type, event.ref, event.detail ?? {});
}
