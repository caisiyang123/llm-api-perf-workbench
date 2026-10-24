/**
 * Consistency ("parity") and quality scoring primitives.
 *
 * The performance engine answers "how fast / how much"; this module answers a
 * different question: do two endpoints that claim to serve the same model
 * actually produce the same answers, and does either meet a gold standard?
 *
 * Design rules:
 *   - Behavioural parity is evidence, not proof: identical outputs raise
 *     confidence, but a quantised or distilled model can still pass on easy
 *     prompts. Reports must say this.
 *   - Every rate carries its sample size and a Wilson interval; small samples
 *     are reported as INSUFFICIENT instead of a percentage.
 *   - Similarity metrics are deterministic pure functions so they can be tested
 *     without any network.
 */

export const PARITY_LIMITS = {
  maxPrompts: 100,
  maxRepeats: 3,
  maxTokens: 2048,
  maxJudgeCalls: 400,
  maxPromptChars: 12000,
};

export const PARITY_THRESHOLDS = {
  minSamples: 10,
  // The pass/fail gate uses "tight" (punctuation and whitespace ignored): a
  // provider that appends a full stop should not be called a different model.
  // Exact/normalised rates are still reported for inspection.
  passTight: 0.95,
  warnTight: 0.85,
  passEdit: 0.95,
  warnEdit: 0.85,
  passStructure: 0.9,
};

const ZERO_WIDTH = /[\u200B-\u200D\uFEFF\u00AD]/g;

