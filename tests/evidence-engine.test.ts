import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeText,
  comparableNumber,
  scoreClaims,
  sourceEntries,
  valuesEquivalent,
} from "../lib/evidence-engine.ts";

test("normalizes percentages, fractions, rounding, and latency units", () => {
  const percentage = comparableNumber("95.8%", "accuracy", "准确率 95.8%");
  const fraction = comparableNumber("0.9576", "accuracy", "accuracy=0.9576");
  const milliseconds = comparableNumber("18.4 ms", "latency", "延迟 18.4 ms");
  const seconds = comparableNumber(
    "0.0184",
    "latency",
    "metric=latency | value=0.0184 | unit=s",
  );

  assert.ok(percentage && fraction);
  assert.ok(milliseconds && seconds);
  assert.equal(valuesEquivalent(percentage, fraction), true);
  assert.equal(valuesEquivalent(milliseconds, seconds), true);
});

test("parses structured CSV rows and keeps their source line", () => {
  const hits = sourceEntries([
    {
      name: "results.csv",
      text: [
        "dataset,metric,value,unit",
        "dataset_1,accuracy,0.958,ratio",
        "dataset_1,latency,0.0184,s",
      ].join("\n"),
    },
  ]);

  const accuracy = hits.find((hit) => hit.key === "accuracy");
  const latency = hits.find((hit) => hit.key === "latency");
  assert.equal(accuracy?.line, 2);
  assert.equal(latency?.line, 3);
  assert.equal(
    hits.some((hit) => hit.value === "1" && hit.key === "numeric_claim"),
    false,
  );
});

test("supports equivalent values and flags a single-source mismatch", () => {
  const supported = analyzeText(
    "模型在测试集上的准确率为95.8%，推理延迟为18.4 ms。",
    [
      {
        name: "results.csv",
        text: [
          "metric,value,unit",
          "accuracy,0.9576,ratio",
          "latency,0.0184,s",
        ].join("\n"),
      },
    ],
  );
  assert.equal(
    supported.find((claim) => claim.key === "accuracy")?.status,
    "supported",
  );
  assert.equal(
    supported.find((claim) => claim.key === "latency")?.status,
    "supported",
  );

  const conflict = analyzeText("模型在测试集上的准确率为96.2%。", [
    {
      name: "results.csv",
      text: "metric,value,unit\naccuracy,95.8,percent",
    },
  ]);
  assert.equal(conflict[0]?.status, "conflict");
});

test("does not invent a conflict when multiple source candidates are ambiguous", () => {
  const claims = analyzeText("模型准确率为93.0%。", [
    {
      name: "multi-dataset.csv",
      text: [
        "dataset,metric,value",
        "dataset_a,accuracy,0.91",
        "dataset_b,accuracy,0.92",
      ].join("\n"),
    },
  ]);

  assert.equal(claims[0]?.status, "unverified");
  assert.match(claims[0]?.reason ?? "", /多个准确率候选值/);
});

test("does not mark different train and test metrics as an internal conflict", () => {
  const claims = analyzeText(
    "模型在训练集准确率为99.0%，在测试集准确率为95.0%。",
    [],
  );
  assert.equal(claims.length, 2);
  assert.deepEqual(
    claims.map((claim) => claim.status),
    ["unverified", "unverified"],
  );
  assert.notEqual(claims[0]?.scope, claims[1]?.scope);
});

test("detects manuscript-wide sample-count conflicts and computes a bounded score", () => {
  const claims = analyzeText(
    "本研究包含120个样本。最终纳入118个有效样本。",
    [],
  );
  assert.equal(claims.length, 2);
  assert.ok(claims.every((claim) => claim.status === "conflict"));
  const score = scoreClaims(claims);
  assert.ok(score >= 0 && score <= 100);
});

test("assigns total, train, and test sample counts to the nearest label", () => {
  const claims = analyzeText(
    "本研究包含120个样本，其中训练集80个，测试集40个。",
    [
      {
        name: "split.csv",
        text: [
          "metric,value,unit",
          "total_samples,120,count",
          "train_samples,80,count",
          "test_samples,40,count",
        ].join("\n"),
      },
    ],
  );

  assert.deepEqual(
    claims.map((claim) => claim.key),
    ["total_samples", "train_samples", "test_samples"],
  );
  assert.ok(claims.every((claim) => claim.status === "supported"));
});
