// SNS で貼られたときの絵（og.png 1200×630）を作る。今日の問題（答え）は入れず、タグの見本の記号だけ。
// 使い方: node tools/make-og.cjs（qa/ の playwright を使う）
const path = require("path");
const { chromium } = require(path.join(__dirname, "..", "qa", "node_modules", "playwright"));
const K = 'fill="none" stroke="#1f2a44" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"';
const SY = [
  `<path d="M5 20 q5.5 -6 11 0 t11 0 t11 0 t11 0 t6 -2" ${K}/><path d="M8 20 L14 50 L46 50 L52 20" ${K}/><text x="30" y="44" font-size="17" font-weight="900" text-anchor="middle" fill="#1f2a44" font-family="sans-serif">40</text><line x1="12" y1="57" x2="48" y2="57" ${K}/>`,
  `<path d="M30 8 L54 50 L6 50 Z" ${K}/><path d="M21 46 L31 24 M29 46 L37 28" ${K}/>`,
  `<rect x="8" y="8" width="44" height="44" ${K}/><line x1="30" y1="16" x2="30" y2="44" ${K}/><line x1="8" y1="21" x2="21" y2="8" ${K}/>`,
  `<path d="M6 46 L54 46 L54 40 Q54 25 38 23 L19 23 Q11 23 8.5 33 Z" ${K}/><path d="M22 23 Q22 13 31 13 L46 13" ${K}/><circle cx="25" cy="36" r="2.6" fill="#1f2a44"/><circle cx="37" cy="36" r="2.6" fill="#1f2a44"/>`,
  `<circle cx="30" cy="30" r="21" ${K}/><text x="30" y="37" font-size="20" font-weight="900" text-anchor="middle" fill="#1f2a44" font-family="sans-serif">P</text>`,
];
(async () => {
  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
  const tag = SY.map((x) => `<svg width="96" height="102" viewBox="0 0 60 64">${x}</svg>`).join("");
  await p.setContent(`<body style="margin:0;font-family:'Noto Sans CJK JP','IPAPGothic',sans-serif">
  <div style="width:1200px;height:630px;box-sizing:border-box;padding:60px 80px;background:#eef4f8;background-image:linear-gradient(#e3edf5 2px,transparent 2px),linear-gradient(90deg,#e3edf5 2px,transparent 2px);background-size:40px 40px;color:#1f2a44;display:flex;flex-direction:column;justify-content:center;gap:26px">
    <div style="font-size:34px;color:#86291a;letter-spacing:.06em">洗う・漂白・干す・アイロン・クリーニング</div>
    <div style="font-size:120px;font-weight:900;letter-spacing:.08em;color:#142a52;line-height:1">洗濯表示<span style="color:#b8402a">よみ</span></div>
    <div style="display:flex;gap:18px;background:#fff;border:4px dashed #4f566a;border-radius:12px;padding:18px 26px;width:max-content">${tag}</div>
    <div style="font-size:34px;font-weight:700">このタグ、読める？　<span style="font-size:28px;color:#4f566a;font-weight:500">経済産業省・消費者庁の資料から・1日5問</span></div>
  </div></body>`);
  await p.screenshot({ path: path.join(__dirname, "..", "og.png") });
  await b.close();
})();
