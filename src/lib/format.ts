// All user-facing timestamps render in IST (Asia/Kolkata, no DST), regardless
// of where the server runs (Vercel is UTC).
const IST_FMT = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

export function fmt(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return `${IST_FMT.format(date)} IST`;
}

/** UTC instant -> "YYYY-MM-DDTHH:MM" wall-clock in the given offset,
 *  for pre-filling a <input type="datetime-local"> on the edit form. */
export function toLocalInput(d: string | Date, offsetHours: number): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const shifted = new Date(date.getTime() + offsetHours * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${shifted.getUTCFullYear()}-${p(shifted.getUTCMonth() + 1)}-${p(shifted.getUTCDate())}` +
    `T${p(shifted.getUTCHours())}:${p(shifted.getUTCMinutes())}`
  );
}
