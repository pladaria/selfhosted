import OpenAI from "openai";
import { debug } from "../utils/log.ts";

type OpenAiUsage = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_tokens_details?: {
    cached_tokens?: number;
  };
};

function getModelPricing(model: string) {
  const normalized = model.toLowerCase();

  if (normalized.startsWith("gpt-5-mini")) {
    return {
      inputPerMillion: 0.25,
      cachedInputPerMillion: 0.025,
      outputPerMillion: 2.0
    };
  }

  if (normalized.startsWith("gpt-5-nano")) {
    return {
      inputPerMillion: 0.05,
      cachedInputPerMillion: 0.005,
      outputPerMillion: 0.4
    };
  }

  if (normalized.startsWith("gpt-5")) {
    return {
      inputPerMillion: 1.25,
      cachedInputPerMillion: 0.125,
      outputPerMillion: 10.0
    };
  }

  return null;
}

export function estimateOpenAiCost(model: string, usage: OpenAiUsage | undefined) {
  const pricing = getModelPricing(model);
  if (!pricing || !usage) {
    return null;
  }

  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const cachedTokens = usage.input_tokens_details?.cached_tokens ?? 0;
  const nonCachedInputTokens = Math.max(0, inputTokens - cachedTokens);

  const inputCost = (nonCachedInputTokens / 1_000_000) * pricing.inputPerMillion;
  const cachedInputCost = (cachedTokens / 1_000_000) * pricing.cachedInputPerMillion;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;
  const totalCost = inputCost + cachedInputCost + outputCost;

  return {
    model,
    input_tokens: inputTokens,
    cached_input_tokens: cachedTokens,
    output_tokens: outputTokens,
    total_tokens: usage.total_tokens ?? inputTokens + outputTokens,
    estimated_cost_usd: Number(totalCost.toFixed(6))
  };
}

export function logOpenAiCost(
  label: string,
  model: string,
  response: Awaited<ReturnType<OpenAI["responses"]["create"]>>
) {
  const estimate = estimateOpenAiCost(model, response.usage as OpenAiUsage | undefined);
  if (!estimate) {
    debug(`${label} coste openai`, "estimacion no disponible para este modelo");
    return;
  }

  debug(`${label} coste openai`, estimate);
}
