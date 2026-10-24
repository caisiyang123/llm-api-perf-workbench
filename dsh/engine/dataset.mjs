/**
 * Request generation — a local equivalent of EvalScope's dataset plugins
 * (`plugin/datasets/random_dataset.py`, `custom.py`, `utils.py`).
 *
 * Three prompt sources are supported:
 *   builtin   — a small curated corpus (short/medium/long), cycled per request
 *   random    — filler text generated to an approximate input-token target
 *   file      — a JSONL file of prompts / messages / full request bodies
 *
 * Token counts are never assumed: the server `usage` block is the source of
 * truth, and any fallback is marked `estimate`.
 */

export const BUILTIN_PROMPTS = [
  { id: 'short-1', text: '用三句话解释什么是服务等级协议（SLA），并举一个 API 服务的例子。' },
  { id: 'short-2', text: '把下面这句话改写成正式书面语：这个接口有时候会卡住，得重试几次才行。' },
  { id: 'short-3', text: '列出五个评估大模型 API 服务质量的指标，并各用一句话说明含义。' },
  { id: 'medium-1', text: '请写一段技术说明，解释大模型推理服务中「首 token 延迟」和「每 token 输出间隔」的区别、各自受什么影响，以及压测时为什么要分开统计。要求 300 字左右，包含一个具体例子。' },
  { id: 'medium-2', text: '我们有一个 OpenAI 兼容的推理接口，最近高峰期偶发超时。请给出一个排查清单：从客户端并发、连接复用、服务端排队、输出长度四个角度分别列出需要采集的数据和判断方法。' },
  { id: 'medium-3', text: '请用通俗语言解释泊松到达过程，并说明在压测中「开环」和「闭环」两种发压方式分别对应什么业务场景，各自会得到怎样的性能曲线。' },
  { id: 'long-1', text: '背景：某团队准备把内部问答系统从单模型切换到多供应商路由，需要一份压测方案。请输出一份结构化的方案：一、测试目标与验收口径（至少包含首 token 延迟、每秒输出 token、成功率、分位数）；二、压测场景设计（并发阶梯、输入长度分档、输出长度分档）；三、数据采集与统计方法（说明为什么用 P99 而不是均值）；四、结果如何判定瓶颈与可承载并发；五、上线后的持续回归机制。请给出可执行的步骤，而不是泛泛而谈。' },
  { id: 'long-2', text: '请写一篇 800 字左右的技术分析：为什么在大模型压测中，用通用压测工具（如 JMeter）直接压 SSE 流式接口容易得到错误的「首 token 延迟」结论？请从流式帧解析、分块传输、TCP 缓冲、客户端计时点、并发与排队五个方面展开，并给出正确的实现要点。' },
];

const FILLER_ZH = '压测场景需要稳定的输入长度分布，因此这里填充与业务无关的中性文本，用于逼近目标输入长度，同时避免引入额外的语义复杂度。';
const FILLER_EN = 'Benchmark workloads need stable input-length distributions; this filler keeps the prompt length deterministic without adding semantic complexity. ';

/**
 * Generate filler text whose estimated token count is close to `targetTokens`.
 * CJK characters are ~1 token, so Chinese filler is measured in characters.
 */
export function buildRandomPrompt(targetTokens = 512) {
  const targetChars = Math.max(16, Math.round(targetTokens));
  const parts = [];
  let length = 0;
  let i = 0;
  while (length < targetChars) {
    const sentence = i % 3 === 2 ? FILLER_EN : FILLER_ZH;
    parts.push(sentence);
    length += sentence.length;
    i += 1;
  }
  const text = parts.join('');
  return { id: `random-${targetChars}`, text: text.slice(0, targetChars) };
}

function normalizeFileLine(line, index) {
  const value = line.trim();
  if (!value) return null;
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { id: `line-${index}`, messages: [{ role: 'user', content: value }] };
  }
  if (typeof parsed === 'string') return { id: `line-${index}`, messages: [{ role: 'user', content: parsed }] };
  if (Array.isArray(parsed)) return { id: `line-${index}`, messages: parsed };
  if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed.messages)) return { id: `line-${index}`, messages: parsed.messages, extra: parsed };
    if (typeof parsed.prompt === 'string') return { id: `line-${index}`, prompt: parsed.prompt, extra: parsed };
    return { id: `line-${index}`, bodyOverride: parsed };
  }
  return null;
}

export function parsePromptFile(content) {
  return content
    .split(/\r?\n/)
    .map((line, index) => normalizeFileLine(line, index))
    .filter(Boolean);
}

function bodyFromPrompt({ model, prompt, maxTokens, temperature, topP, seed, stream, endpoint }) {
  const generation = {
    max_tokens: maxTokens,
    temperature,
    ...(topP != null ? { top_p: topP } : {}),
    ...(seed != null ? { seed } : {}),
    stream,
  };
  if (endpoint === 'completions') {
    return { model, prompt, ...generation, ...(stream ? { stream_options: { include_usage: true } } : {}) };
  }
  return {
    model,
    messages: [{ role: 'user', content: prompt }],
    ...generation,
    ...(stream ? { stream_options: { include_usage: true } } : {}),
  };
}

/**
 * Build the per-round request queue.
 *
 * @param {object} options
 * @param {number} options.count        measured request count
 * @param {number} [options.warmupCount]
 * @param {'builtin'|'random'|'file'} [options.source]
 * @param {object[]} [options.filePrompts] result of `parsePromptFile`
 * @param {object} options.params      model / maxTokens / temperature / topP / seed / stream / endpoint
 * @param {number} [options.randomTokens]
 * @param {number} [options.offset]
 */
export function composeRequests(options) {
  const {
    count,
    warmupCount = 0,
    source = 'builtin',
    filePrompts = [],
    params,
    randomTokens = 512,
    offset = 0,
  } = options;

  const total = count + warmupCount;
  const items = [];
  for (let i = 0; i < total; i += 1) {
    const isWarmup = i < warmupCount;
    let prompt;
    if (source === 'file') {
      if (!filePrompts.length) throw new Error('file 数据集为空，请检查 JSONL 文件');
      prompt = filePrompts[(i + offset) % filePrompts.length];
    } else if (source === 'random') {
      prompt = buildRandomPrompt(randomTokens);
    } else {
      prompt = BUILTIN_PROMPTS[(i + offset) % BUILTIN_PROMPTS.length];
    }

    let body;
    let promptText;
    if (prompt.bodyOverride) {
      body = { ...prompt.bodyOverride, stream: params.stream };
      promptText = JSON.stringify(body);
    } else if (prompt.messages) {
      body = {
        model: params.model,
        messages: prompt.messages,
        max_tokens: params.maxTokens,
        temperature: params.temperature,
        ...(params.topP != null ? { top_p: params.topP } : {}),
        ...(params.seed != null ? { seed: params.seed } : {}),
        stream: params.stream,
        ...(params.stream ? { stream_options: { include_usage: true } } : {}),
      };
      promptText = prompt.messages.map((m) => m.content || '').join('\n');
    } else if (prompt.prompt) {
      body = bodyFromPrompt({ ...params, prompt: prompt.prompt });
      promptText = prompt.prompt;
    } else {
      body = bodyFromPrompt({ ...params, prompt: prompt.text });
      promptText = prompt.text;
    }

    items.push({
      body,
      promptText,
      isWarmup,
      meta: { prompt_id: prompt.id, prompt_chars: promptText.length },
    });
  }
  return items;
}