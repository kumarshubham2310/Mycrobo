import fs from "node:fs";
import path from "node:path";
import { parse } from "parse5";
const root = process.cwd();
const put = (p, s) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s);
};
const chunks = "_next/static/chunks/";
// Recover the original client logic from the supplied deployment, replacing
// its bundled framework with the application's single React installation.
function recover(file) {
  let s = fs.readFileSync(chunks + file, "utf8");
  s = s.replace(
    /import\{([^}]+)\}from"\.\/rolldown-runtime[^" ]+";/g,
    (_, spec) =>
      spec
        .split(",")
        .map((x) => {
          const [name, alias] = x.trim().split(" as ");
          return name === "r"
            ? `const ${alias} = value => value;`
            : `const ${alias} = value => value;`;
        })
        .join("\n"),
  );
  s = s.replace(/import\{([^}]+)\}from"\.\/framework[^" ]+";/g, (_, spec) =>
    spec
      .split(",")
      .map((x) => {
        const [name, alias] = x.trim().split(" as ");
        return `import * as ${alias || name}Module from '${name === "i" ? "react" : "react/jsx-runtime"}'; const ${alias || name} = () => ${alias || name}Module;`;
      })
      .join("\n"),
  );
  s = s.replace(
    /import\{t as (\w+)\}from"\.\/createLucideIcon[^" ]+";/g,
    (_, alias) =>
      `import { createLucideIcon as ${alias} } from 'lucide-react';`,
  );
  s = s.replace(/from"\.\/([^" ]+)"/g, (_, dep) => {
    recover(dep);
    return `from './${dep}'`;
  });
  put("components/recovered/" + file, `'use client';\n${s}`);
}
for (const f of [
  "clone-preview-focus-9afb78fa6f.js",
  "relationship-demo-focus-9afb78fa6f.js",
  "contact-form-focus-9afb78fa6f.js",
])
  recover(f);
let tabs = fs.readFileSync(
  chunks + "attention-tabs-focus-9afb78fa6f.js",
  "utf8",
);
tabs = tabs.slice(tabs.indexOf("var Dr="));
put(
  "components/attention-tabs.jsx",
  `'use client';
import * as W from 'react/jsx-runtime';
import { Tabs } from '@base-ui/react/tabs';
import { UserRound as l, CircleCheck as a, Clock3 as s, Pause as c, BellRing as o } from 'lucide-react';
const Sr = Tabs.Root, wr = Tabs.List, Tr = Tabs.Tab, Er = Tabs.Panel;
${tabs}`,
);
fs.mkdirSync("public", { recursive: true });
for (const f of fs.readdirSync(root))
  if (f.endsWith(".png")) fs.copyFileSync(f, "public/" + f);
const css = fs.readFileSync(
  "_next/static/css/index-focus-9afb78fa6f.css",
  "utf8",
);
put(
  "app/globals.css",
  css +
    "\n:focus-visible{outline:2px solid #646b33;outline-offset:4px}.skip-link{position:fixed;top:-100px;left:16px;z-index:2000;background:white;padding:12px}.skip-link:focus{top:12px}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}\n",
);
const attributes = {
  class: "className",
  for: "htmlFor",
  tabindex: "tabIndex",
  readonly: "readOnly",
  autocomplete: "autoComplete",
  maxlength: "maxLength",
  fetchpriority: "fetchPriority",
  srcset: "srcSet",
  "stroke-width": "strokeWidth",
  "stroke-linecap": "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin",
  "fill-rule": "fillRule",
  "clip-rule": "clipRule",
  charset: "charSet",
};
const find = (n, fn) =>
  fn(n) ? n : (n.childNodes || []).map((c) => find(c, fn)).find(Boolean);
