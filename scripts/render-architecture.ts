/**
 * Renders docs/architecture.html to PNG, light and dark.
 *
 * The diagram is authored as HTML rather than drawn in a design tool so it
 * stays versionable, reviewable in a diff, and regenerable when the system
 * changes — a binary nobody can edit goes stale immediately. It also shares
 * the product's design tokens, so the two can't drift.
 *
 *   npx tsx scripts/render-architecture.ts
 *
 * Requires Playwright's chromium:
 *   npx playwright install chromium
 */
import { chromium } from "playwright";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function main() {
  const root = process.cwd();
  const source = pathToFileURL(path.join(root, "docs/architecture.html")).href;

  const browser = await chromium.launch();

  for (const theme of ["light", "dark"] as const) {
    // 2x for a crisp render on high-density displays and when GitHub scales
    // the image down into the README column.
    const page = await browser.newPage({
      // Height is intentionally short: fullPage expands to the content, and a
      // tall viewport would pad the image with empty space below the diagram.
      viewport: { width: 1680, height: 600 },
      deviceScaleFactor: 2,
    });

    await page.goto(source, { waitUntil: "networkidle" });
    if (theme === "dark") {
      await page.evaluate(() => document.documentElement.classList.add("dark"));
    }
    await page.waitForTimeout(400);

    const out =
      theme === "light" ? "docs/architecture.png" : "docs/architecture-dark.png";
    await page.screenshot({ path: path.join(root, out), fullPage: true });

    const { width, height } = await page.evaluate(() => ({
      width: document.body.scrollWidth,
      height: document.body.scrollHeight,
    }));
    console.log(`${out}  ${width}x${height}css @2x`);
    await page.close();
  }

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
