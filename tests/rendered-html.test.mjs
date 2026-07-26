import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the EvidenceLock product shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /EvidenceLock/);
  assert.match(html, /og\.png/);
  assert.match(html, /description/i);
  assert.doesNotMatch(html, /Your site is taking shape|react-loading-skeleton/i);
});

test("ships the local-first analysis workflow without starter residue", async () => {
  const [page, layout, packageJson, engine, workflow] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../lib/evidence-engine.ts", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
  ]);

  assert.match(page, /mammoth/);
  assert.match(page, /pdfjs-dist/);
  assert.match(page, /loadSample/);
  assert.match(page, /exportReport/);
  assert.match(page, /MAX_FILE_SIZE/);
  assert.match(page, /cancelScan/);
  assert.match(page, /\.docx,\.pdf,\.txt,\.md,\.csv,\.tsv/);
  assert.match(engine, /valuesEquivalent/);
  assert.match(engine, /parseDelimitedLine/);
  assert.match(workflow, /actions\/checkout@v6/);
  assert.match(workflow, /npm test/);
  assert.match(layout, /\/og\.png/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await access(new URL("../public/og.png", import.meta.url));
  assert.deepEqual(
    await readdir(new URL("../app/_sites-preview", import.meta.url)),
    [],
  );
});