const attr = (n, k) => n.attrs?.find((a) => a.name === k)?.value;
let footer;
function jsx(n) {
  if (n.nodeName === "#text") return `{${JSON.stringify(n.value)}}`;
  if (!n.tagName || ["script", "link"].includes(n.tagName)) return "";
  const cls = attr(n, "class") || "";
  if (cls === "site-header") return "<SiteHeader />";
  if (cls === "site-footer") {
    if (!footer) {
      footer = n;
    }
    return "<SiteFooter />";
  }
  if (cls === "relationship-demo") return "<RelationshipDemo />";
  if (cls === "attention-board") return "<AttentionTabs />";
  if (n.tagName === "form" && cls === "contact-form") return "<ContactForm />";
  if (
    n.tagName === "button" &&
    (cls.includes("vision-step-trigger") ||
      n.childNodes?.some(
        (x) => x.nodeName === "#text" && x.value.includes("Meet MyCrobo"),
      ))
  )
    return `<OpenCloneButton className=${JSON.stringify(cls)}>${n.childNodes.map(jsx).join("")}</OpenCloneButton>`;
  let tag =
    n.tagName === "img"
      ? "Image"
      : n.tagName === "a" && attr(n, "href")?.startsWith("/")
        ? "Link"
        : n.tagName;
  let attrs = (n.attrs || [])
    .filter((a) => !["data-nimg", "srcset", "sizes"].includes(a.name))
    .map((a) => {
      let key = attributes[a.name] || a.name;
      if (key === "style") {
        const style = Object.fromEntries(
          a.value
            .split(";")
            .filter(Boolean)
            .map((pair) => {
              const at = pair.indexOf(":");
              return [
                pair
                  .slice(0, at)
                  .trim()
                  .replace(/-([a-z])/g, (_, c) => c.toUpperCase()),
                pair.slice(at + 1).trim(),
              ];
            }),
        );
        return `style={${JSON.stringify(style)}}`;
      }
      if (["required", "disabled", "multiple"].includes(key)) return key;
      if (tag === "Image" && ["width", "height"].includes(key))
        return `${key}={${Number(a.value)}}`;
      return `${key}=${JSON.stringify(a.value)}`;
    })
    .join(" ");
  if (tag === "Image" && !attr(n, "width")) attrs += ' fill sizes="100vw"';
  if (["Image", "input", "br", "hr", "meta"].includes(tag))
    return `<${tag} ${attrs} />`;
  return `<${tag} ${attrs}>${(n.childNodes || []).map(jsx).join("")}</${tag}>`;
}
const imports = `import Image from 'next/image';\nimport Link from 'next/link';\nimport { SiteHeader } from '@/components/site-header';\nimport { SiteFooter } from '@/components/site-footer';\nimport { OpenCloneButton } from '@/components/open-clone-button';\nimport { RelationshipDemo } from '@/components/recovered/relationship-demo-focus-9afb78fa6f';\nimport { ContactForm } from '@/components/recovered/contact-form-focus-9afb78fa6f';\nimport { AttentionTabs } from '@/components/attention-tabs';\n`;
const inventory = [];
for (const slug of [
  "",
  "product",
  "why-mycrobo",
  "vision",
  "contact",
  "control",
  "product/why-mycrobo",
]) {
  const doc = parse(fs.readFileSync((slug || "index") + ".html", "utf8"));
  const body = find(doc, (n) => n.tagName === "body");
  const title = find(doc, (n) => n.tagName === "title").childNodes[0].value;
  const description = attr(
    find(doc, (n) => n.tagName === "meta" && attr(n, "name") === "description"),
    "content",
  );
  const main = find(body, (n) => n.tagName === "main");
  main.attrs.push({ name: "id", value: "main-content" });
  const content = jsx(main);
  const url = "/" + (slug ? slug + "/" : "");
  const metadata = {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url },
    twitter: { title, description },
  };
  put(
    "app/" + (slug ? slug + "/" : "") + "page.jsx",
    imports +
      `\nexport const metadata = ${JSON.stringify(metadata)};\nexport default function Page(){return (${content});}\n`,
  );
  inventory.push({ route: url, title, description });
}
footer.attrs = footer.attrs.map((a) =>
  a.name === "class" ? { ...a, value: "site-footer" } : a,
);
const footerHtml = (() => {
  const original = footer.attrs;
  footer.attrs = [];
  const result = jsx(footer);
  footer.attrs = original;
  return result.replace("<footer ", '<footer className="site-footer" ');
})();
put(
  "components/site-footer.jsx",
  `import Image from 'next/image';\nimport Link from 'next/link';\nexport function SiteFooter(){return (${footerHtml});}`,
);
put("docs/routes.json", JSON.stringify(inventory, null, 2));
