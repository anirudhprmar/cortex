import { Output, generateText } from "ai";
import { ollama } from "ollama-ai-provider-v2";
import type { ZodIssue } from "zod";
import { extractionSystemPrompt, extractionUserPrompt } from "./prompt";
import {
  extractionOutputSchema,
  type ExtractedFact,
  type ExtractionOutput,
} from "./schema";

export type ExtractionSuccess = {
  ok: true;
  facts: ExtractionOutput["facts"];
  attempts: 1 | 2;
};

export type ExtractionFailure = {
  ok: false;
  reason: string;
  raw: string;
  issues?: ZodIssue[];
  attempts: 2;
};

export type ExtractionResult = ExtractionSuccess | ExtractionFailure;

export type ExtractionParseResult =
  | { ok: true; facts: ExtractedFact[] }
  | { ok: false; reason: string; raw: string; issues?: ZodIssue[] };
type ParseFailure = Extract<ExtractionParseResult, { ok: false }>;

/** Parse the model response independently from any model call. */
export function parseExtractionResponse(raw: string): ExtractionParseResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `Invalid JSON: ${message}`, raw };
  }

  const result = extractionOutputSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      reason: result.error.issues
        .map(
          (issue) => `${issue.path.join(".") || "response"}: ${issue.message}`,
        )
        .join("; "),
      raw,
      issues: result.error.issues,
    };
  }

  return { ok: true, facts: result.data.facts };
}

function feedbackFor(
  result: Extract<ExtractionParseResult, { ok: false }>,
): string {
  if (result.issues?.length) {
    return result.issues
      .map((issue) => `${issue.path.join(".") || "response"}: ${issue.message}`)
      .join("\n");
  }
  return result.reason;
}

function failureFromError(
  error: unknown,
  prefix: string,
): ParseFailure {
  const details =
    error && typeof error === "object"
      ? (error as { message?: unknown; text?: unknown; issues?: unknown })
      : undefined;
  const message =
    typeof details?.message === "string" ? details.message : String(error);
  const issues = Array.isArray(details?.issues)
    ? (details.issues as ZodIssue[])
    : undefined;

  return {
    ok: false,
    reason: `${prefix}: ${message}`,
    raw: typeof details?.text === "string" ? details.text : "",
    ...(issues ? { issues } : {}),
  };
}

async function generateRaw(input: string, feedback?: string): Promise<string> {
  const { text } = await generateText({
    model: ollama("llama3.1:8b"),
    output: Output.object({ schema: extractionOutputSchema }),
    providerOptions: { ollama: { think: false } },
    prompt: extractionUserPrompt(input, feedback),
    temperature: 0,
    system: extractionSystemPrompt,
  });

  return text;
}

export async function extractMemories(
  input: string,
): Promise<ExtractionResult> {
  let firstAttempt: ExtractionParseResult;

  try {
    firstAttempt = parseExtractionResponse(await generateRaw(input));
  } catch (error) {
    firstAttempt = failureFromError(error, "Model call failed");
  }

  if (firstAttempt.ok) {
    return { ok: true, facts: firstAttempt.facts, attempts: 1 };
  }

  try {
    const secondAttempt = parseExtractionResponse(
      await generateRaw(input, feedbackFor(firstAttempt)),
    );

    if (secondAttempt.ok) {
      return { ok: true, facts: secondAttempt.facts, attempts: 2 };
    }

    return { ...secondAttempt, ok: false, attempts: 2 };
  } catch (error) {
    const failure = failureFromError(error, "Retry model call failed");
    return { ...failure, attempts: 2 };
  }
}
