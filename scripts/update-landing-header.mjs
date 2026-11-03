import { readFileSync, writeFileSync, readdirSync, statSync, cpSync, appendFileSync } from "node:fs";
import { resolve, join } from "node:path";

const root = resolve("apps/public_html");
const legacyDir = resolve(root, "legacy-export");
const chunksDir = resolve(legacyDir, "_next/static/chunks");
const cssDir = resolve(legacyDir, "_next/static/css");

// The header actions containing Meet MyCrobo (interactive preview) followed by Login -> (links to /login) or User Name (links to /app)
const headerActionsHtml = `<div class="header-actions" style="grid-column: 3; justify-self: end; display: inline-flex; align-items: center; gap: 10px;"><button type="button" class="button button-small" onclick="window.dispatchEvent(new CustomEvent('mycrobo:open-clone'))" style="cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;background:transparent;border:1.5px solid rgba(20,40,29,0.3);color:#14281d;padding:0 16px;min-height:38px;border-radius:9999px;font-size:13px;font-weight:600;white-space:nowrap;transition:all 0.15s ease;">Meet MyCrobo</button><a class="button button-small header-cta" href="/login" style="text-decoration:none;display:inline-flex;align-items:center;background:#14281d;color:#ffffff;padding:0 18px;min-height:38px;border-radius:9999px;font-size:13px;font-weight:700;white-space:nowrap;transition:all 0.15s ease;">Login <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-right" aria-hidden="true" style="margin-left:4px;"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg></a></div><script>(function(){try{var u=localStorage.getItem("mycrobo.user.name");if(u){var h=document.querySelector(".site-header .header-cta");if(h){h.href="/app";h.firstChild.nodeValue=u+" ";}var m=document.querySelector(".site-header .mobile-clone-cta");if(m){m.href="/app";m.firstChild.nodeValue=u+" ";}}}catch(e){}})();</script>`;

const newMobile = `<a class="mobile-clone-cta" href="/login">Login <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-right" aria-hidden="true"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg></a>`;

const newHero = `<button class="button" type="button" onclick="window.dispatchEvent(new CustomEvent('mycrobo:open-clone'))">Meet MyCrobo <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-right" aria-hidden="true" style="margin-left:4px;"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg></button>`;

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

      // Update mobile CTA
      content = content.replace(/<(?:a|button)[^>]*class="mobile-clone-cta"[^>]*>[\s\S]*?<\/(?:a|button)>/g, () => {
        changed = true;
        return newMobile;
      });

      // Update hero Meet MyCrobo button if present
      content = content.replace(/<section class="(?:home-hero|hero)"[\s\S]*?<\/section>/u, (heroMatch) => {
        const updatedHero = heroMatch.replace(/<(?:a|button)[^>]*class="button"[^>]*>[\s\S]*?Meet MyCrobo[\s\S]*?<\/(?:a|button)>/u, () => {
          changed = true;
          return newHero;
        });
        return updatedHero;
      });

      // Update menu button onclick
      content = content.replace(/<button class="menu-button"[^>]*aria-label="Open menu"[^>]*>/u, () => {
        changed = true;
        return newMenu;
      });

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

import vm from "node:vm";