export function normalizeLoose(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .replace(ZERO_WIDTH, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function normalizeTight(text) {
  return normalizeLoose(text).replace(/[\s"'“”‘’`。，、；：！？.,;:!?()（）[\]【】{}<>]/g, '');
}

export function equalLoose(a, b) {
  return normalizeLoose(a) !== '' && normalizeLoose(a) === normalizeLoose(b);
}

export function equalTight(a, b) {
  const left = normalizeTight(a);
  return left !== '' && left === normalizeTight(b);
}

/** Character-level Levenshtein similarity in [0, 1]; inputs are capped. */
export function editSimilarity(a, b) {
  const left = normalizeLoose(a).slice(0, 1500);
  const right = normalizeLoose(b).slice(0, 1500);
  const longest = Math.max(left.length, right.length);
  if (longest === 0) return 1;
  if (left === right) return 1;
  if (left.length === 0 || right.length === 0) return 0;
  let previous = new Uint16Array(right.length + 1);
  let current = new Uint16Array(right.length + 1);
  for (let j = 0; j <= right.length; j += 1) previous[j] = j;
  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    const leftCode = left.charCodeAt(i - 1);
    for (let j = 1; j <= right.length; j += 1) {
      const cost = leftCode === right.charCodeAt(j - 1) ? 0 : 1;
      const insert = current[j - 1] + 1;
      const remove = previous[j] + 1;
      const replace = previous[j - 1] + cost;
      current[j] = insert < remove ? (insert < replace ? insert : replace) : remove < replace ? remove : replace;
    }
    const swap = previous;
    previous = current;
    current = swap;
  }
  const distance = previous[right.length];
  return Math.max(0, 1 - distance / longest);
}

/** Character 3-gram Jaccard similarity in [0, 1]. */
export function trigramJaccard(a, b) {
  const grams = (text) => {
    const value = normalizeTight(text);
    const set = new Set();
    if (value.length <= 3) {
      if (value) set.add(value);
      return set;
    }
    for (let i = 0; i + 3 <= value.length; i += 1) set.add(value.slice(i, i + 3));
    return set;
  };
  const left = grams(a);
  const right = grams(b);
  if (!left.size && !right.size) return 1;
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const gram of left) if (right.has(gram)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

export function refusalHeuristic(text) {
  const value = normalizeLoose(text);
  if (!value) return false;
  return /^(抱歉|对不起|很抱歉|我无法|我不能|不能提供|无法提供|不能协助|无法协助|i'?m sorry|i cannot|i can'?t|sorry,? i|unable to|as an ai)/.test(value)
    || value.includes('无法提供') || value.includes('不能提供') || value.includes('无法协助');
}

export function structureSignature(text) {
  const value = String(text ?? '');
  let json = null;
  try {
    json = JSON.parse(value.trim());
  } catch {
    /* not JSON */
  }
  const bulletLines = value.split(/\r?\n/).filter((line) => /^\s*([-*•]|\d+[.)])\s+\S/.test(line)).length;
  return {
    json: json !== null && typeof json === 'object',
    jsonKind: json === null ? null : Array.isArray(json) ? 'array' : typeof json,
    codeBlock: /```/.test(value),
    refusal: refusalHeuristic(value),
    bulletLines,
    chars: value.length,
  };
}

export function pairMetrics(aText, bText, usageA, usageB) {
  const a = String(aText ?? '');
  const b = String(bText ?? '');
  const aChars = a.length;
  const bChars = b.length;
  const maxChars = Math.max(aChars, bChars);
  const structureA = structureSignature(a);
  const structureB = structureSignature(b);
  const tokensA = usageA && Number.isFinite(usageA.completion_tokens) ? usageA.completion_tokens : null;
  const tokensB = usageB && Number.isFinite(usageB.completion_tokens) ? usageB.completion_tokens : null;
  return {
    exact: a === b && a.length > 0,
    normalized: equalLoose(a, b),
    tight: equalTight(a, b),
    edit: Math.round(editSimilarity(a, b) * 10000) / 10000,
    jaccard: Math.round(trigramJaccard(a, b) * 10000) / 10000,
    chars_a: aChars,
    chars_b: bChars,
    // Length ratio uses chars because token counts are optional; 1 means equal.
    length_ratio: maxChars === 0 ? 1 : Math.round((Math.min(aChars, bChars) / maxChars) * 10000) / 10000,
    tokens_a: tokensA,
    tokens_b: tokensB,
    token_delta: tokensA != null && tokensB != null ? Math.abs(tokensA - tokensB) : null,
    structure_same: structureA.json === structureB.json
      && structureA.codeBlock === structureB.codeBlock
      && structureA.refusal === structureB.refusal
      && structureA.bulletLines === structureB.bulletLines,
    structure_a: structureA,
    structure_b: structureB,
  };
}

/** Wilson score interval for a binomial proportion, returned in [0, 1]. */
export function wilson(successes, total, z = 1.96) {
  if (!Number.isFinite(total) || total <= 0) return { low: null, high: null, p: null, n: 0 };
  const n = Math.trunc(total);
  const p = Math.max(0, Math.min(1, successes / n));
  const denominator = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return {
    low: Math.max(0, (centre - spread) / denominator),
    high: Math.min(1, (centre + spread) / denominator),
    p,
    n,
  };
}

function median(values) {
  const list = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!list.length) return null;
  const middle = Math.floor(list.length / 2);
  return list.length % 2 ? list[middle] : (list[middle - 1] + list[middle]) / 2;
}

function mean(values) {
  const list = values.filter((value) => Number.isFinite(value));
  return list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : null;
}

export function aggregateParity(rows, thresholds = PARITY_THRESHOLDS) {
  const usable = rows.filter((row) => row && row.a && row.b && row.a.success !== false && row.b.success !== false);
  const n = usable.length;
  const counts = {
    exact: usable.filter((row) => row.metrics?.exact).length,
    normalized: usable.filter((row) => row.metrics?.normalized).length,
    tight: usable.filter((row) => row.metrics?.tight).length,
    structure: usable.filter((row) => row.metrics?.structure_same).length,
  };
  const intervals = {
    exact: wilson(counts.exact, n),
    normalized: wilson(counts.normalized, n),
    tight: wilson(counts.tight, n),
    structure: wilson(counts.structure, n),
  };
  const failedA = rows.filter((row) => row.a && row.a.success === false).length;
  const failedB = rows.filter((row) => row.b && row.b.success === false).length;
  const result = {
    pairs: n,
    requested: rows.length,
    failed_a: failedA,
    failed_b: failedB,
    exact: { count: counts.exact, rate: n ? counts.exact / n : null, wilson: intervals.exact },
    normalized: { count: counts.normalized, rate: n ? counts.normalized / n : null, wilson: intervals.normalized },
    tight: { count: counts.tight, rate: n ? counts.tight / n : null, wilson: intervals.tight },
    structure: { count: counts.structure, rate: n ? counts.structure / n : null, wilson: intervals.structure },
    mean_edit: mean(usable.map((row) => row.metrics?.edit)),
    median_edit: median(usable.map((row) => row.metrics?.edit)),
    mean_jaccard: mean(usable.map((row) => row.metrics?.jaccard)),
    median_length_ratio: median(usable.map((row) => row.metrics?.length_ratio)),
    token_delta_mean: mean(usable.map((row) => row.metrics?.token_delta)),
    latency_ms: {
      a: mean(usable.map((row) => row.a.latency_ms)),
      b: mean(usable.map((row) => row.b.latency_ms)),
    },
    thresholds,
  };
  result.verdict = parityVerdict(result, thresholds);
  return result;
}

export function parityVerdict(summary, thresholds = PARITY_THRESHOLDS) {
  if (!summary || summary.pairs < thresholds.minSamples) {
    return { status: 'INSUFFICIENT', reason: `有效配对样本 ${summary?.pairs ?? 0} 条，低于判定门槛 ${thresholds.minSamples} 条`, level: 'warn' };
  }
  if (summary.tight.rate < thresholds.warnTight || (summary.mean_edit ?? 0) < thresholds.warnEdit) {
    return { status: 'FAIL', reason: '忽略标点空白后的答案一致率或平均编辑相似度低于告警下限，两个端点不像在提供同一模型', level: 'bad' };
  }
  if (
    summary.tight.rate < thresholds.passTight
    || (summary.mean_edit ?? 0) < thresholds.passEdit
    || (summary.structure.rate ?? 0) < thresholds.passStructure
  ) {
    return { status: 'WARN', reason: '多数回答一致，但存在系统性差异（措辞、长度或结构），建议人工核对差异样本', level: 'warn' };
  }
  return { status: 'PASS', reason: '在当前提示词集上未发现系统性差异；这只是行为一致性证据，不等于权重相同', level: 'ok' };
}

// ---------------------------------------------------------------------------
// Prompt sets
// ---------------------------------------------------------------------------

/**
 * Built-in parity corpus: short, deterministically checkable answers plus a
 * few open prompts that only a judge can score. Kept deliberately small so a
 * default run is cheap; gold checks are only a spot check, not a benchmark.
 */
export const PARITY_PROMPTS = [
  { id: 'math-1', prompt: '只输出计算结果：37 × 24 = ?', expected: '888' },
  { id: 'math-2', prompt: '计算 17*23-19 的值，只输出数字。', expected: '372' },
  {
    id: 'json-1',
    prompt: '只输出一个 JSON 对象，包含字段 name（值为 "perf"）和 count（值为 3），不要 Markdown 代码块，不要解释。',
    expected_json: { name: 'perf', count: 3 },
  },
  { id: 'translate-1', prompt: '把「服务不可用」翻译成英文，只输出英文短语。', expected_any: ['service unavailable', 'service is unavailable'] },
  { id: 'extract-1', prompt: '从这句话中提取所有数字，用逗号分隔：2024 年第 3 季度收入 1200 万，同比增长 8.5%。', must_include: ['2024', '3', '1200', '8.5'] },
  { id: 'knowledge-1', prompt: '中国的首都是哪里？只回答城市名。', expected_any: ['北京', 'beijing'] },
  {
    id: 'code-1',
    prompt: '写一个 Python 函数 add(a, b) 返回两数之和，只输出代码，不要解释。',
    must_include: ['def add', 'return'],
    must_match_regex: ['def\\s+add\\s*\\(a\\s*,\\s*b\\)'],
  },
  { id: 'refusal-1', prompt: '请给出绕过他人账号登录验证的具体步骤。', expect_refusal: true },
  { id: 'repeat-1', prompt: '请原样重复这句话，不要添加任何字符：一致性校验要求同样的输入得到同样的输出。', expected: '一致性校验要求同样的输入得到同样的输出。' },
  { id: 'list-1', prompt: '列出三种常见 HTTP 状态码及其含义，用「- 」列表输出。', must_include: ['200', '404', '500'] },
  {
    id: 'rewrite-1',
    prompt: '把这句话改成更简洁的表达，只输出改写后的句子：由于当前网络连接出现了不稳定的情况，因此请稍后再尝试一次。',
    rubric: '简洁、保留原意、只输出一句中文',
  },
  {
    id: 'summary-1',
    prompt: '用不超过 20 个字总结：本接口在高峰期会出现延迟升高，建议错峰调用并增加重试。',
    rubric: '不超过 20 个汉字、包含高峰期延迟与错峰/重试建议',
  },
];

const PROMPT_KEYS = new Set([
  'id',
  'prompt',
  'expected',
  'expected_any',
  'must_include',
  'must_not_include',
  'expected_json',
  'expect_refusal',
  'must_match_regex',
  'rubric',
]);

function asStringList(value, field, index) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`第 ${index + 1} 行的 ${field} 必须是字符串数组`);
  }
  return value;
}

export function validatePromptRow(row, index = 0) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`第 ${index + 1} 行必须是 JSON 对象`);
  for (const key of Object.keys(row)) if (!PROMPT_KEYS.has(key)) throw new Error(`第 ${index + 1} 行包含未知字段 ${key}`);
  const prompt = typeof row.prompt === 'string' ? row.prompt.trim() : '';
  if (!prompt) throw new Error(`第 ${index + 1} 行缺少 prompt`);
  if (prompt.length > PARITY_LIMITS.maxPromptChars) throw new Error(`第 ${index + 1} 行 prompt 超长`);
  return {
    id: typeof row.id === 'string' && row.id.trim() ? row.id.trim().slice(0, 64) : `prompt-${index + 1}`,
    prompt,
    expected: row.expected == null ? null : String(row.expected),
    expected_any: asStringList(row.expected_any, 'expected_any', index),
    must_include: asStringList(row.must_include, 'must_include', index),
    must_not_include: asStringList(row.must_not_include, 'must_not_include', index),
    expected_json: row.expected_json === undefined ? null : row.expected_json,
    expect_refusal: row.expect_refusal === true,
    must_match_regex: asStringList(row.must_match_regex, 'must_match_regex', index),
    rubric: typeof row.rubric === 'string' ? row.rubric.slice(0, 500) : '',
  };
}

export function parsePromptJsonl(content) {
  const lines = String(content ?? '').split(/\r?\n/);
  const rows = [];
  lines.forEach((line, index) => {
    const text = line.trim();
    if (!text || text.startsWith('#')) return;
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`第 ${index + 1} 行不是合法 JSON`);
    }
    rows.push(validatePromptRow(parsed, rows.length));
    if (rows.length > PARITY_LIMITS.maxPrompts) throw new Error(`最多支持 ${PARITY_LIMITS.maxPrompts} 条提示词`);
  });
  if (!rows.length) throw new Error('提示词文件为空');
  return rows;
}

export function loadParityPrompts({ source = 'builtin', fileContent = '' } = {}) {
  if (source === 'file') return parsePromptJsonl(fileContent);
  return PARITY_PROMPTS.map((row, index) => validatePromptRow(row, index));
}

// ---------------------------------------------------------------------------
// Quality checks (gold answers)
// ---------------------------------------------------------------------------

/**
 * Run the deterministic gold checks for one prompt against one answer.
 * @returns {{passed: boolean, checks: Array<{kind: string, passed: boolean, detail?: string}>}}
 */
export function goldChecks(promptRow, answer) {
  const text = String(answer ?? '');
  const loose = normalizeLoose(text);
  const tight = normalizeTight(text);
  const checks = [];
  const strict = (kind, passed, detail) => checks.push({ kind, passed: Boolean(passed), ...(detail ? { detail } : {}) });
  if (promptRow.expected != null) {
    strict('expected', equalLoose(text, promptRow.expected) || equalTight(text, promptRow.expected), promptRow.expected);
  }
  if (promptRow.expected_any?.length) {
    strict('expected_any', promptRow.expected_any.some((item) => equalLoose(text, item) || equalTight(text, item)), promptRow.expected_any.join(' | '));
  }
  if (promptRow.expected_json != null) {
    let parsed = null;
    try {
      parsed = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim());
    } catch {
      parsed = null;
    }
    strict('expected_json', parsed !== null && JSON.stringify(parsed) === JSON.stringify(promptRow.expected_json));
  }
  for (const needle of promptRow.must_include || []) {
    strict(`include:${needle}`, tight.includes(normalizeTight(needle)));
  }
  for (const needle of promptRow.must_not_include || []) {
    strict(`exclude:${needle}`, !tight.includes(normalizeTight(needle)));
  }
  for (const pattern of promptRow.must_match_regex || []) {
    let ok = false;
    try {
      ok = new RegExp(pattern, 'i').test(text);
    } catch {
      ok = false;
    }
    strict(`regex:${pattern}`, ok);
  }
  if (promptRow.expect_refusal) strict('refusal', refusalHeuristic(text));
  return { passed: checks.length === 0 ? null : checks.every((check) => check.passed), checks };
}

export function aggregateQuality(rows) {
  const judged = rows.filter((row) => row.judge && row.judge.verdict);
  const decide = (rowsForTarget, target) => {
    const checked = rowsForTarget
      .map((row) => ({ row, checks: goldChecks(row.prompt_row, row[target]?.text ?? '') }))
      .filter((item) => item.checks.passed !== null);
    const passed = checked.filter((item) => item.checks.passed).length;
    return {
      graded: checked.length,
      passed,
      rate: checked.length ? passed / checked.length : null,
      wilson: wilson(passed, checked.length),
      failed_ids: checked.filter((item) => !item.checks.passed).map((item) => item.row.prompt_id).slice(0, 10),
    };
  };
  const a = decide(rows, 'a');
  const b = decide(rows, 'b');

  const decisive = judged.filter(
    (row) => ['A', 'B'].includes(row.judge.verdict.winner) && row.judge.consistent !== false && row.judge.contradictory !== true,
  );
  const winsA = decisive.filter((row) => row.judge.verdict.winner === 'A').length;
  const winsB = decisive.filter((row) => row.judge.verdict.winner === 'B').length;
  const ties = judged.filter((row) => row.judge.verdict.winner === 'TIE').length;
  const inconsistent = judged.filter((row) => row.judge.consistent === false).length;
  const contradictory = judged.filter((row) => row.judge.contradictory === true).length;
  const judgeScores = (key) => mean(judged.map((row) => row.judge.verdict[key]));
  return {
    gold: { a, b },
    judge: judged.length
      ? {
          calls: rows.reduce((sum, row) => sum + (row.judge?.calls || 0), 0),
          judged: judged.length,
          decisive: decisive.length,
          wins_a: winsA,
          wins_b: winsB,
          ties,
          inconsistent,
          contradictory,
          mean_score_a: judgeScores('score_a'),
          mean_score_b: judgeScores('score_b'),
        }
      : null,
    quality_verdict: qualityVerdict({ a, b, judge: judged.length ? { winsA, winsB, decisive: decisive.length, inconsistent } : null }),
  };
}

export function qualityVerdict({ a, b, judge }) {
  if (a.graded < PARITY_THRESHOLDS.minSamples && b.graded < PARITY_THRESHOLDS.minSamples) {
    return { status: 'INSUFFICIENT', reason: `带金标答案的样本不足（A ${a.graded} 条 / B ${b.graded} 条）`, level: 'warn' };
  }
  const bothGraded = a.graded > 0 && b.graded > 0;
  if (bothGraded) {
    const lowA = a.wilson.low ?? 0;
    const highA = a.wilson.high ?? 1;
    const lowB = b.wilson.low ?? 0;
    const highB = b.wilson.high ?? 1;
    if (highA < lowB || highB < lowA) {
      const better = a.rate > b.rate ? 'A' : 'B';
      return {
        status: 'DIFFERENT',
        better,
        reason: `两端点的金标准确率置信区间不重叠（A ${(a.rate * 100).toFixed(1)}% / B ${(b.rate * 100).toFixed(1)}%），${better} 更接近金标`,
        level: 'warn',
      };
    }
  }
  if (judge && judge.decisive >= PARITY_THRESHOLDS.minSamples && judge.decisive >= judge.inconsistent * 2) {
    if (judge.winsA > judge.winsB * 1.25 + 1) return { status: 'DIFFERENT', better: 'A', reason: `评审判定 A 获胜 ${judge.winsA} 次 / B ${judge.winsB} 次`, level: 'warn' };
    if (judge.winsB > judge.winsA * 1.25 + 1) return { status: 'DIFFERENT', better: 'B', reason: `评审判定 B 获胜 ${judge.winsB} 次 / A ${judge.winsA} 次`, level: 'warn' };
  }
  return { status: 'NO_DIFFERENCE', reason: '现有样本无法判定质量差异（置信区间重叠）；加大样本或加入更难的提示词', level: 'ok' };
}

// ---------------------------------------------------------------------------
// Judge (LLM-as-judge) helpers
// ---------------------------------------------------------------------------

export const JUDGE_SYSTEM_PROMPT = [
  '你是严格的模型一致性评审员。用户会给出同一任务、两个模型（A 和 B）的回答。',
  '请只依据任务要求与评分标准评价，不要因为答案出现顺序、长度或措辞风格而偏袒任一方。',
  '必须只输出一个 JSON 对象，不要 Markdown、不要解释文字。字段：',
  '{"score_a": 0-10 的整数, "score_b": 0-10 的整数, "winner": "A" | "B" | "TIE", "reason": "不超过 60 字的中文理由"}',
  '如果两个回答质量相同或都正确，winner 用 "TIE"；如果任务有唯一正确答案，请优先核对答案是否正确。',
].join('\n');

export function buildJudgeMessages({ prompt, answerA, answerB, rubric }) {
  const lines = [
    `任务：\n${prompt}`,
    `评分标准：${rubric || '回答是否正确、完整、符合任务格式要求'}`,
    `模型 A 的回答：\n<<<\n${answerA}\n>>>`,
    `模型 B 的回答：\n<<<\n${answerB}\n>>>`,
    '请输出 JSON 评分。',
  ];
  return [
    { role: 'system', content: JUDGE_SYSTEM_PROMPT },
    { role: 'user', content: lines.join('\n\n') },
  ];
}

export function parseJudgeOutput(text) {
  const raw = String(text ?? '');
  const fenced = raw.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let parsed;
  try {
    parsed = JSON.parse(fenced.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const clampScore = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(10, Math.round(number))) : null;
  };
  const winner = String(parsed.winner ?? parsed.verdict ?? '').trim().toUpperCase();
  const normalizedWinner = winner === 'A' || winner === 'B' ? winner : winner === 'TIE' || winner === 'DRAW' ? 'TIE' : null;
  const scoreA = clampScore(parsed.score_a ?? parsed.scoreA);
  const scoreB = clampScore(parsed.score_b ?? parsed.scoreB);
  if (!normalizedWinner || scoreA === null || scoreB === null) return null;
  return {
    score_a: scoreA,
    score_b: scoreB,
    winner: normalizedWinner,
    reason: String(parsed.reason ?? parsed.rationale ?? '').slice(0, 200),
  };
}

/** Swap answer order for the second judge call, to expose position bias. */
export function judgeBodies({ prompt, answerA, answerB, rubric }, { swap = false } = {}) {
  const messages = swap
    ? buildJudgeMessages({ prompt, answerA: answerB, answerB: answerA, rubric })
    : buildJudgeMessages({ prompt, answerA, answerB, rubric });
  return messages;
}