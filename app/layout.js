import "./globals.css";

export const metadata = {
  title: "Video Creator Pipeline",
  description: "Run and monitor the video creator pipeline",
  icons: {
    icon: "/mascots/ai-ng-favicon.png",
    apple: "/mascots/ai-ng-favicon.png",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
