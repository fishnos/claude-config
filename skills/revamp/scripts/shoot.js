// Screenshots every page of a running site at phone, tablet and desktop
// width (plus desktop with reduced motion) and measures the faults a person
// would otherwise have to spot by eye.
//
// usage: NODE_PATH=<dir with playwright>/node_modules \
//          node shoot.js <base-url> <out-dir> [path ...]
// Paths default to "/". Prints one JSON line per page and viewport; a line
// with "faults": [] is clean. Exit code 1 when any fault was found.
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const [baseUrl, outDir, ...pagePaths] = process.argv.slice(2);
if (!baseUrl || !outDir) {
  console.error("usage: node shoot.js <base-url> <out-dir> [path ...]");
  process.exit(2);
}
const viewports = [
  { name: "phone", width: 390, height: 844, motion: "no-preference" },
  { name: "tablet", width: 768, height: 1024, motion: "no-preference" },
  { name: "desktop", width: 1440, height: 900, motion: "no-preference" },
  { name: "desktop-reduced", width: 1440, height: 900, motion: "reduce" },
];

// Runs inside the page. Thresholds are the ones that caught real faults.
function measure() {
  const faults = [];
  // Closed menus and panels sit off-screen or under inert/aria-hidden; they
  // are not content.
  const visible = (element) => {
    if (element.closest("[inert], [aria-hidden='true']")) return false;
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return (
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      Number(style.opacity) > 0.05 &&
      box.width > 0 &&
      box.height > 0 &&
      box.bottom + scrollY > 0 &&
      box.right > 0 &&
      box.left < innerWidth
    );
  };
  const describe = (element) =>
    element.tagName.toLowerCase() +
    (element.id ? `#${element.id}` : "") +
    (typeof element.className === "string" && element.className.trim()
      ? "." + element.className.trim().split(/\s+/).slice(0, 2).join(".")
      : "") +
    ` "${(element.textContent || "").trim().slice(0, 30)}"`;

  const overflow = document.documentElement.scrollWidth - innerWidth;
  if (overflow > 0) faults.push(`horizontal overflow of ${overflow}px`);

  for (const image of document.images) {
    if (image.complete && image.naturalWidth === 0)
      faults.push(`broken image ${image.currentSrc || image.src}`);
    if (!image.hasAttribute("alt"))
      faults.push(`image without alt ${image.currentSrc || image.src}`);
  }

  // Labels inside filled or outlined controls must sit in the middle. Taller
  // boxes are whole-card links whose text is laid out, not centred.
  const controls = [...document.querySelectorAll("a, button")].filter(
    (element) => {
      if (!visible(element)) return false;
      const style = getComputedStyle(element);
      const filled =
        style.backgroundColor !== "rgba(0, 0, 0, 0)" &&
        style.backgroundColor !== "transparent";
      const outlined =
        parseFloat(style.borderTopWidth) > 0 &&
        parseFloat(style.borderBottomWidth) > 0;
      return (
        (filled || outlined) &&
        element.getBoundingClientRect().height >= 28 &&
        element.getBoundingClientRect().height < 72
      );
    },
  );
  for (const control of controls) {
    const walker = document.createTreeWalker(control, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode())
      if (walker.currentNode.textContent.trim())
        textNodes.push(walker.currentNode);
    if (textNodes.length === 0) continue;
    // Only glyphs showing inside the control count: rolling labels ("Menu"
    // over "Close") keep the hidden word clipped outside the box.
    const box = control.getBoundingClientRect();
    const rects = textNodes
      .flatMap((node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        return [...range.getClientRects()];
      })
      .filter(
        (rect) =>
          rect.height > 0 &&
          rect.top >= box.top - 1 &&
          rect.bottom <= box.bottom + 1,
      );
    if (rects.length === 0) continue;
    const top = Math.min(...rects.map((rect) => rect.top));
    const text = {
      top,
      height: Math.max(...rects.map((rect) => rect.bottom)) - top,
    };
    // The line box includes empty ascent and descent, so compare the glyphs'
    // visual middle: roughly 55% down a line box for most text faces. A
    // label trimmed to cap height (`text-box`) still reports the untrimmed
    // range, so its element box is the glyphs' extent instead.
    const trimmed = textNodes
      .map((node) => node.parentElement)
      .find((element) => {
        const trim = getComputedStyle(element).textBoxTrim;
        return trim && trim !== "none";
      });
    const trimmedBox = trimmed?.getBoundingClientRect();
    const glyphMiddle = trimmedBox
      ? trimmedBox.top + trimmedBox.height / 2
      : text.top + text.height * 0.55;
    const offset = Math.round(glyphMiddle - (box.top + box.height / 2));
    if (Math.abs(offset) > 2)
      faults.push(
        `label ${offset > 0 ? "low" : "high"} by ${Math.abs(offset)}px in ${describe(control)}`,
      );
    if (box.height < 24 || box.width < 24)
      faults.push(`tap target under 24px: ${describe(control)}`);
  }

  // All-caps labels with wide tracking are a site rule violation.
  for (const element of document.querySelectorAll("body *")) {
    if (!visible(element) || !element.textContent.trim()) continue;
    const style = getComputedStyle(element);
    const tracking =
      parseFloat(style.letterSpacing) / parseFloat(style.fontSize);
    if (style.textTransform === "uppercase" && tracking > 0.04) {
      faults.push(`tracked capitals: ${describe(element)}`);
    }
  }

  // Typewriter headings and italic sentences read as machine-made. The
  // family check reads the whole stack, since next/font renames the face
  // but keeps the fallbacks ("Courier New", monospace) the author chose.
  const typewriter = /mono|courier|typewriter/i;
  for (const element of document.querySelectorAll("body *")) {
    if (!visible(element)) continue;
    const ownText = [...element.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent)
      .join("")
      .trim();
    if (!ownText) continue;
    const style = getComputedStyle(element);
    const isCode = /^(CODE|KBD|PRE|SAMP)$/.test(element.tagName);
    const isHeading =
      !isCode &&
      (/^H[1-4]$/.test(element.tagName) || parseFloat(style.fontSize) >= 24);
    if (isHeading && typewriter.test(style.fontFamily)) {
      faults.push(`monospace heading: ${describe(element)}`);
    }
    if (style.fontStyle === "italic" && ownText.split(/\s+/).length > 4) {
      faults.push(`italic sentence: ${describe(element)}`);
    }
  }

  // Large empty bands: union the vertical extent of visible content and
  // report gaps taller than 40% of the viewport. [role=img] counts because a
  // labelled wrapper hides its own canvas from the accessibility tree; any
  // element holding text directly counts, so text set in divs and spans
  // (a typed transcript, a terminal) is not mistaken for a gap.
  const holdsText = (element) =>
    [...element.childNodes].some(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim(),
    );
  const spans = [
    ...document.querySelectorAll(
      "img, [role='img'], video, svg, canvas, table, h1, h2, h3, h4, p, li, a, button, dd, dt, figcaption, blockquote",
    ),
    ...[...document.querySelectorAll("body div, body span")].filter(holdsText),
  ]
    .filter(visible)
    .map((element) => {
      const box = element.getBoundingClientRect();
      return [box.top + scrollY, box.bottom + scrollY];
    })
    .sort((first, second) => first[0] - second[0]);
  let reach = 0;
  for (const [top, bottom] of spans) {
    if (top - reach > innerHeight * 0.4)
      faults.push(
        `empty band of ${Math.round(top - reach)}px at y=${Math.round(reach)}`,
      );
    reach = Math.max(reach, bottom);
  }
  return { overflow, faults: [...new Set(faults)] };
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome" });
  let faultCount = 0;
  for (const pagePath of pagePaths.length ? pagePaths : ["/"]) {
    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        reducedMotion: viewport.motion,
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      page.on(
        "console",
        (message) => message.type() === "error" && errors.push(message.text()),
      );
      await page.goto(new URL(pagePath, baseUrl).href, {
        waitUntil: "networkidle",
        timeout: 120000,
      });
      // Scroll the whole page so in-view animations and lazy images settle.
      const height = await page.evaluate(
        () => document.documentElement.scrollHeight,
      );
      for (let offset = 0; offset < height; offset += 400) {
        await page.evaluate((y) => scrollTo(0, y), offset);
        await page.waitForTimeout(60);
      }
      await page.waitForTimeout(1500);
      await page.evaluate(() => scrollTo(0, 0));
      await page.waitForTimeout(500);
      const slug =
        (pagePath.replace(/\W+/g, "-").replace(/^-|-$/g, "") || "home") +
        `-${viewport.name}`;
      const shot = path.join(outDir, `${slug}.png`);
      await page.screenshot({ path: shot, fullPage: true });
      const result = await page.evaluate(measure);
      const faults = [
        ...result.faults,
        ...errors.map((error) => `console: ${error.slice(0, 160)}`),
      ];
      faultCount += faults.length;
      console.log(
        JSON.stringify({
          page: pagePath,
          viewport: viewport.name,
          shot,
          faults,
        }),
      );
      await context.close();
    }
  }
  await browser.close();
  process.exit(faultCount ? 1 : 0);
})();
