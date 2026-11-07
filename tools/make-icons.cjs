// アプリのアイコン（icon-192.png・icon-512.png）を作る。水色の地に、洗濯のおけの記号（40）と朱の札。
// 使い方: node tools/make-icons.cjs（qa/ の playwright を使う）
const path = require("path");
const { chromium } = require(path.join(__dirname, "..", "qa", "node_modules", "playwright"));
(async () => {
  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  for (const s of [192, 512]) {
    const p = await b.newPage({ viewport: { width: s, height: s } });
    await p.setContent(`<body style="margin:0"><svg width="${s}" height="${s}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" fill="#eef4f8"/>
      <rect x="16" y="14" width="68" height="72" rx="8" fill="#fff" stroke="#1f2a44" stroke-width="2.5"/>
      <circle cx="50" cy="22" r="3.5" fill="#b8402a"/>
      <g fill="none" stroke="#1f2a44" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" transform="translate(20 28)">
        <path d="M5 20 q5.5 -6 11 0 t11 0 t11 0 t11 0 t6 -2"/><path d="M8 20 L14 50 L46 50 L52 20"/><line x1="12" y1="57" x2="48" y2="57"/></g>
      <text x="50" y="72" font-size="17" font-weight="900" text-anchor="middle" fill="#1f2a44" font-family="sans-serif">40</text></svg></body>`);
    await p.screenshot({ path: path.join(__dirname, "..", `icon-${s}.png`), clip: { x: 0, y: 0, width: s, height: s } });
  }
  await b.close();
})();
