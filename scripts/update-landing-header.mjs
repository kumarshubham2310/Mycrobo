import { readFileSync, writeFileSync, readdirSync, statSync, cpSync } from "node:fs";
import { resolve, join } from "node:path";

const root = resolve("apps/public_html");
const legacyDir = resolve(root, "legacy-export");
const chunksDir = resolve(legacyDir, "_next/static/chunks");

// 1. Single, clean Login button for the header
const headerLoginCta = `<a class="button button-small header-cta" href="/app" style="text-decoration:none;display:inline-flex;align-items:center;">Login <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-right" aria-hidden="true" style="margin-left:4px;"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg></a>`;

const oldMobile = `<button class="mobile-clone-cta" type="button">Meet MyCrobo <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-right" aria-hidden="true"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg></button>`;
const newMobile = `<a class="mobile-clone-cta" href="/app">Login / App <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-right" aria-hidden="true"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg></a>`;

const oldHero = `<button class="button" type="button">Meet MyCrobo <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-right" aria-hidden="true"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg></button>`;
const newHero = `<a class="button" href="/app" style="text-decoration:none;display:inline-flex;align-items:center;">Meet MyCrobo <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-right" aria-hidden="true" style="margin-left:4px;"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg></a>`;

const oldMenu = `<button class="menu-button" type="button" aria-label="Open menu">`;
const newMenu = `<button class="menu-button" type="button" aria-label="Open menu" onclick="document.querySelector('.site-header nav').classList.toggle('nav-open')">`;

// Update all HTML files
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== "_next") walk(full);
    } else if (full.endsWith(".html")) {
      let content = readFileSync(full, "utf8");
      let changed = false;

      // Clean up previous header-actions wrapper or duplicate buttons in <header>
      content = content.replace(
        /<header class="site-header">([\s\S]*?)<\/header>/u,
        (match, inner) => {
          // Replace any variation of the CTA buttons between </nav> and <button class="menu-button"
          const updatedInner = inner.replace(
            /(<\/nav>)[\s\S]*?(<button class="menu-button")/u,
            `$1${headerLoginCta}$2`
          );
          if (updatedInner !== inner) changed = true;
          return `<header class="site-header">${updatedInner}</header>`;
        }
      );

      // Clean up any injected custom-header-fix style tag
      if (content.includes('id="custom-header-fix"')) {
        content = content.replace(/<style id="custom-header-fix">[\s\S]*?<\/style>/u, "");
        changed = true;
      }

      if (content.includes(oldMobile)) {
        content = content.replaceAll(oldMobile, newMobile);
        changed = true;
      }
      if (content.includes(oldHero)) {
        content = content.replaceAll(oldHero, newHero);
        changed = true;
      }
      if (content.includes(oldMenu)) {
        content = content.replaceAll(oldMenu, newMenu);
        changed = true;
      }

      if (changed) {
        writeFileSync(full, content, "utf8");
        console.log("Updated HTML:", full);
      }
    }
  }
}

// Update JS Chunks so React hydration also outputs a clean Login button
function updateChunks() {
  if (!readdirSync(chunksDir)) return;
  for (const entry of readdirSync(chunksDir)) {
    const full = join(chunksDir, entry);
    if (entry.startsWith("open-clone-button-") && entry.endsWith(".js")) {
      const newJs = 'import{r as e}from"./framework-D_rUT4EX.js";var t=e();function n({children:e,className:n,onOpen:r}){return(0,t.jsx)(`a`,{href:`/app`,className:n,style:{textDecoration:`none`,display:`inline-flex`,alignItems:`center`},onClick:()=>{r?.()},children:e})}export{n as OpenCloneButton};';
      writeFileSync(full, newJs, "utf8");
      console.log("Updated open-clone-button chunk:", entry);
    } else if (entry.startsWith("site-header-") && entry.endsWith(".js")) {
      let content = readFileSync(full, "utf8");
      let changed = false;
      // Change header-cta label to Login
      if (content.includes(`className:\`button button-small header-cta\`,children:[\`Meet MyCrobo \``)) {
        content = content.replaceAll(
          `className:\`button button-small header-cta\`,children:[\`Meet MyCrobo \``,
          `className:\`button button-small header-cta\`,children:[\`Login \``
        );
        changed = true;
      }
      // Change mobile-clone-cta label to Login / App
      if (content.includes(`className:\`mobile-clone-cta\`,onOpen:()=>t(!1),children:[\`Meet MyCrobo \``)) {
        content = content.replaceAll(
          `className:\`mobile-clone-cta\`,onOpen:()=>t(!1),children:[\`Meet MyCrobo \``,
          `className:\`mobile-clone-cta\`,onOpen:()=>t(!1),children:[\`Login / App \``
        );
        changed = true;
      }
      if (changed) {
        writeFileSync(full, content, "utf8");
        console.log("Updated site-header chunk:", entry);
      }
    }
  }
}

try {
  walk(legacyDir);
  updateChunks();
  cpSync(legacyDir, resolve(root, "out"), { recursive: true });
  console.log("Successfully synced legacy-export to out!");
} catch (e) {
  console.warn("Error during update:", e.message);
}
console.log("All headers and chunks updated cleanly!");
