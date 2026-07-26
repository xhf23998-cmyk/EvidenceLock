import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.includes("localhost") ? "http" : "https");

  return {
    metadataBase: new URL(`${protocol}://${host}`),
    title: "EvidenceLock｜让每个数字找到证据",
    description:
      "在投稿前核对正文、图表与源数据，发现数字冲突、证据缺口和高风险陈述。",
    openGraph: {
      title: "EvidenceLock｜让每个数字找到证据",
      description: "科研交付物的证据链验收工具。",
      type: "website",
      locale: "zh_CN",
      images: [
        {
          url: "/og.png",
          width: 1536,
          height: 1024,
          alt: "EvidenceLock 科研证据链验收",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "EvidenceLock｜让每个数字找到证据",
      description: "投稿前，核对正文、图表与源数据。",
      images: ["/og.png"],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
