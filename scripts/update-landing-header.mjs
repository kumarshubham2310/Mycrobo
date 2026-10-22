import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const root = resolve("apps/public_html");
const dirs = [resolve(root, "legacy-export"), resolve(root, "out")];

const oldMobile = `<button class="mobile-clone-cta" type="button">Meet MyCrobo <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-right" aria-hidden="true"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg></button>`;
const newMobile = `<a class="mobile-clone-cta" href="/app">Login / App <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-right" aria-hidden="true"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg></a>`;

const oldCta = `<button class="button button-small header-cta" type="button">Meet MyCrobo <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-right" aria-hidden="true"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg></button>`;
const newCta = `<a class="button button-small" href="/app" style="margin-right:8px;background:transparent;border:1px solid #14281d;color:#14281d;text-decoration:none;display:inline-flex;align-items:center;">Meet MyCrobo <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-right" style="margin-left:4px;"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg></a><a class="button button-small header-cta" href="/app" style="text-decoration:none;display:inline-flex;align-items:center;">Login <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-right" aria-hidden="true"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg></a>`;

const oldHero = `<button class="button" type="button">Meet MyCrobo <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-right" aria-hidden="true"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg></button>`;
const newHero = `<a class="button" href="/app" style="text-decoration:none;display:inline-flex;align-items:center;">Meet MyCrobo / Sign In <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-right" aria-hidden="true"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg></a>`;

const oldMenu = `<button class="menu-button" type="button" aria-label="Open menu">`;
const newMenu = `<button class="menu-button" type="button" aria-label="Open menu" onclick="document.querySelector('.site-header nav').classList.toggle('nav-open')">`;

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
    } else if (full.endsWith(".html")) {
      let content = readFileSync(full, "utf8");
      let changed = false;

      if (content.includes(oldMobile)) {
        content = content.replaceAll(oldMobile, newMobile);
        changed = true;
      }
      if (content.includes(oldCta)) {
        content = content.replaceAll(oldCta, newCta);
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
        console.log("Updated:", full);
      }
    }
  }
}

import { cpSync } from "node:fs";

try {
  walk(resolve(root, "legacy-export"));
  cpSync(resolve(root, "legacy-export"), resolve(root, "out"), { recursive: true });
  console.log("Successfully synced legacy-export to out!");
} catch (e) {
  console.warn("Could not sync to out:", e.message);
}
console.log("Done updating headers!");
