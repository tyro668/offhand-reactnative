export const MAX_MEMORY_CONTEXT_CHARS = 12000;

export type MemoryContextItem = {
  id?: number;
  type: string;
  title: string;
  content: string;
  source_path?: string | null;
};

export type MemoryContextContribution = {
  id?: number;
  fullChars: number;
  fullTokens: number;
  passedChars: number;
  passedTokens: number;
  truncated: boolean;
  included: boolean;
};

export type MemoryContextUsage = {
  context: string;
  maxContextChars: number;
  passedChars: number;
  passedTokens: number;
  contributions: MemoryContextContribution[];
};

export function estimateTextTokens(text: string): number {
  let tokens = 0;
  let latinRunLength = 0;

  const flushLatinRun = () => {
    if (latinRunLength > 0) {
      tokens += Math.max(1, Math.ceil(latinRunLength / 4));
      latinRunLength = 0;
    }
  };

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const char = text[i];

    if (/\s/.test(char)) {
      flushLatinRun();
      continue;
    }

    if (isCjkOrKanaOrHangul(code)) {
      flushLatinRun();
      tokens += 1;
      continue;
    }

    if (/[A-Za-z0-9_'-]/.test(char)) {
      latinRunLength += 1;
      continue;
    }

    flushLatinRun();
    tokens += 1;
  }

  flushLatinRun();
  return tokens;
}

export function buildMemoryItemSection(item: MemoryContextItem): string {
  const header = [
    `### ${item.title || '未命名语料'}`,
    `类型：${item.type === 'markdown' ? 'Markdown 文件语料' : '文本语料'}`,
    item.source_path ? `来源：${item.source_path}` : '',
  ].filter(Boolean).join('\n');

  return `${header}\n${item.content.trim()}`;
}

export function estimateMemoryItemTokens(item: MemoryContextItem): number {
  const content = item.content.trim();
  if (!content) {
    return 0;
  }
  return estimateTextTokens(buildMemoryItemSection(item));
}

export function buildMemoryContextUsage(
  items: MemoryContextItem[],
  maxContextChars: number = MAX_MEMORY_CONTEXT_CHARS,
): MemoryContextUsage {
  const sections: string[] = [];
  const contributions: MemoryContextContribution[] = [];
  let usedChars = 0;

  for (const item of items) {
    const content = item.content.trim();
    if (!content) {
      contributions.push({
        id: item.id,
        fullChars: 0,
        fullTokens: 0,
        passedChars: 0,
        passedTokens: 0,
        truncated: false,
        included: false,
      });
      continue;
    }

    const fullSection = buildMemoryItemSection(item);
    const remaining = maxContextChars - usedChars;
    const passedSection = remaining > 0
      ? fullSection.slice(0, remaining)
      : '';

    if (passedSection) {
      sections.push(passedSection);
      usedChars += passedSection.length;
    }

    contributions.push({
      id: item.id,
      fullChars: fullSection.length,
      fullTokens: estimateTextTokens(fullSection),
      passedChars: passedSection.length,
      passedTokens: estimateTextTokens(passedSection),
      truncated: passedSection.length < fullSection.length,
      included: passedSection.length > 0,
    });
  }

  const context = sections.join('\n\n');
  return {
    context,
    maxContextChars,
    passedChars: context.length,
    passedTokens: estimateTextTokens(context),
    contributions,
  };
}

function isCjkOrKanaOrHangul(code: number): boolean {
  return (
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0xac00 && code <= 0xd7af)
  );
}
