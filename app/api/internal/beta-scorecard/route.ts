import { scorecardHandler } from "@/lib/beta-scorecard/delivery";
import { scorecardStore } from "@/lib/beta-scorecard/store.server";

export const runtime = "nodejs";
export const maxDuration = 45;
export const POST = scorecardHandler(scorecardStore, { env: process.env });
