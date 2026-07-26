"use client";

import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Database,
  Download,
  FileSearch,
  FileSpreadsheet,
  FileText,
  Fingerprint,
  Lock,
  RotateCcw,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { ChangeEvent, DragEvent, useMemo, useRef, useState } from "react";

type Asset = {
  name: string;
  size: number;
  type: string;
  file?: File;
  text?: string;
};

type ClaimStatus = "supported" | "conflict" | "unverified";
type Severity = "high" | "medium" | "low";
type ClaimFilter = "all" | "issues" | "high" | "supported";

type SourceHit = {
  key: string;
  value: string;
  file: string;
  line: number;
  excerpt: string;
};

type Claim = {
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
  source?: SourceHit;
};

type ScanResult = {
  score: number;
  claims: Claim[];
  filesRead: number;
  checkedAt: string;
};

const ACCEPTED = ".docx,.pdf,.txt,.md,.csv,.tsv";

const SAMPLE_MANUSCRIPT = `多源信号融合模型的鲁棒性评估

摘要
本研究包含120个样本，并按照固定方案划分训练集与测试集。所提出模型在独立测试集上的准确率达到96.2%，宏平均F1为94.1%，表明该方法具有稳定的分类能力。

方法
实验共纳入120个有效样本，其中训练集80个，测试集38个。所有实验在相同随机种子下重复5次，报告五次实验的平均值。误差条表示标准差。

结果
如表2所示，模型在测试集上的准确率为95.8%，宏平均F1为94.1%。平均推理延迟为18.4 ms。与基线相比，性能提升具有统计学显著性（p=0.031）。

讨论
这些结果说明模型在全部场景中均优于现有方法，并可直接用于实际部署。`;

const SAMPLE_CSV = `metric,value,unit
total_samples,118,count
train_samples,80,count
test_samples,38,count
accuracy,95.8,percent
macro_f1,94.1,percent
runs,5,count
latency,18.4,ms
p_value,0.031,p`;

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileExtension(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function stripXml(xml: string) {
  const textarea =
    typeof document !== "undefined" ? document.createElement("textarea") : null;
  const withBreaks = xml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<\/w:tr>/g, "\n")
    .replace(/<\/w:tc>/g, "\t")
    .replace(/<[^>]+>/g, "");
  if (!textarea) return withBreaks;
  textarea.innerHTML = withBreaks;
  return textarea.value;
}

async function readAssetText(asset: Asset): Promise<string> {
  if (asset.text !== undefined) return asset.text;
  if (!asset.file) throw new Error(`无法读取 ${asset.name}`);

  const ext = fileExtension(asset.name);
  if (["txt", "md", "csv", "tsv"].includes(ext)) return asset.file.text();

  if (ext === "docx") {
    try {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({
        arrayBuffer: await asset.file.arrayBuffer(),
      });
      return result.value;
    } catch {
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(await asset.file.arrayBuffer());
      const documentXml = await zip
        .file("word/document.xml")
        ?.async("string");
      if (!documentXml) throw new Error("DOCX 中没有可读取的正文");
      return stripXml(documentXml);
    }
  }

  if (ext === "pdf") {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/legacy/build/pdf.worker.mjs",
      import.meta.url,
    ).toString();
    const pdf = await pdfjs.getDocument({
      data: new Uint8Array(await asset.file.arrayBuffer()),
      isEvalSupported: false,
    }).promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" "),
      );
    }
    return pages.join("\n");
  }

  throw new Error(`暂不支持 .${ext || "未知"} 文件`);
}

function normalizeNumber(value: string) {
  return value
    .trim()
    .replace(/,/g, "")
    .replace(/\s+/g, "")
    .replace(/％/g, "%")
    .toLowerCase();
}

function numericPart(value: string) {
  return normalizeNumber(value).replace(
    /(%|ms|s|hz|khz|mhz|gb|mb|kb|℃|°c|kg|mm|cm|例|个|次|组)$/i,
    "",
  );
}

