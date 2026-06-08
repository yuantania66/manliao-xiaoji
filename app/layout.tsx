import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "新晴 2.0",
  description: "温暖治愈的情绪陪伴首页",
};

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
