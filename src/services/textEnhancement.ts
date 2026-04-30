import builtinProviders from '../models/textModels.json';
import {DEFAULT_SYSTEM_PROMPT} from '../models/defaultPrompt';

interface ProviderEntry {
  provider: string;
  protocol: string;
  baseUrl: string;
  models: {id: string; name: string}[];
}

const PROVIDERS: ProviderEntry[] = builtinProviders as ProviderEntry[];

const MIN_TIMEOUT_MS = 3500;
const MAX_TIMEOUT_MS = 9000;
const TEST_TIMEOUT_MS = 6000;
const TEST_MAX_TOKENS = 4;

export interface TextModelRequestTiming {
  payloadBytes: number;
  requestElapsedMs: number;
  parseElapsedMs: number;
}

interface ModelCallResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  timing: TextModelRequestTiming;
}

function getProtocol(provider: string): string {
  const p = PROVIDERS.find(pr => pr.provider === provider);
  return p?.protocol ?? 'openai';
}

export function getEnhancementRequestBudget(inputChars: number): {
  timeoutMs: number;
} {
  const size = Math.max(1, inputChars);
  return {
    timeoutMs: Math.min(
      MAX_TIMEOUT_MS,
      Math.max(MIN_TIMEOUT_MS, Math.ceil(size * 60 + 2500)),
    ),
  };
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{response: Response; requestElapsedMs: number}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    return {
      response,
      requestElapsedMs: Date.now() - startedAt,
    };
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error(`Text model request timed out after ${timeoutMs}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenAI(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userText: string;
  timeoutMs: number;
  maxTokens?: number;
  temperature?: number;
}): Promise<ModelCallResult> {
  const url = params.baseUrl.replace(/\/+$/, '') + '/chat/completions';

  const body: Record<string, unknown> = {
    model: params.model,
    messages: [
      {role: 'system', content: params.systemPrompt},
      {role: 'user', content: params.userText},
    ],
    temperature: params.temperature ?? 0.3,
  };
  if (params.maxTokens !== undefined) {
    body.max_tokens = params.maxTokens;
  }
  const payload = JSON.stringify(body);

  const {response: resp, requestElapsedMs} = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: payload,
  }, params.timeoutMs);

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`OpenAI API error ${resp.status}: ${errText}`);
  }

  const parseStartedAt = Date.now();
  const data = await resp.json();
  const parseElapsedMs = Date.now() - parseStartedAt;
  const text = data.choices?.[0]?.message?.content?.trim() ?? '';
  const usage = data.usage || {};
  const inputTokens = usage.prompt_tokens ?? Math.ceil((params.systemPrompt.length + params.userText.length) * 0.4);
  const outputTokens = usage.completion_tokens ?? Math.ceil(text.length * 0.4);
  return {
    text,
    inputTokens,
    outputTokens,
    timing: {
      payloadBytes: utf8ByteLength(payload),
      requestElapsedMs,
      parseElapsedMs,
    },
  };
}

async function callAnthropic(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userText: string;
  timeoutMs: number;
  maxTokens?: number;
  temperature?: number;
}): Promise<ModelCallResult> {
  const url = params.baseUrl.replace(/\/+$/, '') + '/v1/messages';

  const body = {
    model: params.model,
    max_tokens: params.maxTokens ?? 1024,
    temperature: params.temperature ?? 0.3,
    system: params.systemPrompt,
    messages: [{role: 'user', content: params.userText}],
  };
  const payload = JSON.stringify(body);

  const {response: resp, requestElapsedMs} = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': params.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: payload,
  }, params.timeoutMs);

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Anthropic API error ${resp.status}: ${errText}`);
  }

  const parseStartedAt = Date.now();
  const data = await resp.json();
  const parseElapsedMs = Date.now() - parseStartedAt;
  const text = data.content?.[0]?.text?.trim() ?? '';
  const usage = data.usage || {};
  const inputTokens = usage.input_tokens ?? Math.ceil((params.systemPrompt.length + params.userText.length) * 0.4);
  const outputTokens = usage.output_tokens ?? Math.ceil(text.length * 0.4);
  return {
    text,
    inputTokens,
    outputTokens,
    timing: {
      payloadBytes: utf8ByteLength(payload),
      requestElapsedMs,
      parseElapsedMs,
    },
  };
}

