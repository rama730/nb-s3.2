import { NextRequest, NextResponse } from "next/server";
import { incrementProjectViewAction } from "@/app/actions/project/_all";

export async function GET(
    request: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const { id } = await props.params;
    try {
        console.log("Calling incrementProjectViewAction for ID:", id);
        const result = await incrementProjectViewAction(id);
        return NextResponse.json(result);
    } catch (e: any) {
        console.error("Test route error:", e);
        return NextResponse.json({ success: false, error: e.message, stack: e.stack }, { status: 500 });
    }
}
