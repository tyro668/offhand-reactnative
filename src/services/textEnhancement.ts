import builtinProviders from '../models/textModels.json';

interface ProviderEntry {
  provider: string;
  protocol: string;
  baseUrl: string;
  models: {id: string; name: string}[];
}

const PROVIDERS: ProviderEntry[] = builtinProviders as ProviderEntry[];

const STYLE_PROMPTS: Record<string, Record<string, string>> = {
  zh: {
    styleFormal:
      '请用正式、专业的语气改写以下文本，保持原意不变。只返回改写后的文本，不要添加任何解释。',
    styleCasual:
      '请用随性、口语化的语气改写以下文本，保持原意不变。只返回改写后的文本，不要添加任何解释。',
    styleCreative:
      '请用富有创意、生动的语气改写以下文本，保持原意不变。只返回改写后的文本，不要添加任何解释。',
  },
  en: {
    styleFormal:
      'Rewrite the following text in a formal, professional tone. Keep the original meaning. Return only the rewritten text, no explanations.',
    styleCasual:
      'Rewrite the following text in a casual, conversational tone. Keep the original meaning. Return only the rewritten text, no explanations.',
    styleCreative:
      'Rewrite the following text creatively and vividly. Keep the original meaning. Return only the rewritten text, no explanations.',
  },
};

function getProtocol(provider: string): string {
  const p = PROVIDERS.find(pr => pr.provider === provider);
  return p?.protocol ?? 'openai';
}

function buildSystemPrompt(style: string, lang: string): string {
  const prompts = STYLE_PROMPTS[lang] ?? STYLE_PROMPTS.zh;
  return prompts[style] ?? prompts.styleCasual;
}

// ---------- OpenAI-compatible ----------

async function callOpenAI(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userText: string;
  maxTokens: number;
  thinking: boolean;
}): Promise<string> {
  const url = params.baseUrl.replace(/\/+$/, '') + '/chat/completions';

  const body: Record<string, unknown> = {
    model: params.model,
    messages: [
      {role: 'system', content: params.systemPrompt},
      {role: 'user', content: params.userText},
    ],
    max_tokens: params.maxTokens,
    temperature: 0.7,
  };

  if (params.thinking) {
    body.extra_body = {thinking: {type: 'enabled'}};
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`OpenAI API error ${resp.status}: ${errText}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

// ---------- Anthropic-compatible ----------

async function callAnthropic(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userText: string;
  maxTokens: number;
}): Promise<string> {
  const url = params.baseUrl.replace(/\/+$/, '') + '/v1/messages';

  const body = {
    model: params.model,
    max_tokens: params.maxTokens,
    system: params.systemPrompt,
    messages: [{role: 'user', content: params.userText}],
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': params.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Anthropic API error ${resp.status}: ${errText}`);
  }

  const data = await resp.json();
  return data.content?.[0]?.text?.trim() ?? '';
}

// ---------- Public API ----------

export interface EnhanceParams {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  style: string;
  maxTokens: string;
  thinking: boolean;
  lang?: string;
}

export async function enhanceText(
  inputText: string,
  params: EnhanceParams,
): Promise<string> {
  if (!inputText.trim()) {
    throw new Error('Input text is empty');
  }

  const protocol = getProtocol(params.provider);
  const systemPrompt = buildSystemPrompt(params.style, params.lang ?? 'zh');
  const userMessage = `原始文本：\n${inputText}`;
  const tokens = parseInt(params.maxTokens, 10) || 1024;

  if (protocol === 'anthropic') {
    return callAnthropic({
      baseUrl: params.baseUrl,
      apiKey: params.apiKey,
      model: params.model,
      systemPrompt,
      userText: userMessage,
      maxTokens: tokens,
    });
  }

  return callOpenAI({
    baseUrl: params.baseUrl,
    apiKey: params.apiKey,
    model: params.model,
    systemPrompt,
    userText: userMessage,
    maxTokens: tokens,
    thinking: params.thinking,
  });
}
