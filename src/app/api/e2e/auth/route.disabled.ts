import { NextResponse } from "next/server";

function notFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function POST() {
  return notFound();
}

export async function DELETE() {
  return notFound();
}
