# EvidenceLock

科研交付物的本地证据链验收工具。上传稿件和源数据后，EvidenceLock 会：

- 提取样本量、性能指标、P 值、单位等数值陈述；
- 在 CSV、TSV、DOCX、PDF、TXT 与 Markdown 文件中寻找证据锚点；
- 标记正文与证据之间的数值冲突；
- 输出按优先级排序、可下载的核验报告。

当前 MVP 在浏览器本地解析文件，不上传或留存未发表材料。

## 本地运行

需要 Node.js `>=22.13.0`。

```bash
npm install
npm run dev
```

打开开发服务显示的本地地址。生产构建使用：

```bash
npm run build
```

## 产品边界

EvidenceLock 用于发现值得人工关注的证据缺口，不判断研究真实性，也不替代作者、统计专家、编辑或审稿人的最终复核。
