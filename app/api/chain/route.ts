import { NextResponse } from "next/server";
import { chainFacts } from "@/lib/chainFacts";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await chainFacts(), { headers: { "Cache-Control": "no-store" } });
}
