import { ollama } from 'ollama-ai-provider-v2';
import { generateText } from 'ai';
import { extractionSystemPrompt, extractionUserPrompt } from './prompt';
import { extractionOutputSchema, type ExtractionOutput } from "./schema";

export async function extractMemories(input:string): Promise<ExtractionOutput> {
  const { text } = await generateText({
    model: ollama('llama3.1:8b'),
    providerOptions: { ollama: { think: false } },
    prompt: extractionUserPrompt(input),
    temperature: 0,
    system:extractionSystemPrompt
  });
  const memObj = JSON.parse(text);
  // retry on failed parsing
  return extractionOutputSchema.parse(memObj);
}

