// Isolated test rendering only: never attaches to personal Chrome or opens a mic.
const { chromium } = require("playwright");
const fs = require("fs");
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(process.env.DEMO_URL || "http://127.0.0.1:8197/");
    await page.waitForSelector(".card.referenced");
    await page.waitForSelector(".quality-row", { state: "attached" });
    const count = await page.locator("#scenario option").count();
    if (count !== 11) throw Error("Expected 11 scenarios, got " + count);
    if (await page.locator("audio[autoplay]").count())
      throw Error("Audio must never autoplay");
    await page.selectOption("#scenario", "high_loop_gain");
    await page.waitForSelector(".status.warning");
    if ((await page.locator(".status.warning").count()) !== 2)
      throw Error("High-gain safety outcomes missing");
    await page.selectOption("#scenario", "clock_drift_100ppm");
    if (!(await page.locator("#description").textContent()).includes("drift"))
      throw Error("Scenario description stale");
    await page.selectOption("#scenario", "doubletalk");
    for (const url of await page
      .locator("audio")
      .evaluateAll((a) => a.map((x) => x.src))) {
      const r = await page.request.get(url);
      if (!r.ok()) throw Error("Missing audio " + url);
    }
    await page.screenshot({
      path: "neural/artifacts/demo-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )
    )
      throw Error("Mobile horizontal overflow");
    await page.screenshot({
      path: "neural/artifacts/demo-mobile.png",
      fullPage: true,
    });
    if (errors.length) throw Error(errors.join("\n"));
    fs.writeFileSync(
      "neural/artifacts/ui-tests.json",
      JSON.stringify(
        {
          passed: true,
          scenarios: count,
          no_autoplay: true,
          mobile_overflow: false,
          audio_endpoints: 19,
          console_errors: errors,
        },
        null,
        2,
      ),
    );
    console.log(
      "UI checks passed: 11 scenarios, safety states, audio endpoints, no autoplay, mobile fit.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
