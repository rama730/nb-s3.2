import { NextResponse } from "next/server";

function notFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function POST(req: Request) {
  return notFound();
}

export async function DELETE(req: Request) {
  return notFound();
}