function categoryForClaim(context: string, rawValue: string) {
  const text = context.toLowerCase();
  if (/宏平均\s*f1|macro[-\s_]?f1|macro\s+f1/.test(text)) {
    return { key: "macro_f1", label: "宏平均 F1" };
  }
  if (/准确率|accuracy|acc\b/.test(text)) {
    return { key: "accuracy", label: "准确率" };
  }
  if (/精确率|precision/.test(text)) {
    return { key: "precision", label: "精确率" };
  }
  if (/召回率|recall/.test(text)) {
    return { key: "recall", label: "召回率" };
  }
  if (/\bauc\b|曲线下面积/.test(text)) return { key: "auc", label: "AUC" };
  if (/测试集|test\s*(set|samples?)?/.test(text)) {
    return { key: "test_samples", label: "测试集样本" };
  }
  if (/训练集|train(ing)?\s*(set|samples?)?/.test(text)) {
    return { key: "train_samples", label: "训练集样本" };
  }
  if (/验证集|validation\s*(set|samples?)?/.test(text)) {
    return { key: "validation_samples", label: "验证集样本" };
  }
  if (
    /总样本|有效样本|纳入|包含|共计|样本量|participants?|subjects?/.test(
      text,
    )
  ) {
    return { key: "total_samples", label: "总样本量" };
  }
  if (/推理.*延迟|延迟|latency|inference\s*time/.test(text)) {
    return { key: "latency", label: "推理延迟" };
  }
  if (/重复|实验次数|runs?|trials?/.test(text)) {
    return { key: "runs", label: "重复次数" };
  }
  if (/p\s*[<=>]|p[_\s-]?value|显著性/.test(text)) {
    return { key: "p_value", label: "P 值" };
  }
  if (/%|％/.test(rawValue)) {
    return { key: "percentage", label: "百分比结果" };
  }
  return { key: "numeric_claim", label: "数值陈述" };
}

function getLineNumber(text: string, index: number) {
  return text.slice(0, index).split(/\r?\n/).length;
}

const numberRegex =
  /(?<![\w])(?:\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?:\s?(?:%|％|ms|s|Hz|kHz|MHz|GB|MB|KB|℃|°C|kg|mm|cm|例|个|次|组))?/gi;

function sourceEntries(sourceTexts: { asset: Asset; text: string }[]) {
  const semantic = new Map<string, SourceHit[]>();
  const exact = new Map<string, SourceHit[]>();

  sourceTexts.forEach(({ asset, text }) => {
    text.split(/\r?\n/).forEach((lineText, lineIndex) => {
      [...lineText.matchAll(numberRegex)].forEach((match) => {
        const value = match[0];
        const category = categoryForClaim(lineText, value);
        const hit: SourceHit = {
          key: category.key,
          value,
          file: asset.name,
          line: lineIndex + 1,
          excerpt: lineText.trim(),
        };
        semantic.set(category.key, [...(semantic.get(category.key) ?? []), hit]);
        const exactKey = numericPart(value);
        exact.set(exactKey, [...(exact.get(exactKey) ?? []), hit]);
      });
    });
  });
  return { semantic, exact };
}

