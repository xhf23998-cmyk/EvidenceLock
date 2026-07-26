export type ClaimStatus = "supported" | "conflict" | "unverified";
export type Severity = "high" | "medium" | "low";

export type SourceHit = {
  key: string;
  value: string;
  file: string;
  line: number;
  excerpt: string;
  scope?: string;
  qualifier?: string;
  comparable: number;
  tolerance: number;
};

export type Claim = {
  id: string;
  key: string;
  label: string;
  value: string;
  context: string;
  line: number;
  status: ClaimStatus;
  severity: Severity;
  reason: string;
  suggestion: string;
  scope?: string;
  source?: SourceHit;
};

export type EvidenceText = {
  name: string;
  text: string;
};

type Category = {
  key: string;
  label: string;
};

type ComparableNumber = {
  value: number;
  tolerance: number;
};

const metricKeys = new Set([
  "accuracy",
  "macro_f1",
  "precision",
  "recall",
  "auc",
]);

export const numberRegex =
  /(?<![\w.])[-+]?(?:\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?(?:\s?(?:%|％|ms|s|Hz|kHz|MHz|GB|MB|KB|℃|°C|kg|mm|cm|例|个|次|组))?/gi;

function numericToken(rawValue: string) {
  return rawValue
    .replace(/,/g, "")
    .match(/[-+]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?/)?.[0];
}

function numericResolution(token: string) {
  const [mantissa, exponentText] = token.toLowerCase().split("e");
  const decimals = mantissa.split(".")[1]?.length ?? 0;
  const exponent = exponentText ? Number(exponentText) : 0;
  return 10 ** (-decimals + exponent);
}

function inferredUnit(rawValue: string, context: string) {
  const raw = rawValue.toLowerCase().replace(/％/g, "%");
  const suffix = raw.match(
    /(%|ms|s|khz|mhz|hz|gb|mb|kb|℃|°c|kg|mm|cm)\s*$/i,
  )?.[1];
  if (suffix) return suffix.toLowerCase();

  const normalizedContext = context
    .toLowerCase()
    .replace(/％/g, "%")
    .replace(/\s+/g, " ");
  const explicitUnit = normalizedContext.match(
    /(?:unit|单位)\s*[=:：]\s*(percent|%|ms|s|khz|mhz|hz|gb|mb|kb|kg|mm|cm)\b/i,
  )?.[1];
  if (explicitUnit) return explicitUnit.toLowerCase();
  if (/(?:^|[,;|]\s*)(percent|%)\s*(?:[,;|]|$)/i.test(normalizedContext)) {
    return "%";
  }
  if (/(?:^|[,;|]\s*)ms\s*(?:[,;|]|$)/i.test(normalizedContext)) return "ms";
  if (/(?:^|[,;|]\s*)s\s*(?:[,;|]|$)/i.test(normalizedContext)) return "s";
  return "";
}

export function comparableNumber(
  rawValue: string,
  key: string,
  context = "",
): ComparableNumber | null {
  const token = numericToken(rawValue);
  if (!token) return null;
  let value = Number(token);
  if (!Number.isFinite(value)) return null;

  let resolution = numericResolution(token);
  const unit = inferredUnit(rawValue, context);

  if (metricKeys.has(key) || unit === "%" || unit === "percent") {
    if (unit === "%" || unit === "percent" || Math.abs(value) > 1) {
      value /= 100;
      resolution /= 100;
    }
  } else if (key === "latency") {
    if (unit === "s") {
      value *= 1000;
      resolution *= 1000;
    }
  } else {
    const factors: Record<string, number> = {
      khz: 1_000,
      mhz: 1_000_000,
      hz: 1,
      gb: 1024 ** 3,
      mb: 1024 ** 2,
      kb: 1024,
      cm: 10,
      mm: 1,
    };
    const factor = factors[unit] ?? 1;
    value *= factor;
    resolution *= factor;
  }

  return {
    value,
    tolerance: Math.max(Math.abs(resolution) / 2 + Number.EPSILON, 1e-12),
  };
}

export function valuesEquivalent(
  left: ComparableNumber,
  right: ComparableNumber,
) {
  return (
    Math.abs(left.value - right.value) <=
    Math.max(left.tolerance, right.tolerance)
  );
}

export function categoryForClaim(
  context: string,
  rawValue: string,
): Category {
  const text = context.toLowerCase();
  const metricCategory = nearestMetricCategory(text, rawValue);
  if (metricCategory) return metricCategory;
  const sampleCategory = nearestSampleCategory(text, rawValue);
  if (sampleCategory) return sampleCategory;
  if (/%|％/.test(rawValue)) {
    return { key: "percentage", label: "百分比结果" };
  }
  return { key: "numeric_claim", label: "数值陈述" };
}

function nearestMetricCategory(
  context: string,
  rawValue: string,
): Category | undefined {
  const candidates: Array<Category & { pattern: RegExp }> = [
    {
      key: "macro_f1",
      label: "宏平均 F1",
      pattern: /宏平均\s*f1|macro[-\s_]?f1|macro\s+f1/gi,
    },
    {
      key: "accuracy",
      label: "准确率",
      pattern: /准确率|accuracy|acc\b/gi,
    },
    {
      key: "precision",
      label: "精确率",
      pattern: /精确率|precision/gi,
    },
    {
      key: "recall",
      label: "召回率",
      pattern: /召回率|recall/gi,
    },
    {
      key: "auc",
      label: "AUC",
      pattern: /\bauc\b|曲线下面积/gi,
    },
    {
      key: "latency",
      label: "推理延迟",
      pattern: /推理.{0,8}延迟|延迟|latency|inference\s*time/gi,
    },
    {
      key: "runs",
      label: "重复次数",
      pattern: /重复|实验次数|runs?|trials?/gi,
    },
    {
      key: "p_value",
      label: "P 值",
      pattern: /p\s*[<=>]|p[_\s-]?value|显著性/gi,
    },
  ];
  return nearestCategory(context, rawValue, candidates, 56);
}

function nearestSampleCategory(
  context: string,
  rawValue: string,
): Category | undefined {
  const candidates: Array<Category & { pattern: RegExp }> = [
    {
      key: "test_samples",
      label: "测试集样本",
      pattern: /测试集|test[_\s-]?(?:set|samples?)/gi,
    },
    {
      key: "train_samples",
      label: "训练集样本",
      pattern: /训练集|train(?:ing)?[_\s-]?(?:set|samples?)/gi,
    },
    {
      key: "validation_samples",
      label: "验证集样本",
      pattern: /验证集|validation[_\s-]?(?:set|samples?)/gi,
    },
    {
      key: "total_samples",
      label: "总样本量",
      pattern:
        /总样本|有效样本|纳入|包含|共计|样本量|total[_\s-]?samples?|participants?|subjects?/gi,
    },
  ];
  return nearestCategory(context, rawValue, candidates, 36);
}

function nearestCategory(
  context: string,
  rawValue: string,
  candidates: Array<Category & { pattern: RegExp }>,
  maximumDistance: number,
) {
  const valueIndex = Math.max(0, context.indexOf(rawValue.toLowerCase()));
  let best:
    | {
        category: Category;
        distance: number;
      }
    | undefined;
  candidates.forEach(({ key, label, pattern }) => {
    [...context.matchAll(pattern)].forEach((match) => {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      const distance =
        valueIndex < start
          ? start - valueIndex
          : valueIndex > end
            ? valueIndex - end
            : 0;
      if (!best || distance < best.distance) {
        best = { category: { key, label }, distance };
      }
    });
  });
  return best && best.distance <= maximumDistance ? best.category : undefined;
}

function nearestKeywordScope(context: string, rawValue: string) {
  const lower = context.toLowerCase();
  const valueIndex = Math.max(0, lower.indexOf(rawValue.toLowerCase()));
  const scopes = [
    { scope: "test", pattern: /测试集|test(?:ing)?(?:\s+set)?/gi },
    { scope: "train", pattern: /训练集|train(?:ing)?(?:\s+set)?/gi },
    { scope: "validation", pattern: /验证集|validation(?:\s+set)?/gi },
  ];
  let best: { scope: string; distance: number } | undefined;
  scopes.forEach(({ scope, pattern }) => {
    [...lower.matchAll(pattern)].forEach((match) => {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      const distance =
        valueIndex < start
          ? start - valueIndex
          : valueIndex > end
            ? valueIndex - end
            : 0;
      if (!best || distance < best.distance) best = { scope, distance };
    });
  });
  return best?.scope;
}

function qualifierForContext(context: string) {
  const text = context.toLowerCase();
  if (/基线|对照|baseline|control/.test(text)) return "baseline";
  if (/本文|所提出|本模型|ours?|proposed/.test(text)) return "proposed";
  return undefined;
}

function parseDelimitedLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  cells.push(current.trim());
  return cells;
}

