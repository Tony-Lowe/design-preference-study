import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "设计图像偏好研究",
  description: "分别评价视觉美观与设计要求遵循，匿名保存您的判断。",
  other: {
    "codex-preview": "development",
  },
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