// 3. Update JS Chunks for React hydration
function updateChunks() {
  if (!readdirSync(chunksDir)) return;
  for (const entry of readdirSync(chunksDir)) {
    const full = join(chunksDir, entry);
    if (entry.startsWith("open-clone-button-") && entry.endsWith(".js")) {
      const newJs = 'import{r as e}from"./framework-D_rUT4EX.js";var t=e();function n({children:e,className:n,onOpen:r}){return(0,t.jsx)(`button`,{className:n,type:`button`,onClick:()=>{r?.(),window.dispatchEvent(new CustomEvent(`mycrobo:open-clone`))},children:e})}export{n as OpenCloneButton};';
      writeFileSync(full, newJs, "utf8");
      console.log("Updated open-clone-button chunk:", entry);
    } else if (entry.startsWith("site-header-") && entry.endsWith(".js")) {
      let content = readFileSync(full, "utf8");
      let changed = false;

      const pFuncRegex = /function p\(\)\{[\s\S]*?export\{p as SiteHeader\};/u;
      if (pFuncRegex.test(content)) {
        const replacementP = `function p(){let[e,t]=(0,u.useState)(!1),n=r(),[m,v]=(0,u.useState)(()=>typeof window!==\`undefined\`?(localStorage.getItem(\`mycrobo.user.name\`)||null):null);(0,u.useEffect)(()=>{try{let tok=localStorage.getItem(\`mycrobo.web.auth_token.v1\`);if(tok){fetch(\`/api/v1/auth/status\`,{headers:{authorization:\`Bearer \${tok}\`}}).then(r=>r.ok?r.json():null).then(d=>{if(d?.authenticated&&d?.user){let nm=d.user.displayName||d.user.email?.split(\`@\`)[0]||\`User\`;localStorage.setItem(\`mycrobo.user.name\`,nm);v(nm);}else if(d&&!d.authenticated){localStorage.removeItem(\`mycrobo.user.name\`);v(null);}}).catch(()=>{});}else{localStorage.removeItem(\`mycrobo.user.name\`);v(null);}}catch{}},[]);return(0,d.jsxs)(\`header\`,{className:\`site-header\`,children:[(0,d.jsx)(\`a\`,{className:\`brand\`,href:\`/\`,"aria-label":\`MyCrobo home\`,onClick:()=>t(!1),children:(0,d.jsx)(c,{src:\`/mycrobo-logo.png\`,alt:\`MyCrobo\`,width:172,height:58,priority:!0})}),(0,d.jsxs)(\`nav\`,{"aria-label":\`Primary navigation\`,className:e?\`nav-open\`:\`\`,children:[f.map(([e,r])=>(0,d.jsx)(\`a\`,{href:e,className:n===e.slice(0,-1)||n===e||e===\`/product/\`&&n===\`/control\`?\`current\`:\`\`,onClick:()=>t(!1),children:r},e)),(0,d.jsxs)(\`a\`,{className:\`mobile-clone-cta\`,href:m?\`/app\`:\`/login\`,onClick:()=>t(!1),children:[(m?m:\`Login\`)+\` \`,(0,d.jsx)(a,{size:15})]})]}),(0,d.jsxs)(\`div\`,{className:\`header-actions\`,style:{gridColumn:3,justifySelf:\`end\`,display:\`inline-flex\`,alignItems:\`center\`,gap:\`10px\`},children:[(0,d.jsx)(\`button\`,{type:\`button\`,className:\`button button-small\`,style:{cursor:\`pointer\`,textDecoration:\`none\`,display:\`inline-flex\`,alignItems:\`center\`,background:\`transparent\`,border:\`1.5px solid rgba(20,40,29,0.3)\`,color:\`#14281d\`,padding:\`0 16px\`,minHeight:\`38px\`,borderRadius:\`9999px\`,fontSize:\`13px\`,fontWeight:\`600\`,whiteSpace:\`nowrap\`},onClick:()=>{window.dispatchEvent(new CustomEvent(\`mycrobo:open-clone\`))},children:\`Meet MyCrobo\`}),(0,d.jsxs)(\`a\`,{href:m?\`/app\`:\`/login\`,className:\`button button-small header-cta\`,style:{textDecoration:\`none\`,display:\`inline-flex\`,alignItems:\`center\`,background:\`#14281d\`,color:\`#ffffff\`,padding:\`0 18px\`,minHeight:\`38px\`,borderRadius:\`9999px\`,fontSize:\`13px\`,fontWeight:\`700\`,whiteSpace:\`nowrap\`},children:[(m?m:\`Login\`)+\` \`,(0,d.jsx)(a,{size:14})]})]}),(0,d.jsx)(\`button\`,{className:\`menu-button\`,type:\`button\`,"aria-label":e?\`Close menu\`:\`Open menu\`,onClick:()=>t(e=>!e),children:e?(0,d.jsx)(o,{size:21}):(0,d.jsx)(l,{size:21})})]})}export{p as SiteHeader};`;
        content = content.replace(pFuncRegex, replacementP);
        changed = true;
      }

      const mFuncRegex = /function m\(\)\{[\s\S]*?export\{m as SiteHeader\};/u;
      if (mFuncRegex.test(content)) {
        const replacementM = `function m(){let[e,t]=(0,d.useState)(!1),n=r(),[usr,setUsr]=(0,d.useState)(()=>typeof window!==\`undefined\`?(localStorage.getItem(\`mycrobo.user.name\`)||null):null);(0,d.useEffect)(()=>{try{let tok=localStorage.getItem(\`mycrobo.web.auth_token.v1\`);if(tok){fetch(\`/api/v1/auth/status\`,{headers:{authorization:\`Bearer \${tok}\`}}).then(r=>r.ok?r.json():null).then(d=>{if(d?.authenticated&&d?.user){let nm=d.user.displayName||d.user.email?.split(\`@\`)[0]||\`User\`;localStorage.setItem(\`mycrobo.user.name\`,nm);setUsr(nm);}else if(d&&!d.authenticated){localStorage.removeItem(\`mycrobo.user.name\`);setUsr(null);}}).catch(()=>{});}else{localStorage.removeItem(\`mycrobo.user.name\`);setUsr(null);}}catch{}},[]);return(0,f.jsxs)(\`header\`,{className:\`site-header\`,children:[(0,f.jsx)(l,{className:\`brand\`,href:\`/\`,"aria-label":\`MyCrobo home\`,onClick:()=>t(!1),children:(0,f.jsx)(c,{src:\`/mycrobo-logo.png\`,alt:\`MyCrobo\`,width:172,height:58,priority:!0})}),(0,f.jsxs)(\`nav\`,{"aria-label":\`Primary navigation\`,className:e?\`nav-open\`:\`\`,children:[p.map(([e,r])=>(0,f.jsx)(l,{href:e,className:n===e||e===\`/product\`&&n===\`/control\`?\`current\`:\`\`,onClick:()=>t(!1),children:r},e)),(0,f.jsxs)(\`a\`,{className:\`mobile-clone-cta\`,href:usr?\`/app\`:\`/login\`,onClick:()=>t(!1),children:[(usr?usr:\`Login\`)+\` \`,(0,f.jsx)(a,{size:15})]})]}),(0,f.jsxs)(\`div\`,{className:\`header-actions\`,style:{gridColumn:3,justifySelf:\`end\`,display:\`inline-flex\`,alignItems:\`center\`,gap:\`10px\`},children:[(0,f.jsx)(\`button\`,{type:\`button\`,className:\`button button-small\`,style:{cursor:\`pointer\`,textDecoration:\`none\`,display:\`inline-flex\`,alignItems:\`center\`,background:\`transparent\`,border:\`1.5px solid rgba(20,40,29,0.3)\`,color:\`#14281d\`,padding:\`0 16px\`,minHeight:\`38px\`,borderRadius:\`9999px\`,fontSize:\`13px\`,fontWeight:\`600\`,whiteSpace:\`nowrap\`},onClick:()=>{window.dispatchEvent(new CustomEvent(\`mycrobo:open-clone\`))},children:\`Meet MyCrobo\`}),(0,f.jsxs)(\`a\`,{href:usr?\`/app\`:\`/login\`,className:\`button button-small header-cta\`,style:{textDecoration:\`none\`,display:\`inline-flex\`,alignItems:\`center\`,background:\`#14281d\`,color:\`#ffffff\`,padding:\`0 18px\`,minHeight:\`38px\`,borderRadius:\`9999px\`,fontSize:\`13px\`,fontWeight:\`700\`,whiteSpace:\`nowrap\`},children:[(usr?usr:\`Login\`)+\` \`,(0,f.jsx)(a,{size:14})]})]}),(0,f.jsx)(\`button\`,{className:\`menu-button\`,type:\`button\`,"aria-label":e?\`Close menu\`:\`Open menu\`,onClick:()=>t(e=>!e),children:e?(0,f.jsx)(o,{size:21}):(0,f.jsx)(u,{size:21})})]})}export{m as SiteHeader};`;
        content = content.replace(mFuncRegex, replacementM);
        changed = true;
      }

      if (changed) {
        // Syntax verification check
        try {
          new vm.SourceTextModule(content);
        } catch (e) {
          throw new Error(`Syntax error in chunk \${entry}: \${e.message}`);
        }
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
