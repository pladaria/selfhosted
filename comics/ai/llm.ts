import OpenAI from 'openai';

export type JsonSchema = Record<string, unknown>;
export type LlmEngine = 'ollama' | 'openai';
export type LlmReasoningEffort = 'low' | 'medium' | 'high';
export type LlmPromptCacheRetention = 'in_memory' | '24h';

type LlmTool = {
    type: 'web_search';
};

type LlmQueryOptions = {
    temperature?: number;
    reasoning?: LlmReasoningEffort;
    tools?: LlmTool[];
    keepAlive?: string;
    promptCacheKey?: string;
    promptCacheRetention?: LlmPromptCacheRetention;
};

type LlmQueryParams = {
    engine: LlmEngine;
    systemPrompt?: string;
    prompt: string;
    schema?: JsonSchema;
    schemaName?: string;
    options?: LlmQueryOptions;
};

type LlmQueryResult<T> = {
    text: string;
    data: T | null;
    raw: unknown;
};

const DEFAULT_OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.4-mini';
const DEFAULT_OPENAI_REASONING_EFFORT = (process.env.OPENAI_REASONING_EFFORT || 'low') as LlmReasoningEffort;
const DEFAULT_OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const DEFAULT_OLLAMA_MODEL = process.env.OLLAMA_TEXT_MODEL || 'gemma3:27b';
const DEFAULT_OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || '1h';
const DEFAULT_OLLAMA_TEMPERATURE = Number(process.env.OLLAMA_TEMPERATURE ?? '0');

export function getDefaultLlmModel(engine: LlmEngine) {
    return engine === 'openai' ? DEFAULT_OPENAI_MODEL : DEFAULT_OLLAMA_MODEL;
}

export function getDefaultLlmReasoning(engine: LlmEngine): LlmReasoningEffort {
    return engine === 'openai' ? DEFAULT_OPENAI_REASONING_EFFORT : 'low';
}

export function getDefaultLlmTemperature(engine: LlmEngine) {
    return engine === 'ollama' ? DEFAULT_OLLAMA_TEMPERATURE : undefined;
}

function getOpenAiApiKey() {
    return process.env.OPENAI_API_KEY || process.env.OPEN_API_KEY || null;
}

export function extractOpenAiText(response: Awaited<ReturnType<OpenAI['responses']['create']>>) {
    if (response.output_text && response.output_text.trim()) {
        return response.output_text;
    }

    for (const item of response.output ?? []) {
        if (item.type !== 'message') {
            continue;
        }

        for (const content of item.content ?? []) {
            if (content.type === 'output_text' && content.text?.trim()) {
                return content.text;
            }
        }
    }

    throw new Error('OpenAI returned no text output.');
}

async function runOpenAiQuery<T>({
    systemPrompt,
    prompt,
    schema,
    schemaName,
    options,
}: Omit<LlmQueryParams, 'engine'>): Promise<LlmQueryResult<T>> {
    const apiKey = getOpenAiApiKey();
    if (!apiKey) {
        throw new Error('Missing OPENAI_API_KEY environment variable. OPEN_API_KEY is also accepted.');
    }

    const client = new OpenAI({apiKey});
    const response = await client.responses.create({
        model: getDefaultLlmModel('openai'),
        reasoning: {effort: options?.reasoning || getDefaultLlmReasoning('openai')},
        tools: options?.tools,
        prompt_cache_key: options?.promptCacheKey,
        prompt_cache_retention: options?.promptCacheRetention,
        ...(schema
            ? {
                  text: {
                      format: {
                          type: 'json_schema' as const,
                          name: schemaName || 'structured_output',
                          strict: true,
                          schema,
                      },
                  },
              }
            : {}),
        instructions: systemPrompt,
        input: prompt,
    });

    const text = extractOpenAiText(response);
    return {
        text,
        data: schema ? (JSON.parse(text) as T) : null,
        raw: response,
    };
}

async function runOllamaQuery<T>({
    systemPrompt,
    prompt,
    schema,
    options,
}: Omit<LlmQueryParams, 'engine' | 'schemaName'>): Promise<LlmQueryResult<T>> {
    const response = await fetch(`${DEFAULT_OLLAMA_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            model: getDefaultLlmModel('ollama'),
            stream: false,
            keep_alive: options?.keepAlive || DEFAULT_OLLAMA_KEEP_ALIVE,
            temperature: options?.temperature ?? getDefaultLlmTemperature('ollama'),
            messages: [
                ...(systemPrompt
                    ? [
                          {
                              role: 'system',
                              content: systemPrompt,
                          },
                      ]
                    : []),
                {
                    role: 'user',
                    content: prompt,
                },
            ],
            ...(schema ? {format: schema} : {}),
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as {message?: {content?: string}};
    const text = data.message?.content?.trim();

    if (!text) {
        throw new Error('Ollama returned no content');
    }

    return {
        text,
        data: schema ? (JSON.parse(text) as T) : null,
        raw: data,
    };
}

export async function llmQuery<T = unknown>(params: LlmQueryParams): Promise<LlmQueryResult<T>> {
    if (params.engine === 'openai') {
        return runOpenAiQuery<T>(params);
    }

    return runOllamaQuery<T>(params);
}
