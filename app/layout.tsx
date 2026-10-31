import type { Metadata } from "next";
import "./folio.css";

export const metadata: Metadata = {
  title: "Folio · Invoice decisions",
  description: "Read the invoice. Check the purchase. Keep the evidence.",
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
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
