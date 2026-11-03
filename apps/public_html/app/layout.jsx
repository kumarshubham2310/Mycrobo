import "./globals.css";
import { PreviewLauncher } from "@/components/preview-launcher";

export const metadata = {
  metadataBase: new URL("https://mycrobo.com"),
  applicationName: "MyCrobo",
  title: "MyCrobo — Stay focused. Stay present.",
  description: "Relationship-aware AI designed to protect founder focus.",
  robots: { index: true, follow: true },
  icons: { icon: "/mycrobo-mark.png" },
  openGraph: {
    siteName: "MyCrobo",
    type: "website",
    images: [
      { url: "/mycrobo-social.png", width: 1600, height: 900, alt: "MyCrobo" },
    ],
  },
  twitter: { card: "summary_large_image", images: ["/mycrobo-social.png"] },
};
export const viewport = { themeColor: "#34363a", colorScheme: "light" };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        {children}
        <PreviewLauncher />
      </body>
    </html>
  );
}
