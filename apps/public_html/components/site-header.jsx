"use client";
import { useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Menu, X } from "lucide-react";
import { OpenCloneButton } from "./open-clone-button";
const links = [
  ["/product/", "Product"],
  ["/why-mycrobo/", "Why MyCrobo"],
  ["/vision/", "Vision"],
  ["/contact/", "Contact"],
];
export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  return (
    <header className="site-header">
      <Link
        className="brand"
        href="/"
        aria-label="MyCrobo home"
        onClick={() => setOpen(false)}
      >
        <Image
          src="/images/mycrobo-logo.webp"
          alt="MyCrobo"
          width={172}
          height={58}
          priority
        />
      </Link>
      <nav
        id="primary-navigation"
        aria-label="Primary navigation"
        className={open ? "nav-open" : ""}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
      >
        {links.map(([href, label]) => {
          const current =
            pathname.replace(/\/$/, "") === href.slice(0, -1) ||
            (href === "/product/" &&
              pathname.replace(/\/$/, "") === "/control");
          return (
            <Link
              href={href}
              key={href}
              className={current ? "current" : ""}
              aria-current={current ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              {label}
            </Link>
          );
        })}
        <Link
          className="mobile-clone-cta"
          href="/app"
          onClick={() => setOpen(false)}
        >
          Sign In / App <ArrowRight size={15} />
        </Link>
      </nav>
      <div className="header-actions" style={{ gridColumn: 3, justifySelf: "end", display: "inline-flex", alignItems: "center", gap: "10px" }}>
        <Link href="/app" className="button button-small" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", background: "transparent", border: "1px solid rgba(20,40,29,0.35)", color: "#14281d", padding: "0 16px", minHeight: "38px", borderRadius: "999px", fontSize: "13px", fontWeight: "600", whiteSpace: "nowrap" }}>
          Meet MyCrobo
        </Link>
        <Link href="/app" className="button button-small header-cta" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", background: "#14281d", color: "#ffffff", padding: "0 18px", minHeight: "38px", borderRadius: "999px", fontSize: "13px", fontWeight: "700", whiteSpace: "nowrap" }}>
          Login <ArrowRight size={14} style={{ marginLeft: "4px" }} />
        </Link>
      </div>
      <button
        className="menu-button"
        type="button"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls="primary-navigation"
        onClick={() => setOpen(!open)}
      >
        {open ? <X size={21} /> : <Menu size={21} />}
      </button>
    </header>
  );
}
