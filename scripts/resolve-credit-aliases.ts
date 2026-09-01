import { readFileSync, writeFileSync } from "node:fs";
import OpenAI from "openai";

type Audit = { report: { composer: { missing: string[]; contexts: Record<string, string[]> } } };
type Resolution = {
  inputName: string;
  canonicalName: string | null;
  confidence: number;
  rationale: string;
};

function firstJson(text: string): Audit {
  const marker = text.indexOf("\nnpm notice");
  return JSON.parse(marker > 0 ? text.slice(0, marker) : text);
}

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["inputName", "canonicalName", "confidence", "rationale"],
        properties: {
          inputName: { type: "string" },
          canonicalName: { type: ["string", "null"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          rationale: { type: "string", maxLength: 240 },
        },
      },
    },
  },
} as const;

async function main(): Promise<void> {
  const inputPath = process.argv[2] ?? "/app/data/credit-representatives-2.json";
  const outputPath = process.argv[3] ?? "/app/data/credit-alias-resolutions.json";
  const audit = firstJson(readFileSync(inputPath, "utf8"));
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_LUNA_MODEL ?? "gpt-5.6-luna";
  const source = audit.report.composer.missing.map((inputName) => ({
    inputName,
    contexts: audit.report.composer.contexts[inputName] ?? [],
  }));
  const resolved: Resolution[] = [];

  for (let offset = 0; offset < source.length; offset += 20) {
    const batch = source.slice(offset, offset + 20);
    const response = await client.responses.create({
      model,
      reasoning: { effort: "low" },
      store: false,
      input: [
        {
          role: "system",
          content: "Resolve composer-credit identities using the supplied album context. Expand initials, surnames, legal names, and stage names only when evidence is strong. Return the best canonical public name for finding a portrait. Use null when ambiguous. Do not invent people or catalog facts.",
        },
        { role: "user", content: JSON.stringify(batch) },
      ],
      text: { format: { type: "json_schema", name: "credit_aliases", strict: true, schema } },
    });
    const parsed = JSON.parse(response.output_text) as { items: Resolution[] };
    resolved.push(...parsed.items);
    writeFileSync(outputPath, JSON.stringify({ model, resolved }, null, 2));
    console.error(`resolved ${Math.min(offset + batch.length, source.length)}/${source.length}`);
  }

  console.log(JSON.stringify({ model, resolved }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