function delimitedSourceHits(source: EvidenceText) {
  const extension = source.name.split(".").pop()?.toLowerCase();
  const delimiter = extension === "tsv" ? "\t" : ",";
  const lines = source.text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const rows = lines.map((line) => parseDelimitedLine(line, delimiter));
  const headers = rows[0];
  const hasHeader =
    headers.length > 1 &&
    headers.some((cell) => /[a-zA-Z\u4e00-\u9fff_]/.test(cell)) &&
    rows.slice(1).some((row) => row.length === headers.length);
  if (!hasHeader) return [];

  const hits: SourceHit[] = [];
  rows.slice(1).forEach((row, rowIndex) => {
    const pairs = row.map(
      (cell, columnIndex) => `${headers[columnIndex] ?? `column_${columnIndex + 1}`}=${cell}`,
    );
    const rowContext = pairs.join(" | ");
    row.forEach((cell, columnIndex) => {
      const match = cell.match(numberRegex)?.[0];
      if (!match) return;
      const header = headers[columnIndex] ?? "";
      const numericHeader =
        /value|result|score|accuracy|acc\b|f1|auc|precision|recall|latency|time|samples?|\bn\b|count|数量|数值|结果|准确率|延迟/i.test(
          header,
        );
      const cellIsNumeric = cell.replace(numberRegex, "").trim() === "";
      if (!numericHeader && !cellIsNumeric) return;
      const categoricalPairs = pairs.filter(
        (_, pairIndex) =>
          pairIndex !== columnIndex && !numericToken(row[pairIndex] ?? ""),
      );
      const cellContext = `${header} ${cell} ${categoricalPairs.join(" ")}`;
      const category = categoryForClaim(
        header.toLowerCase() === "value" || /数值|结果/.test(header)
          ? rowContext
          : cellContext,
        match,
      );
      const comparable = comparableNumber(match, category.key, rowContext);
      if (!comparable) return;
      hits.push({
        key: category.key,
        value: match,
        file: source.name,
        line: rowIndex + 2,
        excerpt: rowContext,
        scope: metricKeys.has(category.key)
          ? nearestKeywordScope(cellContext, match)
          : undefined,
        qualifier: qualifierForContext(rowContext),
        comparable: comparable.value,
        tolerance: comparable.tolerance,
      });
    });
  });
  return hits;
}

