import { readFileSync, writeFileSync, readdirSync, statSync, cpSync, appendFileSync } from "node:fs";
import { resolve, join } from "node:path";

const root = resolve("apps/public_html");
const legacyDir = resolve(root, "legacy-export");
const chunksDir = resolve(legacyDir, "_next/static/chunks");
const cssDir = resolve(legacyDir, "_next/static/css");

// The header actions containing Meet MyCrobo followed by Login ->
const headerActionsHtml = `<div class="header-actions" style="grid-column: 3; justify-self: end; display: inline-flex; align-items: center; gap: 10px;"><a class="button button-small" href="/app" style="text-decoration:none;display:inline-flex;align-items:center;background:transparent;border:1.5px solid rgba(20,40,29,0.3);color:#14281d;padding:0 16px;min-height:38px;border-radius:9999px;font-size:13px;font-weight:600;white-space:nowrap;transition:all 0.15s ease;">Meet MyCrobo</a><a class="button button-small header-cta" href="/app" style="text-decoration:none;display:inline-flex;align-items:center;background:#14281d;color:#ffffff;padding:0 18px;min-height:38px;border-radius:9999px;font-size:13px;font-weight:700;white-space:nowrap;transition:all 0.15s ease;">Login <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-right" aria-hidden="true" style="margin-left:4px;"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg></a></div>`;

const oldMobile = `<button class="mobile-clone-cta" type="button">Meet MyCrobo <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-right" aria-hidden="true"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg></button>`;
const newMobile = `<a class="mobile-clone-cta" href="/app">Login / App <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-right" aria-hidden="true"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg></a>`;

const oldHero = `<button class="button" type="button">Meet MyCrobo <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-right" aria-hidden="true"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg></button>`;
const newHero = `<a class="button" href="/app" style="text-decoration:none;display:inline-flex;align-items:center;">Meet MyCrobo <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-right" aria-hidden="true" style="margin-left:4px;"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg></a>`;

const oldMenu = `<button class="menu-button" type="button" aria-label="Open menu">`;
const newMenu = `<button class="menu-button" type="button" aria-label="Open menu" onclick="document.querySelector('.site-header nav').classList.toggle('nav-open')">`;

// 1. Update all HTML files
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== "_next") walk(full);
    } else if (full.endsWith(".html")) {
      let content = readFileSync(full, "utf8");
      let changed = false;

      // Ensure header contains headerActionsHtml right after </nav> and before <button class="menu-button"
      content = content.replace(
        /<header class="site-header">([\s\S]*?)<\/header>/u,
        (match, inner) => {
          const updatedInner = inner.replace(
            /(<\/nav>)[\s\S]*?(<button class="menu-button")/u,
            `$1${headerActionsHtml}$2`
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

// 2. Ensure all CSS files in _next/static/css have the proper .header-actions rules
function updateCss() {
  if (!readdirSync(cssDir)) return;
  const headerActionsCss = `\n.site-header .header-actions{grid-column:3!important;justify-self:end!important;display:inline-flex!important;align-items:center!important;gap:10px!important}@media(max-width:960px){.site-header .header-actions{display:none!important}}\n`;
  for (const entry of readdirSync(cssDir)) {
    if (entry.endsWith(".css")) {
      const full = join(cssDir, entry);
      let content = readFileSync(full, "utf8");
      if (!content.includes(".header-actions{grid-column:3")) {
        appendFileSync(full, headerActionsCss, "utf8");
        console.log("Appended .header-actions styles to CSS:", entry);
      }
    }
  }
}

// 3. Update JS Chunks for React hydration
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

      const target1 = `(s,{className:\`button button-small header-cta\`,children:[\`Login \`,(0,d.jsx)(a,{size:15})]})`;
      const target2 = `(s,{className:\`button button-small header-cta\`,children:[\`Meet MyCrobo \`,(0,d.jsx)(a,{size:15})]})`;
      const replacement = `(\`div\`,{className:\`header-actions\`,style:{gridColumn:3,justifySelf:\`end\`,display:\`inline-flex\`,alignItems:\`center\`,gap:\`10px\`},children:[(0,d.jsx)(\`a\`,{href:\`/app\`,className:\`button button-small\`,style:{textDecoration:\`none\`,display:\`inline-flex\`,alignItems:\`center\`,background:\`transparent\`,border:\`1.5px solid rgba(20,40,29,0.3)\`,color:\`#14281d\`,padding:\`0 16px\`,minHeight:\`38px\`,borderRadius:\`9999px\`,fontSize:\`13px\`,fontWeight:\`600\`,whiteSpace:\`nowrap\`},children:\`Meet MyCrobo\`}),(0,d.jsxs)(\`a\`,{href:\`/app\`,className:\`button button-small header-cta\`,style:{textDecoration:\`none\`,display:\`inline-flex\`,alignItems:\`center\`,background:\`#14281d\`,color:\`#ffffff\`,padding:\`0 18px\`,minHeight:\`38px\`,borderRadius:\`9999px\`,fontSize:\`13px\`,fontWeight:\`700\`,whiteSpace:\`nowrap\`},children:[\`Login \`,(0,d.jsx)(a,{size:14})]})]})`;

      if (content.includes(target1)) {
        content = content.replaceAll(target1, replacement);
        changed = true;
      }
      if (content.includes(target2)) {
        content = content.replaceAll(target2, replacement);
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
  updateCss();
  updateChunks();
  cpSync(legacyDir, resolve(root, "out"), { recursive: true });
  console.log("Successfully synced legacy-export to out!");
} catch (e) {
  console.warn("Error during update:", e.message);
}
console.log("Done updating landing headers!");