export interface EnhanceParams {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  prompt: string;
  memoryContext?: string;
}

export interface TextModelConnectionResult {
  latencyMs: number;
  outputText: string;
  timing: TextModelRequestTiming;
}

function validateTextModelParams(params: EnhanceParams): void {
  if (!params.provider.trim()) {
    throw new Error('Text model provider is empty');
  }
  if (!params.baseUrl.trim()) {
    throw new Error('Text model endpoint URL is empty');
  }
  if (!/^https?:\/\//i.test(params.baseUrl.trim())) {
    throw new Error('Text model endpoint URL must start with http:// or https://');
  }
  if (!params.model.trim()) {
    throw new Error('Text model name is empty');
  }
  if (!params.apiKey.trim()) {
    throw new Error('Text model API key is empty');
  }
}

export async function testTextModelConnection(
  params: EnhanceParams,
): Promise<TextModelConnectionResult> {
  validateTextModelParams(params);

  const protocol = getProtocol(params.provider);
  const systemPrompt = 'Reply with OK only.';
  const userText = 'OK';
  const startedAt = Date.now();

  const result = protocol === 'anthropic'
    ? await callAnthropic({
      baseUrl: params.baseUrl,
      apiKey: params.apiKey,
      model: params.model,
      systemPrompt,
      userText,
      timeoutMs: TEST_TIMEOUT_MS,
      maxTokens: TEST_MAX_TOKENS,
      temperature: 0,
    })
    : await callOpenAI({
      baseUrl: params.baseUrl,
      apiKey: params.apiKey,
      model: params.model,
      systemPrompt,
      userText,
      timeoutMs: TEST_TIMEOUT_MS,
      maxTokens: TEST_MAX_TOKENS,
      temperature: 0,
    });

  return {
    latencyMs: Date.now() - startedAt,
    outputText: result.text,
    timing: result.timing,
  };
}

export interface EnhanceResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  timing: TextModelRequestTiming;
}

export async function enhanceText(
  inputText: string,
  params: EnhanceParams,
): Promise<EnhanceResult> {
  if (!inputText.trim()) {
    throw new Error('Input text is empty');
  }

  const protocol = getProtocol(params.provider);
  const systemPrompt = buildSystemPrompt(
    params.prompt || DEFAULT_SYSTEM_PROMPT,
    params.memoryContext,
  );
  const userMessage = `原始文本：\n${inputText}`;
  const budget = getEnhancementRequestBudget(inputText.length);

  const callModel = (timeoutMs: number) => {
    if (protocol === 'anthropic') {
      return callAnthropic({
        baseUrl: params.baseUrl,
        apiKey: params.apiKey,
        model: params.model,
        systemPrompt,
        userText: userMessage,
        timeoutMs,
      });
    }

    return callOpenAI({
      baseUrl: params.baseUrl,
      apiKey: params.apiKey,
      model: params.model,
      systemPrompt,
      userText: userMessage,
      timeoutMs,
    });
  };

  const result = await callModel(budget.timeoutMs);
  return result;
}

function buildSystemPrompt(basePrompt: string, memoryContext?: string): string {
  const trimmedContext = memoryContext?.trim();
  if (!trimmedContext) {
    return basePrompt;
  }

  return `${basePrompt}

## 用户专属语料库
下面是用户启用的专属语料。它们用于理解用户偏好的表达方式、专有名词、常用措辞和上下文背景。改写时优先参考这些语料，但不要凭空添加原始文本没有表达的新事实。

${trimmedContext}`;
}
