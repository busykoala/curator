import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const root = new URL("../../.env", import.meta.url);
const env = Object.fromEntries(
  readFileSync(root, "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const index = line.indexOf("=");
      const key = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
      return [key, value];
    }),
);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto("http://127.0.0.1:4545", { waitUntil: "networkidle" });

if (await page.locator('input[type="password"]').isVisible().catch(() => false)) {
  await page.locator('input[type="password"]').fill(env.CURATOR_ADMIN_PASSWORD);
  await page.locator("button").first().click();
  await page.waitForLoadState("networkidle");
}

await page.getByRole("button", { name: /Playlists/i }).click();
await page.getByRole("heading", { name: "Your library, kept in motion" }).waitFor();
await page.screenshot({
  path: "/tmp/curator-playlists-desktop.png",
  fullPage: true,
});

await page.getByRole("button", { name: /Mood or occasion/i }).click();
await page.getByRole("heading", { name: "Add a mood or occasion" }).waitFor();
await page.locator(".options-loading").waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
await page.getByRole("combobox", { name: "Moods" }).click();
await page.locator(".combo-popover").waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
await page.screenshot({
  path: "/tmp/curator-playlists-mood-editor.png",
  fullPage: true,
});
await page.locator(".intent-editor .icon-button").click();

await page.getByRole("button", { name: /Progressive journey/i }).click();
await page.getByRole("heading", { name: "Build a progressive journey" }).waitFor();
await page.screenshot({
  path: "/tmp/curator-playlists-journey-editor.png",
  fullPage: true,
});
await page.locator(".intent-editor .icon-button").click();

await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({
  path: "/tmp/curator-playlists-mobile.png",
  fullPage: true,
});

console.log(JSON.stringify({
  desktop: "/tmp/curator-playlists-desktop.png",
  mood: "/tmp/curator-playlists-mood-editor.png",
  journey: "/tmp/curator-playlists-journey-editor.png",
  mobile: "/tmp/curator-playlists-mobile.png",
}));
await browser.close();
