export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next = "/", error } = await searchParams;
  return (
    <div className="center-page">
      <form className="card" method="post" action="/api/login">
        <h1>Olum Outreach</h1>
        <p className="sub">Internal access</p>
        <input type="hidden" name="next" value={next} />
        <label>Password</label>
        <input type="password" name="password" autoFocus />
        {error ? (
          <p className="hint" style={{ color: "var(--bad)", marginTop: 10 }}>
            Incorrect password.
          </p>
        ) : null}
        <div style={{ marginTop: 16 }}>
          <button type="submit">Enter</button>
        </div>
      </form>
    </div>
  );
}
