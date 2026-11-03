import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="section">
        <p className="eyebrow">404</p>
        <h1>This page could not be found.</h1>
        <p>The page may have moved. Explore MyCrobo from the home page.</p>
        <Link href="/" className="button">
          Back to home
        </Link>
      </main>
      <SiteFooter />
    </>
  );
}
