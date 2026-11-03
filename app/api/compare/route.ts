import { withAIUsage, aiResponse, aiFile, usageErrorResponse } from "@/lib/ai-usage/guard";
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@/lib/supabase/server";
import { existingActiveProfile } from "@/lib/gap-investigation/saved";
import { CompareError, readCompareInput } from "@/lib/compare/input";
import { downloadOwnedCompareResume, readOwnedCompareResume } from "@/lib/compare/resume.server";

export async function POST(req: Request) {
  try {
    const client = await createClient();
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) throw new CompareError(401, "Unauthorized");
    if (user.is_anonymous) throw new CompareError(403, "Sign in with a registered account to compare");

    const { resumeId, resumeText, jobDescriptions } = await readCompareInput(req);
    const profileId = await existingActiveProfile(client, user.id);
    if (!profileId) throw new CompareError(403, "An owned active career profile is required");

    const resume = resumeId ? await readOwnedCompareResume(client,user.id,profileId,resumeId) : null;
    return await withAIUsage({ userId:user.id, route:"compare", units:jobDescriptions.length, request:req, input:{resume,resumeText:resumeId?null:resumeText,jobDescriptions,profileId} }, async()=>{
    const file = resumeId ? await downloadOwnedCompareResume(client, user.id, profileId, resumeId) : null;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
    const resumeContentParts: Array<{ type: "input_file"; file_id: string } | { type: "input_text"; text: string }> = [];
    if (file) {
      const openaiFile = await aiFile(openai,file);
      resumeContentParts.push({ type: "input_file", file_id: openaiFile.id });
    } else if (resumeText) {
      resumeContentParts.push({
        type: "input_text",
        text: `RESUME TEXT FALLBACK:\n${resumeText}`,
      });
    }

    const results = [];

    for (const jd of jobDescriptions) {
      const response = await aiResponse(openai,{
        model: "gpt-4.1",
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: `You are CareerMind PM.

Analyze the candidate against the job description.

Return valid JSON with:
- company_name (string)
- core_verdict ("Strong Hire" | "Borderline" | "Below Bar")
- reasoning (short explanation)
- score (number from 1 to 5)

Be direct, specific, and decisive.`
              }
            ]
          },
          {
            role: "user",
            content: [
              ...resumeContentParts,
              {
                type: "input_text",
                text: `JOB DESCRIPTION:\n${jd}`
              }
            ]
          }
        ]
      },"compare");

      const text = response.output_text;

      const parsed = JSON.parse(text);
      results.push(parsed);
    }

    results.sort((a, b) => b.score - a.score);

    return NextResponse.json({ success: true, data: results });
    });
  } catch (err) {
    const limited=usageErrorResponse(err); if(limited)return limited;
    if (err instanceof CompareError) return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    console.error("COMPARE API ERROR");
    return NextResponse.json({ success: false, error: "Compare failed" }, { status: 500 });
  }
}