function analyzeText(
  manuscriptText: string,
  sourceTexts: { asset: Asset; text: string }[],
): Claim[] {
  const { semantic, exact } = sourceEntries(sourceTexts);
  const claims: Claim[] = [];
  const sentences = [
    ...manuscriptText.matchAll(/[^\n。！？!?]+(?:[。！？!?]|$)/g),
  ];

  sentences.forEach((sentenceMatch) => {
    const sentence = sentenceMatch[0].trim();
    if (!sentence) return;

    [...sentence.matchAll(numberRegex)].forEach((valueMatch, valueIndex) => {
      const rawValue = valueMatch[0];
      const number = Number(numericPart(rawValue));
      if (!Number.isFinite(number)) return;

      const localIndex = valueMatch.index ?? 0;
      const localContext = sentence.slice(
        Math.max(0, localIndex - 24),
        localIndex + rawValue.length + 16,
      );
      const category = categoryForClaim(localContext, rawValue);
      const isLikelyYear =
        number >= 1900 &&
        number <= 2100 &&
        !/%|％|样本|n\s*=|准确|f1|auc|p\s*[<=>]/i.test(localContext);
      const isFigureNumber =
        number < 20 &&
        /^\s*(图|表|figure|fig\.?|table)\s*\d+/i.test(sentence);
      if (isLikelyYear || isFigureNumber) return;

      const semanticHits = semantic.get(category.key) ?? [];
      const exactHits = exact.get(numericPart(rawValue)) ?? [];
      const matchingSemantic = semanticHits.find(
        (hit) => numericPart(hit.value) === numericPart(rawValue),
      );

      let status: ClaimStatus = "unverified";
      let severity: Severity =
        category.key === "numeric_claim" ? "low" : "medium";
      let reason = "未在已提供的证据文件中找到相同数值。";
      let suggestion = "确认该数值的来源，并补充对应数据文件或表格锚点。";
      let source: SourceHit | undefined;

      if (matchingSemantic) {
        status = "supported";
        severity = "low";
        source = matchingSemantic;
        reason = `在 ${matchingSemantic.file} 中找到语义一致的数值。`;
        suggestion = "已建立证据锚点，提交前仍建议人工复核上下文。";
      } else if (semanticHits.length > 0) {
        status = "conflict";
        severity = "high";
        source = semanticHits[0];
        reason = `证据文件中的${category.label}为 ${semanticHits[0].value}，与正文 ${rawValue} 不一致。`;
        suggestion = "回查原始分析输出，统一正文、摘要、表格和图注中的数值。";
      } else if (exactHits.length > 0) {
        status = "supported";
        severity = "low";
        source = exactHits[0];
        reason = `在 ${exactHits[0].file} 中找到相同数值，但语义标签需要人工确认。`;
        suggestion = "检查来源行是否确实支持当前句子的含义。";
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
        source,
      });
    });
  });

  const groups = new Map<string, Claim[]>();
  claims.forEach((claim) => {
    if (claim.key === "numeric_claim" || claim.key === "percentage") return;
    groups.set(claim.key, [...(groups.get(claim.key) ?? []), claim]);
  });

  groups.forEach((items) => {
    const distinct = new Set(items.map((item) => numericPart(item.value)));
    if (distinct.size <= 1) return;
    items.forEach((item) => {
      if (item.status === "supported") return;
      item.status = "conflict";
      item.severity = "high";
      item.reason = `稿件内出现多个${item.label}值：${[...distinct].join("、")}。${item.reason}`;
      item.suggestion = "先解决稿件内部冲突，再与源数据进行最终核对。";
    });
  });
  return claims;
}

function scoreClaims(claims: Claim[]) {
  const penalty = claims.reduce((total, claim) => {
    if (claim.status === "supported") return total;
    if (claim.severity === "high") return total + 16;
    if (claim.severity === "medium") return total + 7;
    return total + 2;
  }, 0);
  return Math.max(12, Math.min(100, 100 - penalty));
}

function statusLabel(status: ClaimStatus) {
  if (status === "supported") return "已找到证据";
  if (status === "conflict") return "数值冲突";
  return "待补充证据";
}

function severityLabel(severity: Severity) {
  if (severity === "high") return "高优先级";
  if (severity === "medium") return "需复核";
  return "提示";
}