function unstructuredSourceHits(source: EvidenceText) {
  const hits: SourceHit[] = [];
  source.text.split(/\r?\n/).forEach((lineText, lineIndex) => {
    [...lineText.matchAll(numberRegex)].forEach((match) => {
      const value = match[0];
      const matchIndex = match.index ?? 0;
      const localContext = lineText.slice(
        Math.max(0, matchIndex - 56),
        matchIndex + value.length + 56,
      );
      const category = categoryForClaim(localContext, value);
      const comparable = comparableNumber(value, category.key, localContext);
      if (!comparable) return;
      hits.push({
        key: category.key,
        value,
        file: source.name,
        line: lineIndex + 1,
        excerpt: lineText.trim(),
        scope: metricKeys.has(category.key)
          ? nearestKeywordScope(localContext, value)
          : undefined,
        qualifier: qualifierForContext(localContext),
        comparable: comparable.value,
        tolerance: comparable.tolerance,
      });
    });
  });
  return hits;
}

export function sourceEntries(sourceTexts: EvidenceText[]) {
  return sourceTexts.flatMap((source) => {
    const extension = source.name.split(".").pop()?.toLowerCase();
    if (extension === "csv" || extension === "tsv") {
      const structured = delimitedSourceHits(source);
      if (structured.length) return structured;
    }
    return unstructuredSourceHits(source);
  });
}

