import Image from "next/image";
import Link from "next/link";
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-brand">
        <Image
          src="/images/mycrobo-logo-light.webp"
          alt="MyCrobo"
          width={184}
          height={62}
          loading="lazy"
          decoding="async"
        />
        <p>
          {
            "Protecting founder focus through relationship-aware communication. Building toward a permissioned digital twin."
          }
        </p>
      </div>
      <div>
        <span>{"Explore"}</span>
        <Link href="/product/">{"Product"}</Link>
        <Link href="/product/#personal-autonomy">{"Personal Autonomy"}</Link>
        <Link href="/why-mycrobo/">{"Why MyCrobo"}</Link>
        <Link href="/vision/">{"Vision"}</Link>
      </div>
      <div>
        <span>{"Connect"}</span>
        <Link href="/contact/">{"Contact MyCrobo"}</Link>
        <Link href="/contact/">{"Join founder early access"}</Link>
      </div>
      <div className="footer-bottom">
        <span>{"© 2026 MyCrobo"}</span>
        <span>
          {"Built around human relationships. Designed to protect attention."}
        </span>
      </div>
    </footer>
  );
}
