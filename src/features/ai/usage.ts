import { db } from "@/features/db/client";

type UsageResponse = {
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  } | null;
};

export function recordAiUsage(purpose: string, model: string, response: UsageResponse): void {
  try {
    const usage = response.usage;
    db().prepare("INSERT INTO ai_usage(purpose,model,input_tokens,output_tokens,total_tokens) VALUES (?,?,?,?,?)").run(
      purpose,
      model,
      Number(usage?.input_tokens ?? 0),
      Number(usage?.output_tokens ?? 0),
      Number(usage?.total_tokens ?? 0),
    );
  } catch {
    // Usage accounting must never interrupt library processing.
  }
}