function sourceComparable(hit: SourceHit): ComparableNumber {
  return { value: hit.comparable, tolerance: hit.tolerance };
}

function distinctSourceValues(hits: SourceHit[]) {
  const distinct: SourceHit[] = [];
  hits.forEach((hit) => {
    if (
      !distinct.some((item) =>
        valuesEquivalent(sourceComparable(item), sourceComparable(hit)),
      )
    ) {
      distinct.push(hit);
    }
  });
  return distinct;
}

function getLineNumber(text: string, index: number) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function candidatesForClaim(
  hits: SourceHit[],
  key: string,
  scope?: string,
  qualifier?: string,
) {
  const semantic = hits.filter((hit) => hit.key === key);
  const scoped = scope
    ? semantic.filter((hit) => !hit.scope || hit.scope === scope)
    : semantic;
  const qualified = qualifier
    ? scoped.filter((hit) => !hit.qualifier || hit.qualifier === qualifier)
    : scoped;
  return qualified.length ? qualified : scoped.length ? scoped : semantic;
}

export function analyzeText(
  manuscriptText: string,
  sourceTexts: EvidenceText[],
): Claim[] {
  const hits = sourceEntries(sourceTexts);
  const claims: Claim[] = [];
  const sentences = [
    ...manuscriptText.matchAll(/[^\n。！？!?]+(?:[。！？!?]|$)/g),
  ];

  sentences.forEach((sentenceMatch) => {
    const sentence = sentenceMatch[0].trim();
    if (!sentence) return;

    [...sentence.matchAll(numberRegex)].forEach((valueMatch, valueIndex) => {
      const rawValue = valueMatch[0];
      const rawNumber = Number(numericToken(rawValue));
      if (!Number.isFinite(rawNumber)) return;

      const localIndex = valueMatch.index ?? 0;
      const localContext = sentence.slice(
        Math.max(0, localIndex - 56),
        localIndex + rawValue.length + 56,
      );
      const category = categoryForClaim(localContext, rawValue);
      const isLikelyYear =
        rawNumber >= 1900 &&
        rawNumber <= 2100 &&
        !/%|％|样本|n\s*=|准确|f1|auc|p\s*[<=>]/i.test(localContext);
      const isFigureNumber =
        rawNumber >= 0 &&
        rawNumber < 20 &&
        /^\s*(图|表|figure|fig\.?|table)\s*\d+/i.test(sentence);
      if (isLikelyYear || isFigureNumber) return;

      const comparable = comparableNumber(
        rawValue,
        category.key,
        localContext,
      );
      if (!comparable) return;
      const scope = metricKeys.has(category.key)
        ? nearestKeywordScope(localContext, rawValue)
        : undefined;
      const qualifier = qualifierForContext(localContext);
      const semanticHits = candidatesForClaim(
        hits,
        category.key,
        scope,
        qualifier,
      );
      const matchingSemantic = semanticHits.find((hit) =>
        valuesEquivalent(comparable, sourceComparable(hit)),
      );

      let status: ClaimStatus = "unverified";
      let severity: Severity =
        category.key === "numeric_claim" ? "low" : "medium";
      let reason = "未在已提供的证据文件中找到可确认的同指标数值。";
      let suggestion = "确认该数值的来源，并补充对应数据文件或表格锚点。";
      let source: SourceHit | undefined;

      if (matchingSemantic) {
        status = "supported";
        severity = "low";
        source = matchingSemantic;
        reason = `在 ${matchingSemantic.file} 中找到单位与精度归一化后相符的证据。`;
        suggestion = "已建立证据锚点，提交前仍建议人工复核上下文。";
      } else if (semanticHits.length > 0) {
        const distinctValues = distinctSourceValues(semanticHits);
        if (distinctValues.length === 1) {
          status = "conflict";
          severity = "high";
          source = distinctValues[0];
          reason = `证据文件中的${category.label}为 ${distinctValues[0].value}，与正文 ${rawValue} 超出舍入容差。`;
          suggestion = "回查原始分析输出，统一正文、摘要、表格和图注中的数值。";
        } else {
          source = distinctValues[0];
          reason = `找到多个${category.label}候选值（${distinctValues
            .slice(0, 4)
            .map((hit) => hit.value)
            .join("、")}），暂时无法安全确定对应实验。`;
          suggestion = "在稿件和数据表中补充模型、数据集或实验批次名称后重新核验。";
        }
      } else {
        const possible = hits.find((hit) =>
          valuesEquivalent(comparable, sourceComparable(hit)),
        );
        if (possible) {
          source = possible;
          reason = `在 ${possible.file} 中找到相同数值，但指标语义不一致，不能自动判定为支持。`;
          suggestion = "人工确认该来源行是否确实支持当前陈述。";
        }
      }

      const sentenceOffset = sentenceMatch.index ?? 0;
      claims.push({
        id: `${sentenceOffset}-${localIndex}-${valueIndex}`,
        key: category.key,
        label: category.label,
        value: rawValue,
        context: sentence,
        line: getLineNumber(manuscriptText, sentenceOffset),
        status,
        severity,
        reason,
        suggestion,
        scope,
        source,
      });
    });
  });

  const invariantKeys = new Set([
    "total_samples",
    "train_samples",
    "test_samples",
    "validation_samples",
    "runs",
  ]);
  const groups = new Map<string, Claim[]>();
  claims.forEach((claim) => {
    if (!invariantKeys.has(claim.key)) return;
    const groupKey = `${claim.key}:${claim.scope ?? "general"}`;
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), claim]);
  });

  groups.forEach((items) => {
    const distinct = new Set(
      items.map((item) => {
        const parsed = comparableNumber(item.value, item.key, item.context);
        return parsed?.value.toPrecision(12) ?? item.value;
      }),
    );
    if (distinct.size <= 1) return;
    items.forEach((item) => {
      if (item.status === "supported") return;
      item.status = "conflict";
      item.severity = "high";
      item.reason = `稿件内出现多个${item.label}值：${items
        .map((claim) => claim.value)
        .filter((value, index, values) => values.indexOf(value) === index)
        .join("、")}。${item.reason}`;
      item.suggestion = "先解决稿件内部冲突，再与源数据进行最终核对。";
    });
  });

  return claims;
}

export function scoreClaims(claims: Claim[]) {
  if (!claims.length) return 0;
  const severityWeight: Record<Severity, number> = {
    high: 3,
    medium: 2,
    low: 1,
  };
  const totalWeight = claims.reduce(
    (total, claim) => total + severityWeight[claim.severity],
    0,
  );
  const supportedWeight = claims.reduce((total, claim) => {
    const weight = severityWeight[claim.severity];
    if (claim.status === "supported") return total + weight;
    if (claim.status === "unverified") return total + weight * 0.25;
    return total;
  }, 0);
  return Math.round((supportedWeight / totalWeight) * 100);
}
