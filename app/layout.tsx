import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "晚晴 · 和她聊聊今天",
  description: "一个可以慢慢说话的地方。晚晴，AI 女友私享体验版。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
