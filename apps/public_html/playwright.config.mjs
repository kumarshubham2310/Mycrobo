import { defineConfig } from "@playwright/test";
import { existsSync } from 'node:fs';
const channel = process.env.PLAYWRIGHT_CHANNEL || (existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe') ? 'chrome' : undefined);
export default defineConfig({
  testDir: "tests/browser",
  use: { baseURL: "http://127.0.0.1:3100", headless: true, channel },
  webServer: {
    command: "npm start",
    url: "http://127.0.0.1:3100",
    env: { PORT: '3100' },
    reuseExistingServer: true,
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 } } },
    { name: "tablet", use: { viewport: { width: 768, height: 1024 } } },
  ],
});