export default function Home() {
  const manuscriptInput = useRef<HTMLInputElement>(null);
  const [manuscript, setManuscript] = useState<Asset | null>(null);
  const [evidence, setEvidence] = useState<Asset[]>([]);
  const [phase, setPhase] = useState<
    "idle" | "ready" | "scanning" | "done"
  >("idle");
  const [scanStep, setScanStep] = useState(0);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [filter, setFilter] = useState<ClaimFilter>("all");
  const [error, setError] = useState("");

  const filteredClaims = useMemo(() => {
    if (!result) return [];
    if (filter === "issues") {
      return result.claims.filter((claim) => claim.status !== "supported");
    }
    if (filter === "high") {
      return result.claims.filter(
        (claim) =>
          claim.status !== "supported" && claim.severity === "high",
      );
    }
    if (filter === "supported") {
      return result.claims.filter((claim) => claim.status === "supported");
    }
    return result.claims;
  }, [filter, result]);

  const metrics = useMemo(() => {
    const claims = result?.claims ?? [];
    return {
      high: claims.filter(
        (claim) =>
          claim.status !== "supported" && claim.severity === "high",
      ).length,
      unverified: claims.filter((claim) => claim.status === "unverified").length,
      supported: claims.filter((claim) => claim.status === "supported").length,
    };
  }, [result]);

  function toAssets(files: FileList | File[]) {
    return Array.from(files)
      .filter((file) =>
        ["docx", "pdf", "txt", "md", "csv", "tsv"].includes(
          fileExtension(file.name),
        ),
      )
      .map((file) => ({
        name: file.name,
        size: file.size,
        type: file.type,
        file,
      }));
  }

  function handleManuscript(files: FileList | File[]) {
    const [first] = toAssets(files);
    if (!first) {
      setError("请选择 DOCX、PDF、TXT 或 Markdown 文件。");
      return;
    }
    setManuscript(first);
    setResult(null);
    setPhase("ready");
    setError("");
  }

  function handleEvidence(files: FileList | File[]) {
    const next = toAssets(files);
    if (!next.length) {
      setError("请选择 CSV、TSV、TXT、DOCX 或 PDF 证据文件。");
      return;
    }
    setEvidence((current) => [
      ...current,
      ...next.filter(
        (asset) => !current.some((item) => item.name === asset.name),
      ),
    ]);
    setResult(null);
    setPhase(manuscript ? "ready" : "idle");
    setError("");
  }

  function onDrop(
    event: DragEvent<HTMLLabelElement>,
    handler: (files: File[]) => void,
  ) {
    event.preventDefault();
    handler(Array.from(event.dataTransfer.files));
  }

  async function runScan(
    selectedManuscript = manuscript,
    selectedEvidence = evidence,
  ) {
    if (!selectedManuscript) {
      setError("请先添加一份待核验稿件。");
      manuscriptInput.current?.click();
      return;
    }
    setError("");
    setPhase("scanning");
    setScanStep(0);

    try {
      const manuscriptText = await readAssetText(selectedManuscript);
      setScanStep(1);
      await new Promise((resolve) => setTimeout(resolve, 280));
      const sourceTexts = await Promise.all(
        selectedEvidence.map(async (asset) => ({
          asset,
          text: await readAssetText(asset),
        })),
      );
      setScanStep(2);
      await new Promise((resolve) => setTimeout(resolve, 320));
      const claims = analyzeText(manuscriptText, sourceTexts);
      setScanStep(3);
      await new Promise((resolve) => setTimeout(resolve, 360));
      if (!claims.length) {
        throw new Error("没有识别到可核验的数值陈述，请换一份包含结果数据的稿件。");
      }
      setResult({
        score: scoreClaims(claims),
        claims,
        filesRead: selectedEvidence.length + 1,
        checkedAt: new Intl.DateTimeFormat("zh-CN", {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date()),
      });
      setFilter("all");
      setPhase("done");
      requestAnimationFrame(() => {
        document
          .getElementById("scan-report")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch (scanError) {
      setError(
        scanError instanceof Error ? scanError.message : "核验过程中发生错误。",
      );
      setPhase("ready");
    }
  }

  async function loadSample() {
    const sampleManuscript: Asset = {
      name: "robustness_study_draft.md",
      size: SAMPLE_MANUSCRIPT.length,
      type: "text/markdown",
      text: SAMPLE_MANUSCRIPT,
    };
    const sampleEvidence: Asset[] = [
      {
        name: "experiment_summary.csv",
        size: SAMPLE_CSV.length,
        type: "text/csv",
        text: SAMPLE_CSV,
      },
    ];
    setManuscript(sampleManuscript);
    setEvidence(sampleEvidence);
    await runScan(sampleManuscript, sampleEvidence);
  }

  function resetScan() {
    setManuscript(null);
    setEvidence([]);
    setResult(null);
    setError("");
    setPhase("idle");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function exportReport() {
    if (!result || !manuscript) return;
    const lines = [
      "# EvidenceLock 核验报告",
      "",
      `- 稿件：${manuscript.name}`,
      `- 证据文件：${evidence.map((item) => item.name).join("、") || "未提供"}`,
      `- 证据完整度：${result.score}/100`,
      `- 核验时间：${result.checkedAt}`,
      "",
      "## 核验结果",
      "",
      ...result.claims.flatMap((claim, index) => [
        `### ${index + 1}. ${claim.label} · ${claim.value}`,
        "",
        `- 状态：${statusLabel(claim.status)}`,
        `- 优先级：${severityLabel(claim.severity)}`,
        `- 稿件位置：第 ${claim.line} 行`,
        `- 原文：${claim.context}`,
        `- 判断：${claim.reason}`,
        `- 建议：${claim.suggestion}`,
        claim.source
          ? `- 证据：${claim.source.file} 第 ${claim.source.line} 行 — ${claim.source.excerpt}`
          : "- 证据：未建立",
        "",
      ]),
      "---",
      "本报告由 EvidenceLock 在浏览器本地生成，仅用于辅助人工复核。",
    ];
    const blob = new Blob([lines.join("\n")], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `EvidenceLock-${manuscript.name.replace(/\.[^.]+$/, "")}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const scanSteps = [
    "读取稿件结构与正文",
    "建立源数据数值索引",
    "连接陈述与证据锚点",
    "生成风险优先级报告",
  ];

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#" aria-label="EvidenceLock 首页">
          <span className="brand-mark" aria-hidden="true">
            <Fingerprint size={19} strokeWidth={1.8} />
          </span>
          <span>EvidenceLock</span>
        </a>
        <nav className="desktop-nav" aria-label="主导航">
          <a href="#why">为什么需要</a>
          <a href="#workflow">工作方式</a>
          <a href="#privacy">隐私</a>
        </nav>
        <a className="header-cta" href="#workspace">
          开始核验
          <ArrowRight size={15} />
        </a>
      </header>

      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-grid" aria-hidden="true" />
        <div className="hero-copy">
          <p className="eyebrow">
            <span className="live-dot" />
            科研交付物的证据链验收
          </p>
          <h1 id="hero-title">
            让每个数字
            <span>找到证据。</span>
          </h1>
          <p className="hero-lede">
            投稿之前，自动核对正文、图表与源数据。EvidenceLock
            找出数字冲突、证据缺口和被忽略的高风险陈述。
          </p>
          <div className="hero-actions">
            <a className="primary-button" href="#workspace">
              核验我的稿件
              <ArrowRight size={17} />
            </a>
            <button className="text-button" type="button" onClick={loadSample}>
              <Sparkles size={16} />
              查看真实示例
            </button>
          </div>
          <div className="trust-row">
            <span>
              <Lock size={14} />
              本地解析
            </span>
            <span>
              <ShieldCheck size={14} />
              不保存稿件
            </span>
            <span>
              <FileSearch size={14} />
              逐条显示证据
            </span>
          </div>
        </div>

        <div className="hero-proof" aria-label="证据核验示例">
          <div className="proof-topline">
            <span>稿件核验 / 运行中</span>
            <span className="proof-status">
              <i />
              LOCAL
            </span>
          </div>
          <div className="proof-score">
            <div>
              <span>证据完整度</span>
              <strong>72</strong>
              <small>/100</small>
            </div>
            <div className="score-orbit" aria-hidden="true">
              <span>72%</span>
            </div>
          </div>
          <div className="proof-claim claim-danger">
            <div className="claim-line">
              <AlertTriangle size={16} />
              <span>准确率</span>
              <strong>96.2%</strong>
            </div>
            <p>源数据记录为 95.8%，正文与表格不一致。</p>
            <div className="claim-link">
              <span>稿件 · 第 4 行</span>
              <ChevronRight size={14} />
              <span>summary.csv · 第 5 行</span>
            </div>
          </div>
          <div className="proof-claim claim-safe">
            <div className="claim-line">
              <CheckCircle2 size={16} />
              <span>宏平均 F1</span>
              <strong>94.1%</strong>
            </div>
            <p>已在实验汇总表中找到同值证据。</p>
          </div>
          <div className="proof-footer">
            <span>8 条已核验</span>
            <span>2 条高优先级</span>
          </div>
        </div>
      </section>

      <section className="workspace-section" id="workspace">
        <div className="section-kicker">
          <span>01</span>
          工作台
        </div>
        <div className="workspace-heading">
          <div>
            <h2>把稿件和证据放在一起</h2>
            <p>支持 DOCX、PDF、CSV、TSV、TXT 和 Markdown，单次本地处理。</p>
          </div>
          <div className="privacy-chip">
            <Lock size={14} />
            文件不会离开此设备
          </div>
        </div>

        {phase !== "done" && (
          <div className="workspace-card">
            <div className="upload-grid">
              <UploadColumn
                title="待核验稿件"
                subtitle="正文、报告或回复信"
                step="1"
              >
                {!manuscript ? (
                  <DropZone
                    accept=".docx,.pdf,.txt,.md"
                    icon="manuscript"
                    title="拖入一份稿件"
                    subtitle="或点击选择文件"
                    note="DOCX · PDF · TXT · MD"
                    inputRef={manuscriptInput}
                    onFiles={handleManuscript}
                    onDrop={onDrop}
                  />
                ) : (
                  <AssetCard
                    asset={manuscript}
                    large
                    onRemove={() => {
                      setManuscript(null);
                      setPhase("idle");
                    }}
                  />
                )}
              </UploadColumn>

              <div className="upload-connector" aria-hidden="true">
                <span />
                <ChevronRight size={18} />
                <span />
              </div>

              <UploadColumn
                title="证据文件"
                subtitle="源数据、表格或补充材料"
                step="2"
              >
                <DropZone
                  accept={ACCEPTED}
                  icon="evidence"
                  title={evidence.length ? "继续添加证据" : "拖入证据文件"}
                  subtitle="CSV、表格或补充材料"
                  note={evidence.length ? "" : "可多选 · 无需上传云端"}
                  compact={!!evidence.length}
                  multiple
                  onFiles={handleEvidence}
                  onDrop={onDrop}
                />
                {!!evidence.length && (
                  <div className="evidence-list">
                    {evidence.map((asset) => (
                      <AssetCard
                        asset={asset}
                        key={asset.name}
                        onRemove={() =>
                          setEvidence((items) =>
                            items.filter((item) => item.name !== asset.name),
                          )
                        }
                      />
                    ))}
                  </div>
                )}
              </UploadColumn>
            </div>

            {error && (
              <div className="error-banner" role="alert">
                <AlertTriangle size={16} />
                {error}
              </div>
            )}

            {phase === "scanning" ? (
              <div className="scan-progress">
                <div className="scan-animation" aria-hidden="true">
                  <ScanSearch size={23} />
                  <span />
                </div>
                <div className="scan-progress-copy">
                  <strong>{scanSteps[scanStep]}</strong>
                  <span>
                    第 {Math.min(scanStep + 1, scanSteps.length)} /{" "}
                    {scanSteps.length} 步
                  </span>
                </div>
                <div className="progress-track">
                  <span
                    style={{
                      width: `${((scanStep + 1) / scanSteps.length) * 100}%`,
                    }}
                  />
                </div>
              </div>
            ) : (
              <div className="workspace-actions">
                <button
                  className="sample-button"
                  type="button"
                  onClick={loadSample}
                >
                  <Sparkles size={16} />
                  载入演示材料
                </button>
                <button
                  className="scan-button"
                  type="button"
                  onClick={() => runScan()}
                  disabled={!manuscript}
                >
                  <ScanSearch size={18} />
                  开始证据链核验
                  <ArrowRight size={17} />
                </button>
              </div>
            )}
          </div>
        )}

        {phase === "done" && result && (
          <div className="report" id="scan-report">
            <div className="report-header">
              <div className="report-score-block">
                <div
                  className={`report-score ${result.score < 70 ? "score-risk" : ""}`}
                >
                  <strong>{result.score}</strong>
                  <span>/100</span>
                </div>
                <div>
                  <p className="report-overline">证据完整度</p>
                  <h3>
                    {result.score >= 85
                      ? "证据链整体稳定"
                      : result.score >= 70
                        ? "存在需要复核的缺口"
                        : "提交前建议优先修正"}
                  </h3>
                  <p>
                    已读取 {result.filesRead} 个文件，识别{" "}
                    {result.claims.length} 条数值陈述 · {result.checkedAt}
                  </p>
                </div>
              </div>
              <div className="report-actions">
                <button type="button" onClick={exportReport}>
                  <Download size={16} />
                  导出报告
                </button>
                <button type="button" onClick={resetScan}>
                  <RotateCcw size={16} />
                  新建核验
                </button>
              </div>
            </div>

            <div className="metric-strip">
              <MetricButton
                active={filter === "high"}
                icon="danger"
                value={metrics.high}
                label="高优先级冲突"
                onClick={() => setFilter("high")}
              />
              <MetricButton
                active={filter === "issues"}
                icon="warning"
                value={metrics.unverified}
                label="未建立证据"
                onClick={() => setFilter("issues")}
              />
              <MetricButton
                active={filter === "supported"}
                icon="success"
                value={metrics.supported}
                label="已找到证据"
                onClick={() => setFilter("supported")}
              />
            </div>

            <div className="report-toolbar">
              <div className="filter-tabs" aria-label="筛选核验结果">
                {(
                  [
                    ["all", "全部"],
                    ["issues", "仅看问题"],
                    ["high", "高优先级"],
                    ["supported", "已支持"],
                  ] as [ClaimFilter, string][]
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={filter === value ? "active" : ""}
                    onClick={() => setFilter(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <span>显示 {filteredClaims.length} 条</span>
            </div>

            <div className="claim-list">
              {filteredClaims.map((claim) => (
                <ClaimRow claim={claim} key={claim.id} />
              ))}
              {!filteredClaims.length && (
                <div className="empty-filter">
                  <CheckCircle2 size={26} />
                  <strong>此筛选条件下没有问题</strong>
                  <span>换一个筛选项查看完整结果。</span>
                </div>
              )}
            </div>

            <div className="report-disclaimer">
              <ShieldCheck size={17} />
              EvidenceLock
              负责发现值得人工关注的信号，不判断研究真实性，也不替代作者、统计专家或审稿人的最终复核。
            </div>
          </div>
        )}
      </section>

      <section className="why-section" id="why">
        <div className="section-kicker light">
          <span>02</span>
          为什么需要
        </div>
        <div className="why-heading">
          <h2>
            写作变快了，
            <br />
            验收不能只靠感觉。
          </h2>
          <p>
            通用 AI 擅长生成流畅文本，却不会自动证明每条陈述来自哪里。
            EvidenceLock 把最终稿重新连接到源数据。
          </p>
        </div>
        <div className="feature-grid">
          <FeatureCard
            index="A"
            icon={<FileSearch size={25} />}
            title="逐条核验，不给黑箱总分"
            body="每个风险都显示稿件原文、来源文件、具体行号与建议动作。"
          />
          <FeatureCard
            index="B"
            icon={<Database size={25} />}
            title="跨文件寻找数值冲突"
            body="把摘要、正文、表格和 CSV 放在同一条证据链上比较。"
          />
          <FeatureCard
            index="C"
            icon={<Lock size={25} />}
            title="未发表材料留在本机"
            body="当前版本在浏览器内完成解析，不上传、不留存、不用于训练。"
            id="privacy"
          />
        </div>
      </section>

      <section className="workflow-section" id="workflow">
        <div className="section-kicker">
          <span>03</span>
          工作方式
        </div>
        <div className="workflow-layout">
          <div className="workflow-copy">
            <p className="eyebrow dark">从文件到可执行修改清单</p>
            <h2>不是替你下结论，而是告诉你先查哪里。</h2>
            <p>
              规则检查负责找数字，语义映射负责连接上下文，最终由作者确认。
              这是一道提交前的质量门，而不是新的写作机器人。
            </p>
          </div>
          <ol className="workflow-steps">
            <WorkflowStep
              number="01"
              title="提取"
              body="识别稿件中的样本量、指标、P 值、单位和其他关键数值。"
            />
            <WorkflowStep
              number="02"
              title="连接"
              body="在数据表和补充材料中寻找语义与数值一致的证据锚点。"
            />
            <WorkflowStep
              number="03"
              title="排序"
              body="按冲突、缺证和已支持分类，优先呈现可能影响提交的问题。"
            />
          </ol>
        </div>
      </section>

      <section className="closing-cta">
        <div>
          <p>Evidence before confidence.</p>
          <h2>在提交按钮之前，多一道可靠的检查。</h2>
        </div>
        <a href="#workspace">
          开始一次本地核验
          <ArrowRight size={18} />
        </a>
      </section>

      <footer>
        <div className="brand footer-brand">
          <span className="brand-mark" aria-hidden="true">
            <Fingerprint size={18} strokeWidth={1.8} />
          </span>
          <span>EvidenceLock</span>
        </div>
        <p>科研交付物的本地证据链验收工具 · MVP 01</p>
        <span>辅助复核，不替代专业判断</span>
      </footer>
    </main>
  );
}

function UploadColumn({
  title,
  subtitle,
  step,
  children,
}: {
  title: string;
  subtitle: string;
  step: string;
  children: React.ReactNode;
}) {
  return (
    <div className="upload-column">
      <div className="upload-label">
        <span className="step-number">{step}</span>
        <div>
          <strong>{title}</strong>
          <small>{subtitle}</small>
        </div>
      </div>
      {children}
    </div>
  );
}

function DropZone({
  accept,
  icon,
  title,
  subtitle,
  note,
  compact,
  multiple,
  inputRef,
  onFiles,
  onDrop,
}: {
  accept: string;
  icon: "manuscript" | "evidence";
  title: string;
  subtitle: string;
  note: string;
  compact?: boolean;
  multiple?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  onFiles: (files: FileList | File[]) => void;
  onDrop: (
    event: DragEvent<HTMLLabelElement>,
    handler: (files: File[]) => void,
  ) => void;
}) {
  return (
    <label
      className={`drop-zone ${compact ? "compact-zone" : ""}`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => onDrop(event, onFiles)}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={(event: ChangeEvent<HTMLInputElement>) =>
          event.target.files && onFiles(event.target.files)
        }
      />
      <span className="drop-icon">
        {icon === "manuscript" ? (
          <Upload size={22} />
        ) : (
          <Database size={22} />
        )}
      </span>
      <strong>{title}</strong>
      <span>{subtitle}</span>
      {note && <small>{note}</small>}
    </label>
  );
}

function AssetCard({
  asset,
  large,
  onRemove,
}: {
  asset: Asset;
  large?: boolean;
  onRemove: () => void;
}) {
  const Icon =
    fileExtension(asset.name) === "csv" ||
    fileExtension(asset.name) === "tsv"
      ? FileSpreadsheet
      : FileText;
  return (
    <div className={`file-card ${large ? "primary-file" : ""}`}>
      <Icon size={large ? 22 : 18} />
      <div>
        <strong>{asset.name}</strong>
        <span>{formatBytes(asset.size)}</span>
      </div>
      <button
        type="button"
        aria-label={`移除 ${asset.name}`}
        onClick={onRemove}
      >
        <X size={16} />
      </button>
    </div>
  );
}

function MetricButton({
  active,
  icon,
  value,
  label,
  onClick,
}: {
  active: boolean;
  icon: "danger" | "warning" | "success";
  value: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={active ? "active" : ""} onClick={onClick}>
      <span className={`metric-icon ${icon}`}>
        {icon === "success" ? (
          <CheckCircle2 size={17} />
        ) : (
          <AlertTriangle size={17} />
        )}
      </span>
      <span>
        <strong>{value}</strong>
        {label}
      </span>
    </button>
  );
}

function ClaimRow({ claim }: { claim: Claim }) {
  return (
    <details className={`result-claim ${claim.status}`}>
      <summary>
        <span className="result-status-icon">
          {claim.status === "supported" ? (
            <Check size={17} />
          ) : (
            <AlertTriangle size={17} />
          )}
        </span>
        <span className="result-main">
          <span className="result-labels">
            <span>{claim.label}</span>
            <small>{severityLabel(claim.severity)}</small>
          </span>
          <strong>{claim.value}</strong>
          <p>{claim.context}</p>
        </span>
        <span className="result-side">
          <span>{statusLabel(claim.status)}</span>
          <small>稿件第 {claim.line} 行</small>
        </span>
        <ChevronRight className="result-chevron" size={18} />
      </summary>
      <div className="claim-detail">
        <div>
          <span className="detail-label">核验判断</span>
          <p>{claim.reason}</p>
        </div>
        <div>
          <span className="detail-label">建议动作</span>
          <p>{claim.suggestion}</p>
        </div>
        <div className="evidence-anchor">
          <span className="detail-label">证据锚点</span>
          {claim.source ? (
            <div>
              <FileSpreadsheet size={17} />
              <span>
                <strong>{claim.source.file}</strong>
                第 {claim.source.line} 行 · {claim.source.excerpt}
              </span>
            </div>
          ) : (
            <div className="missing-anchor">
              <FileSearch size={17} />
              <span>尚未在所提供文件中建立证据锚点</span>
            </div>
          )}
        </div>
      </div>
    </details>
  );
}

function FeatureCard({
  index,
  icon,
  title,
  body,
  id,
}: {
  index: string;
  icon: React.ReactNode;
  title: string;
  body: string;
  id?: string;
}) {
  return (
    <article id={id}>
      <span className="feature-index">{index}</span>
      {icon}
      <h3>{title}</h3>
      <p>{body}</p>
    </article>
  );
}

function WorkflowStep({
  number,
  title,
  body,
}: {
  number: string;
  title: string;
  body: string;
}) {
  return (
    <li>
      <span>{number}</span>
      <div>
        <strong>{title}</strong>
        <p>{body}</p>
      </div>
    </li>
  );
}
