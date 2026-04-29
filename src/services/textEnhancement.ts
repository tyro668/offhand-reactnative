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
const TEST_TIMEOUT_MS = 10000;

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

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
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
}): Promise<string> {
  const url = params.baseUrl.replace(/\/+$/, '') + '/chat/completions';

  const body: Record<string, unknown> = {
    model: params.model,
    messages: [
      {role: 'system', content: params.systemPrompt},
      {role: 'user', content: params.userText},
    ],
    temperature: 0.3,
  };

  const resp = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify(body),
  }, params.timeoutMs);

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`OpenAI API error ${resp.status}: ${errText}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

async function callAnthropic(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userText: string;
  timeoutMs: number;
}): Promise<string> {
  const url = params.baseUrl.replace(/\/+$/, '') + '/v1/messages';

  const body = {
    model: params.model,
    system: params.systemPrompt,
    messages: [{role: 'user', content: params.userText}],
  };

  const resp = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': params.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  }, params.timeoutMs);

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Anthropic API error ${resp.status}: ${errText}`);
  }

  const data = await resp.json();
  return data.content?.[0]?.text?.trim() ?? '';
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
  const systemPrompt = 'You are a connection test endpoint. Reply with OK only.';
  const userText = 'Reply OK.';
  const startedAt = Date.now();

  const outputText = protocol === 'anthropic'
    ? await callAnthropic({
      baseUrl: params.baseUrl,
      apiKey: params.apiKey,
      model: params.model,
      systemPrompt,
      userText,
      timeoutMs: TEST_TIMEOUT_MS,
    })
    : await callOpenAI({
      baseUrl: params.baseUrl,
      apiKey: params.apiKey,
      model: params.model,
      systemPrompt,
      userText,
      timeoutMs: TEST_TIMEOUT_MS,
    });

  return {
    latencyMs: Date.now() - startedAt,
    outputText,
  };
}

export async function enhanceText(
  inputText: string,
  params: EnhanceParams,
): Promise<string> {
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

  const first = await callModel(budget.timeoutMs);
  return first.trim();
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
