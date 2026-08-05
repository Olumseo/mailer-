import { NextRequest, NextResponse } from "next/server";
import { listSheets } from "@/lib/excel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Reads an uploaded .xlsx and returns its sheet names + valid-row counts so the
// campaign form can ask which sheet(s) to use. Gated by the access-cookie
// middleware like the rest of the app.
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file || file.size === 0) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  try {
    const sheets = await listSheets(await file.arrayBuffer());
    return NextResponse.json({ sheets });
  } catch (e) {
    return NextResponse.json(
      { error: `Couldn't read workbook: ${(e as Error).message}` },
      { status: 400 }
    );
  }
}
