// 洗濯表示よみの検査。問題の作り方（15種類×2000問を、ゲームとは別に書いた表で解き直す・答えは1つ）・今日の5問と上級の組み方（3年分）・
// 出典・通しで遊ぶ・まちがい・ヒント・続きから・上級・練習・とことん（まちがえても続く・1回の中で同じ問題なし）・記号帳・実績・カレンダー・あとから・
// 文字の大きさ・スマホ幅・PWA・引き継ぎコード・見やすさを確かめる。
// 使い方: node qa/run.mjs   失敗があれば終了コード 1。結果は qa-report/report.md。
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { checkTransfer } from "./transfer-check.mjs";
import { checkSwStall } from "./sw-check.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: !!ok, detail: String(detail).slice(0, 400) });
const G = createRequire(import.meta.url)(path.join(root, "gen.js"));

// ---- 1. 問題の作り方（ブラウザを使わない）----
// 答えを、ゲームとは別に書いた表で出し直す。表は経産省・消費者庁の資料のとおり（README の出典。温度は2024年の改正後）
const IRON_T = { 1: 120, 2: 160, 3: 210 }, TUM_T = { 1: 60, 2: 80 }, STRW = ["ふつうの", "弱い", "非常に弱い"];
const GRP = { wash: "家で洗う（洗濯）", bleach: "漂白", tumble: "乾燥機（タンブル乾燥）", dry: "干し方（自然乾燥）", iron: "アイロン", pro: "クリーニング店のドライクリーニング", wet: "クリーニング店のウエットクリーニング" };
function meanQA(s) {
  if (s.g === "wash") return s.no ? "家では洗濯できない" : s.hand ? "手洗いできる（40℃まで）" : `洗濯機で${STRW[s.b]}洗い方（${s.t}℃まで）`;
  if (s.g === "bleach") return { any: "塩素系も酸素系も、漂白剤が使える", oxy: "酸素系の漂白剤だけ使える", no: "漂白剤は使えない" }[s.v];
  if (s.g === "tumble") return s.no ? "乾燥機（タンブル乾燥）は使えない" : `乾燥機の${s.d === 2 ? "高い" : "低い"}温度で乾かせる（排気${TUM_T[s.d]}℃まで）`;
  if (s.g === "dry") return (s.shade ? "日陰で、" : "") + (s.n === 2 ? "脱水せず、ぬれたまま" : "脱水して") + (s.dir === "h" ? "平干し" : "つり干し");
  if (s.g === "iron") return s.no ? "アイロンはかけられない" : `アイロンは${IRON_T[s.d]}℃まで（${{ 1: "低", 2: "中", 3: "高" }[s.d]}温）`;
  if (s.g === "pro") return s.no ? "ドライクリーニングはできない" : `${s.l === "P" ? "パークロロエチレンなど" : "石油系"}の溶剤でドライクリーニング（${["ふつうの", "弱い"][s.b]}処理）`;
  if (s.g === "wet") return s.no ? "ウエットクリーニングはできない" : `ウエットクリーニング（${STRW[s.b]}処理）`;
}
// タグで「できない」こと（×・温度の上限・塩素系だけだめ）を、ゲームとは別に数え直す
function forbidden(tag) {
  const out = new Set(), w = tag.find((s) => s.g === "wash");
  if (w.no) out.add("家で水洗いする"); if (w.hand) { out.add("洗濯機のふつうの洗い方で洗う"); out.add("60℃のお湯で洗う"); }
  for (const t of [95, 70, 60, 40]) if (w.t && t > w.t) out.add(`${t}℃のお湯で洗う`);
  const bl = tag.find((s) => s.g === "bleach"); if (bl.v !== "any") out.add("塩素系の漂白剤を使う"); if (bl.v === "no") out.add("酸素系の漂白剤を使う");
  const tu = tag.find((s) => s.g === "tumble"); if (tu.no) out.add("乾燥機で乾かす"); if (tu.no || tu.d === 1) out.add("乾燥機の高い温度で乾かす");
  const ir = tag.find((s) => s.g === "iron"); if (ir.no) out.add("アイロンをかける"); for (const d of [2, 3]) if (ir.no || ir.d < d) out.add(`アイロンを${IRON_T[d]}℃でかける`);
  if (tag.find((s) => s.g === "pro").no) out.add("ドライクリーニングに出す"); if (tag.find((s) => s.g === "wet").no) out.add("ウエットクリーニングに出す");
  return out;
}
function expect(P) {
  const s = P.syms && P.syms[0];
  switch (P.kind) {
    case "group": return GRP[s.g];
    case "temp": return `${s.t}℃まで`;
    case "iron": return `${IRON_T[s.d]}℃まで`;
    case "cross": case "bleach": case "hand": case "dry": case "tumble": case "pro": return meanQA(s);
    case "bars": return `洗濯機で${STRW[s.b]}洗い方`;
    case "both": return `${s.t}℃まで・${STRW[s.b]}洗い方`;
    case "pair": { const [x, y] = P.syms; return `${Math.min(x.t, y.t)}℃まで・${STRW[Math.max(x.b, y.b)]}洗い方`; }
    case "tag_ok": case "tag_ng": { const f = forbidden(P.syms), want = P.kind === "tag_ng"; const hit = P.opts.filter((o) => f.has(o) === want); return hit.length === 1 ? hit[0] : "答えが1つでない:" + hit.length; }
    case "tag_dry": { const [tu, d] = P.syms; return `${tu.no ? "乾燥機は使わず" : tu.d === 2 ? "乾燥機を使ってよい。干すなら" : "乾燥機は低い温度なら使える。干すなら"}、${meanQA(d)}`; }
  }
  return "知らない種類";
}
{
  const N = 2000, bad = {}, seen = {};
  for (const k of G.KINDS) {
    seen[k.id] = new Set();
    for (let s = 0; s < N; s++) {
      const P = G.make(`${k.id}|qa${s}`), why = [];
      if (P.opts.length !== 4 || new Set(P.opts).size !== 4 || !P.opts.includes(P.ans)) why.push("選び肢が4つでない・答えが入っていない");
      if (!G.SRC[P.src]) why.push("出典が無い");
      if ([...P.scene].length > 45) why.push("場面が45字より長い");
      if (!P.syms || !P.syms.length || P.syms.some((x) => !G.ALL.some((y) => JSON.stringify(y) === JSON.stringify(x)))) why.push("記号が無い・知らない記号");
      const e = expect(P);
      if (e !== P.ans) why.push(`別の表で解き直すと「${e}」`);
      if (P.kind === "tag_ok" || P.kind === "tag_ng") { const g = P.syms.map((x) => x.g).join(); if (g !== "wash,bleach,tumble,dry,iron,pro,wet") why.push("タグの並びが洗濯→漂白→乾燥→アイロン→クリーニングでない"); }
      if (JSON.stringify(G.make(`${k.id}|qa${s}`)) !== JSON.stringify(P)) why.push("同じ種で同じ問題にならない");
      seen[k.id].add(G.keyOf(P));
      if (why.length && !bad[k.id]) bad[k.id] = [why.join("・") + "：" + P.scene + " → " + P.ans];
    }
  }
  check(`問題：${G.KINDS.length}種類×${N}問で、選び肢4つ・出典つき・答えはゲームと別の表で解き直しても同じ（タグの問題は答えが1つ）`, Object.keys(bad).length === 0, JSON.stringify(bad));
  { // どのタグでも「できる」と「できない」が重ならない・形の確かめられなかった記号（50℃・30℃の手洗い・スチームなし）は出さない・知らない種類は null
    const both = [];
    for (let i = 0; i < 3000; i++) { const t = G.ORDER.map((g, j) => { const a = G.ALL.filter((x) => x.g === g); return a[(i * 7 + j * 13 + (i >> j)) % a.length]; }); const { ok, ng } = G.tagOkNg(t); if (ok.some((o) => ng.includes(o)) || ng.some((o) => !forbidden(t).has(o))) both.push(JSON.stringify(t)); }
    check("タグ：してよいこととしてはいけないことが重ならず、してはいけないことは別の数え方と同じ（3000枚）", both.length === 0, both[0]);
    check("記号：50℃の洗濯・30℃の手洗い・スチームなしのアイロンは出さない（形を資料で確かめられていない）・知らない種類（constructor など）は null", !G.ALL.some((x) => x.t === 50 || (x.hand && x.t) || x.steam !== undefined) && G.make("constructor|x") === null && G.make("toString|x") === null);
    check("アイロンの温度は2024年の改正後（210・160・120℃）・乾燥機は80・60℃", JSON.stringify(G.IRON) === JSON.stringify({ 1: 120, 2: 160, 3: 210 }) && JSON.stringify(G.TUMBLE) === JSON.stringify({ 1: 60, 2: 80 }));
    check("記号の意味は別の表と全部同じ（記号帳の早見に出す全部の記号）", G.ALL.every((x) => G.mean(x) === meanQA(x)) && G.ALL.length === 39);
  }
  const few = G.KINDS.filter((k) => seen[k.id].size < 3).map((k) => `${k.id}:${seen[k.id].size}`);
  check("問題：どの種類も3通り以上出る", few.length === 0, few.join(","));
  const total = G.KINDS.reduce((a, k) => a + seen[k.id].size, 0);
  check("問題：ちがう問題が300種類以上（好きなだけ遊べるように。shared-workflows game-dev.md F6）", total >= 300, total);
  check("問題：種類は15（やさしい6・ふつう5・むずかしい4）", G.KINDS.length === 15 && [0, 1, 2].map((l) => G.kindsOf(l).length).join() === "6,5,4");
  const longWhy = [], longLook = [];
  for (const k of G.KINDS) for (let s = 0; s < 200; s++) { const P = G.make(`${k.id}|len${s}`); if ([...P.why].length > 160) longWhy.push(k.id); if ([...k.look].length > 45) longLook.push(k.id); }
  check("「なぜ」は160字以内・ヒントは45字以内（やさしい日本語。一文を短く）", !longWhy.length && !longLook.length, [...new Set(longWhy.concat(longLook))].join(","));
  check("出典はどれも公的機関のページ（経済産業省）", Object.values(G.SRC).every(([, u]) => /^https:\/\/www\.meti\.go\.jp\//.test(u)));
}
{
  // 今日の5問・上級の組み方（3年分）
  const bad = [], cover = new Set(); let sameAsPrev = 0, prev = "";
  const d0 = Date.parse("2026-11-07");
  for (let i = 0; i < 365 * 3; i++) {
    const d = new Date(d0 + i * 864e5).toISOString().slice(0, 10), dl = G.dailyTags(d), hl = G.hardTags(d);
    const dk = dl.map((t) => t.split("|")[0]), hk = hl.map((t) => t.split("|")[0]);
    if (dl.length !== 5 || new Set(dk).size !== 5 || dk.map((k) => G.BY[k].lv).join() !== "0,0,1,1,2") bad.push(d + " 今日");
    if (hl.length !== 3 || new Set(hk).size !== 3 || hk.some((k) => G.BY[k].lv !== 2) || hk.includes(dk[4])) bad.push(d + " 上級");
    if (JSON.stringify(dl) !== JSON.stringify(G.dailyTags(d))) bad.push(d + " 同じにならない");
    if (dk.join() === prev) sameAsPrev++; prev = dk.join();
    if (i < 60) [...dk, ...hk].forEach((k) => cover.add(k));
  }
  check("今日の5問（やさしい2・ふつう2・むずかしい1、種類は重ねない）と上級（むずかしい3・今日のむずかしいと別）を3年分作れる", bad.length === 0, bad.slice(0, 5).join(","));
  check("2か月のうちに15種類が全部出る・前の日と同じ組の日が少ない", cover.size === 15 && sameAsPrev < 20, `${cover.size}種類・前の日と同じ ${sameAsPrev}日`);
}

// ---- 2. ファイルの中身 ----
const html = readFileSync(path.join(root, "index.html"), "utf8"), gen = readFileSync(path.join(root, "gen.js"), "utf8");
const ext = [...html.matchAll(/(?:src|href)="(https?:[^"]+)"/g)].map((m) => m[1]).filter((u) => !/^https:\/\/fonts\.googleapis\.com(\/|$)|^https:\/\/ko-fi\.com\/satouaaaaa$|^https:\/\/disaportal\.gsi\.go\.jp\/$/.test(u));
check("外から読むのは文字（Google Fonts）だけ。スクリプト・広告・解析を入れない（出典のリンクは押したときに開くだけ）", ext.length === 0 && ![...html.matchAll(/<script[^>]+src="([^"]+)"/g)].some((m) => /^https?:/.test(m[1])), ext.join(","));
check("CSP で通信先を自分だけにしている", /connect-src 'self'/.test(html) && !/connect-src[^;"]*https/.test(html));
check("Math.random は練習・とことんの種だけ（今日の5問・上級は日付の乱数。gen.js には無い）", (html.match(/Math\.random/g) || []).length === 2 && !/Math\.random/.test(gen));
check("乱数は sort の比較の中で引かない（ブラウザで引く回数が変わる）", !/\.sort\(\s*\([^)]*\)\s*=>[^\n;]*\b(R|rng|rand|Math\.random)\s*\(/.test(html + gen));
check("一行の式の途中にコメント // を足さない（行の残りが消える。rosen-hitofude 2026-11-04）", !/;\s*\/\/[^\n]*;\s*\w/.test(gen.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n")));
check("記号の絵は自前で描いたこと・迷ったらタグと付記用語に従うことを、遊び方と「このゲームについて」に書く", (html.match(/このゲームで描いた/g) || []).length >= 2 && /付記用語/.test(html));
{ const hk = JSON.parse(readFileSync(path.join(root, ".claude/settings.json"), "utf8")).hooks.SessionStart || []; check("クラウドの会話を始めたときも再開したときも準備を回す（SessionStart の matcher に startup と resume）", hk.some((h) => /(^|\|)startup(\||$)/.test(h.matcher) && /(^|\|)resume(\||$)/.test(h.matcher) && JSON.stringify(h.hooks).includes("scripts/setup.sh"))); }
check("README に出典（公的機関）を並べる", Object.values(G.SRC).every(([, u]) => readFileSync(path.join(root, "README.md"), "utf8").includes(u)));
check("画面にお笑いの言葉を入れない（本物っぽく）", !/お笑い|ギャグ|ツッコミ|なんでやねん|（うそ）/.test(html));
check("引き継ぎ：transfer.js をゲームの script より前に、このゲームの記録のキーだけで読む", /<script src="transfer\.js" data-game="sentaku-hyoji" data-keys="sentaku-v1,sentaku-fs"><\/script>\s*<\/head>/.test(html) && html.indexOf('src="transfer.js"') < html.indexOf('src="gen.js"') && /data-hk/.test(html) && existsSync(path.join(root, "transfer.js")));
{ const og = (k) => (html.match(new RegExp(`<meta (?:property|name)="${k}" content="([^"]+)"`)) || [])[1] || "";
  const png = readFileSync(path.join(root, "og.png"));
  check("SNS で貼ると絵と題が出る（OGP・1200×630・絶対URL）", og("og:title") && og("og:description") && og("og:image") === "https://satou-aaaaa.github.io/sentaku-hyoji/og.png" && og("twitter:card") === "summary_large_image" && png.readUInt32BE(16) === 1200 && png.readUInt32BE(20) === 630); }
{ const fy = readFileSync(path.join(root, ".github/ISSUE_TEMPLATE/feedback.yml"), "utf8");
  check("感想フォームの name が3字以上（2字だとフォームが出ない。shared-workflows incidents/2026-11-05-feedback-form-not-shown.md）", [...((fy.match(/^name:\s*(.+)$/m) || [])[1] || "").trim()].length >= 3);
  check("感想フォームは名前・メールを聞かない", /id: fun/.test(fy) && !/id: (name|email|mail)/.test(fy) && /labels: \["感想"\]/.test(fy)); }
check("README の URL のすぐ後ろに全角の字を続けない（Link check が URL の一部と読む）", !/https?:\/\/[\x21-\x7e]*[^\x00-\x7f]/.test(readFileSync(path.join(root, "README.md"), "utf8").replace(/\]\(https?:\/\/[^)\s]+\)/g, "").replace(/<https?:\/\/[^>\s]+>/g, "")));
{ const sw = readFileSync(path.join(root, "sw.js"), "utf8"), mf = JSON.parse(readFileSync(path.join(root, "manifest.webmanifest"), "utf8"));
  const shell = JSON.parse(sw.match(/SHELL = (\[[^\]]+\])/)[1]);
  check("PWA：sw.js は画面のファイルを全部保存し（引き継ぎの transfer.js も）、外へ何も送らない", ["./index.html", "./gen.js", "./transfer.js", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"].every((f) => shell.includes(f)) && !/https?:\/\//.test(sw.replace(/^\/\/.*$/gm, "")));
  check("PWA：manifest にアイコン2つと名前がある", mf.name === "洗濯表示よみ" && mf.icons.length >= 2 && mf.start_url === "./"); }
{ const st = await checkSwStall(readFileSync(path.join(root, "sw.js"), "utf8"));
  check("PWA：本文の途中で通信が止まっても、4秒で保存したものを返す（ふつうはネットの返事。shared-workflows incidents/2026-11-07-sw-body-stall.md）", st.ok, JSON.stringify(st)); }

// ---- 3. ブラウザで遊ぶ ----
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const server = createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname), f = path.join(root, p === "/" ? "index.html" : p);
  if (path.relative(root, f).startsWith("..") || path.isAbsolute(path.relative(root, f)) || !existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" }); res.end(readFileSync(f));
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];
const TODAY = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const dayBefore = (n) => new Date(Date.parse(TODAY) - n * 864e5).toISOString().slice(0, 10);
async function newPage(w = 390, ctx) {
  const c = ctx || await browser.newContext({ viewport: { width: w, height: 800 } });
  await c.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/ERR_FAILED|net::/.test(m.text())) errors.push(m.text()); });
  await p.goto(url); await p.waitForTimeout(200);
  return p;
}
const closeHow = async (p) => { if (await p.locator("#howto[open]").count()) await p.click("#howto-ok"); };
const ansIdx = (p) => p.evaluate(() => { const c = __bs.cur(); return c.P.opts.indexOf(c.P.ans); });
const wrongIdx = (p) => p.evaluate(() => { const c = __bs.cur(); return c.P.opts.findIndex((o) => o !== c.P.ans && !c.wrong.includes(o)); });
const mem = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("sentaku-v1") || "{}"));
async function solve(p, { wrong = 0 } = {}) {
  for (let i = 0; i < wrong; i++) await p.click(`.ch[data-j="${await wrongIdx(p)}"]`);
  await p.click(`.ch[data-j="${await ansIdx(p)}"]`);
  await p.waitForSelector(".verdict");
}

try {
  // はじめて：遊び方が出る・文字の大きさ
  const p = await newPage();
  check("はじめて開くと遊び方が出る", await p.locator("#howto[open]").count() === 1);
  await p.click("#howto-ok");
  check("文字の大きさ：はじめは「大きい」（18px）", await p.evaluate(() => getComputedStyle(document.documentElement).fontSize) === "18px");
  await p.click('.fsrow button[data-fs="3"]');
  await p.reload(); await p.waitForTimeout(150);
  check("文字の大きさ：「とても大きい」にすると開き直しても残る", await p.evaluate(() => getComputedStyle(document.documentElement).fontSize) === "22px" && await p.locator('.fsrow button[data-fs="3"][aria-pressed="true"]').count() === 1);
  await p.click('.fsrow button[data-fs="2"]');
  check("ホームに今日のひとこと（記号帳の覚えること）が出る", (await p.textContent("#tip")).includes("今日のひとこと"));
  check("上級・とことん・練習は、はじめての日から押せる（鍵なし）", await p.locator("#go-h:not([disabled])").count() === 1 && await p.locator("#go-e:not([disabled])").count() === 1 && await p.locator("#go-p").count() === 1 && !/🔒|すると開く|🎫/.test(await p.textContent("#app")));

  {
    const q = await newPage();
    check("遊び方：Esc で閉じても出る", await q.locator("#howto[open]").count() === 1);
    await q.keyboard.press("Escape"); await q.waitForTimeout(100);
    const shut = await q.locator("#howto[open]").count() === 0;
    await q.evaluate(() => __bs.home()); await q.waitForTimeout(100);
    const home = await q.locator("#howto[open]").count() === 0;
    await q.reload(); await q.waitForTimeout(150);
    check("遊び方：Esc で閉じたあと、ホームに戻っても開き直しても出ない（2026-11-07 shared-workflows #186）", shut && home && await q.locator("#howto[open]").count() === 0);
    await q.close();
  }

  {
    // 引き継ぎなどで入った、答えの数が足りない日の記録は捨てる（2026-11-07 CodeRabbit：{m:[]} で「全部まちがいなし」になった）
    const q = await newPage();
    await q.evaluate((d) => { localStorage.setItem("sentaku-v1", JSON.stringify({ v: 1, tut: true, days: { [d]: { m: [] } }, hdays: { [d]: { m: [0, 0, 0, 0, 0] } }, adays: {}, dex: {}, runs: {}, kofi: {}, ach: {}, ebest: 0 })); }, await q.evaluate(() => __bs.todayKey()));
    await q.reload(); await q.waitForTimeout(150);
    const s = await q.evaluate(() => __bs.load());
    check("記録の読み込み：今日の5問は5つ・上級は3つの答えがある日だけ残す", !Object.keys(s.days).length && !Object.keys(s.hdays).length);
    await q.close();
  }
  check("「動きを減らす」のときは、次へのボタンへすべらずに移る", /scrollIntoView\(\{ behavior: window\.A11y && A11y\.on\("calm"\) \? "instant"/.test(html));

  // 今日の5問：1問目はまちがえる、2問目はヒント2回、ほかはそのまま
  await p.click("#go-d");
  const tags = await p.evaluate(() => __bs.load().runs.d.list);
  check("今日の5問は日付から決まる（gen.js の dailyTags と同じ）", JSON.stringify(tags) === JSON.stringify(G.dailyTags(TODAY)));
  check("問題の画面：分野の印・場面・問い・大きな選び肢4つ（高さ72px以上）", await p.locator("#qpad .cat").count() === 1 && (await p.textContent("#qpad .scene")).length > 5 && await p.locator("#qpad .q2").count() === 1 && (await p.$$eval(".ch", (b) => b.map((x) => x.getBoundingClientRect().height))).every((h) => h >= 72) && await p.locator(".ch").count() === 4);
  {
    // タグの問題：記号ごとに形の読み上げ（意味は言わない）・絵は aria-hidden
    await p.evaluate(() => { __bs.save((s) => { s.runs.p = { mode: "p", date: __bs.todayKey(), list: ["tag_ok|qa-tag"], res: [], cur: null, id: "qatag", a0: [] }; }); __bs.play("p"); });
    await p.waitForTimeout(100);
    const labs = await p.$$eval(".syms .sym", (x) => x.map((e) => e.getAttribute("aria-label")));
    const P0 = G.make("tag_ok|qa-tag");
    check("タグの記号は7つ、それぞれ形の説明を読み上げる（意味＝答えは言わない）・絵は読み上げない", labs.length === 7 && labs.every((l, i) => l === G.shape(P0.syms[i])) && !labs.some((l) => P0.opts.includes(l)) && await p.locator(".syms svg[aria-hidden=true]").count() === 7);
    const said = await p.evaluate(() => [...document.querySelectorAll("[data-a11y-say]")].map((el) => el.getAttribute("aria-label") || el.innerText).join("。"));
    const opt0 = await p.textContent(".ch");
    check("「🔊 読む」の対象に、場面・7つの記号の形（文書の順）・問い・選び肢が入る（2026-11-07 CodeRabbit：タグの入れ物の名前だけで形を読まなかった）", said.includes(P0.scene) && said.includes(P0.syms.map((x) => G.shape(x)).join("。")) && said.includes(P0.ask) && said.includes(opt0.trim()));
    await p.evaluate(() => { __bs.save((s) => { s.runs.p = { mode: "p", date: __bs.todayKey(), list: ["pair|qa-pair"], res: [], cur: null, id: "qapair", a0: [] }; }); __bs.play("p"); });
    await p.waitForTimeout(100);
    check("2枚の服の問題は、それぞれの服の名前と記号を並べる", await p.locator(".syms.pair .sym").count() === 2 && /シャツの記号：/.test(await p.getAttribute(".syms.pair .sym", "aria-label")));
    await p.evaluate(() => { __bs.save((s) => { s.runs.p = null; }); __bs.home(); });
    check("ホーム（遊ぶ前）には Ko-fi のリンクを出さない", await p.locator('a[href*="ko-fi.com"]').count() === 0);
    await p.click("#go-d");
  }
  await p.click(`.ch[data-j="${await wrongIdx(p)}"]`);
  check("まちがえると ✕ の印と「ちがう」の文字（色だけで分けない）・知らせは role=status", await p.locator(".ch.ng").count() === 1 && (await p.evaluate(() => getComputedStyle(document.querySelector(".ch.ng"), "::after").content)).includes("ちがう") && (await p.textContent("#msg")).includes("ちがいます") && await p.getAttribute("#msg", "role") === "status");
  // 開き直しても、まちがえた選び肢は残る
  await p.reload(); await p.waitForTimeout(150); await p.click("#go-d");
  check("途中で閉じても続きから（同じ問題・まちがえた印のまま）", await p.locator(".ch.ng").count() === 1 && await p.evaluate(() => __bs.cur().i) === 0);
  await solve(p);
  check("正解すると ✓ の印・「なぜ」・出典のリンク・★2（まちがい1回）", await p.locator(".ch.ok").count() === 1 && (await p.textContent(".verdict .why")).includes("なぜ") && /^https:\/\/www\.meti\.go\.jp\//.test(await p.getAttribute(".verdict .src a", "href")) && (await p.getAttribute(".verdict .stars", "aria-label")) === "星2つ");
  await p.click("#next");
  await p.click("#hint");
  check("ヒント1は見るところを言う（答えは言わない）", (await p.textContent("#hintbox")).includes("💡") && await p.locator(".ch.ng").count() === 0);
  await p.click("#hint");
  check("ヒント2はまちがいの選び肢を消し、2つにしぼる・ヒントは2回まで", await p.locator(".ch.ng").count() === 2 && await p.locator("#hint:disabled").count() === 1);
  await solve(p);
  check("ヒント2回は★1", (await p.getAttribute(".verdict .stars", "aria-label")) === "星1つ");
  await p.click("#next");
  for (let i = 2; i < 5; i++) { await solve(p); await p.click("#next"); }
  await p.waitForTimeout(150);
  const s1 = await mem(p);
  check("5問で結果：今日の記録に1問ごとのまちがい（1・2・0・0・0）", JSON.stringify(s1.days[TODAY]?.m) === "[1,2,0,0,0]");
  const share = await p.textContent(".share");
  check("シェアの文に答え・問題を出さない（印だけ）", /第\d+回/.test(share) && /🟢/.test(share) && !/℃|干し|漂白|アイロン|乾燥|クリーニング|洗濯機/.test(share), share);
  check("まちがいのある日は Ko-fi の一言を出さない", await p.locator(".kofi").count() === 0);
  check("結果に「あと少しの実績」と、続けて遊ぶ・上級のボタン", await p.locator("#achnext").count() === 1 && await p.locator("#go-e").count() === 1 && await p.locator("#go-h").count() === 1);
  check("記号帳に解いた種類が載る", Object.keys(s1.dex).length === 5);
  await p.click("#back");
  check("今日を終えたら、ホームは「今日の結果を見る」と上級", (await p.textContent("#go-d")).includes("結果") && await p.locator("#go-h").count() === 1);
  // 上級：ヒントなし・3問
  await p.click("#go-h");
  check("上級はヒントのボタンが無い・3問", await p.locator("#hint").count() === 0 && (await p.evaluate(() => __bs.load().runs.h.list.length)) === 3);
  for (let i = 0; i < 3; i++) { await solve(p); await p.click("#next"); }
  await p.waitForTimeout(150);
  check("上級の記録は hdays に入る", (await mem(p)).hdays[TODAY]?.m.length === 3);
  // 練習：記録を増やさない
  await p.click("#back"); await p.click("#go-p"); await p.click('.lv button[data-t="2"]');
  const before = await mem(p);
  for (let i = 0; i < 5; i++) { await solve(p); await p.click("#next"); }
  await p.waitForTimeout(150);
  const after = await mem(p);
  check("練習は今日の記録を増やさない（記号帳の数はふえる）", JSON.stringify(after.days) === JSON.stringify(before.days) && Object.values(after.dex).reduce((a, b) => a + b) === Object.values(before.dex).reduce((a, b) => a + b) + 5);
  // 記号帳からその種類だけで練習
  await p.click("#back"); await p.click("#go-dex");
  const firstKind = await p.getAttribute(".book button", "data-k"), nts = await p.locator(".book .nt").count();
  await p.click(".book button");
  check("記号帳に覚えることが出て、種類を押すとその種類だけで練習", nts >= 1 && (await p.evaluate(() => __bs.load().runs.p.list)).every((t) => t.startsWith(firstKind + "|")));
  // とことん：まちがえても終わらない・「ここで降りる」で終わる・自己ベストは一度で正解した数
  await p.click("#back"); await p.click("#go-e");
  const el = await p.evaluate(() => __bs.load().runs.e.list);
  check("とことんは100問から始まり、1回の中で同じ問題（記号・答え）を出さない", el.length === 100 && await p.evaluate((l) => __bs.keysOf(l).size, el) === 100, el.length);
  await solve(p); await p.click("#next"); await solve(p); await p.click("#next");
  await solve(p, { wrong: 3 }); await p.click("#next");
  await p.click("#hint"); await p.click("#hint"); await solve(p); await p.click("#next");
  check("とことんは、まちがえてもヒントを使っても続く（🌸・チケットなし）", await p.locator(".ch").count() === 4 && await p.evaluate(() => __bs.cur().i) === 4 && !/🌸|🎫/.test(await p.textContent("#app")));
  await p.click("#quit"); await p.waitForTimeout(150);
  check("「ここで降りる」で結果：解いた数と、一度で正解した数", (await p.textContent("#eres")).includes("4問") && (await p.textContent("#eclean")).includes("一度で正解 2問"));
  await p.reload(); await p.waitForTimeout(250);
  check("降りたあとに開き直しても、続きからにならない", await p.locator(".ch").count() === 0);
  check("とことんの自己ベスト（一度で正解の数）が残る", (await mem(p)).ebest === 2);
  {
    // 残りが少なくなったら足して続ける（終わらない）
    const q = await newPage(); await closeHow(q);
    await q.evaluate(() => { __bs.save((s) => { const l = __bs.endlessList("qa"); s.runs.e = { mode: "e", date: __bs.todayKey(), list: l, res: l.slice(0, 95).map(() => ({ m: 0 })), cur: null, id: "qaend", a0: [] }; }); __bs.play("e"); });
    await q.waitForTimeout(200);
    const r = await q.evaluate(() => { const r = __bs.load().runs.e; return [r.list.length, __bs.keysOf(r.list).size]; });
    check("とことんは残りが少なくなると問題を足して続く（足した分も重ならない）", r[0] === 140 && r[1] === 140, r.join(","));
    let dup = 0;
    for (let i = 0; i < 300; i++) { const n = await q.evaluate(() => { const l = __bs.endlessList(); return l.length - __bs.keysOf(l).size; }); dup += n; }
    check("とことんの並びを300回作っても、1回の中で同じ問題は1つも無い", dup === 0, dup);
    await q.context().close();
  }
  {
    // 引き継ぎコードなどで数の所に文字が入っても、画面に HTML として出さない（2026-11-05 CodeRabbit）
    const q = await newPage(); await closeHow(q);
    await q.evaluate(() => { const s = JSON.parse(localStorage.getItem("sentaku-v1")) || { v: 1 }; s.ebest = '<img id="xss" src=x>'; s.dex = { temp: '"><b id="xss2">' }; s.runs = { e: { mode: "e", id: "x", date: "2026-11-05", list: ["temp|1"], res: [], life: '"><i id="xss3">' }, h: { list: "bad", res: [] }, p: { mode: "p", id: "y", date: "2026-11-05", list: ["constructor|1"], res: [] }, d: { mode: "d", id: "z", date: "x", list: ["temp|1"], res: [] }, a1: { mode: "a", id: "a1", date: "2026-11-04", list: ["temp|1"], res: [null] }, a2: { mode: "a", id: "a2", date: "2026-11-03", list: "bad", res: [] }, a3: { mode: "a", id: "a3", date: "2026-11-02", list: ["temp|1", "temp|2"], res: [{ m: 0 }], cur: { i: 1, tag: "temp|2", wrong: "x", hints: 0 } } }; s.days = { "2026-11-05": { m: "x" }, bad: { m: [0] }, "2026-02-30": { m: [0] } }; localStorage.setItem("sentaku-v1", JSON.stringify(s)); });
    await q.reload(); await q.waitForTimeout(250);
    const st = await q.evaluate(() => __bs.load());
    check("記録の形を直す：数の所の文字は0に・形のちがう途中経過と日ごとの記録は捨てる", st.ebest === 0 && st.dex.temp === 0 && !("life" in st.runs.e) && !("h" in st.runs) && !("p" in st.runs) && !("d" in st.runs) && !("a1" in st.runs) && !("a2" in st.runs) && st.runs.a3 && st.runs.a3.cur === null && Object.keys(st.days).length === 0);
    await q.click("#go-e").catch(() => {}); await q.waitForTimeout(150);
    check("記録の文字を HTML として出さない", await q.locator("#xss, #xss2, #xss3").count() === 0);
    await q.context().close();
  }
  // 実績・このゲームについて
  await p.evaluate(() => __bs.home()); await p.click("#go-ach");
  check("実績は13個で、腕前・集める・続けるの3つの組", await p.locator(".ach").count() === 13 && await p.locator(".agrp").count() === 3 && await p.locator(".ach.got").count() >= 3);
  check("達成した実績は ✓ の文字も付く（色だけで分けない）", (await p.textContent(".ach.got b")).startsWith("✓"));
  await p.click("#back"); await p.click("#f-about");
  check("このゲームについて：出典（公的機関）と、絵・付記用語の注意", (await p.textContent("#about")).includes("付記用語") && await p.locator("#about a").count() >= Object.keys(G.SRC).length);
  await p.context().close();

  // まちがいなしの日は Ko-fi を1回だけ
  {
    const q = await newPage(); await closeHow(q); await q.click("#go-d");
    for (let i = 0; i < 5; i++) { await solve(q); await q.click("#next"); }
    await q.waitForTimeout(150);
    check("全部まちがいなしで初めて終えたときだけ Ko-fi の一言", await q.locator(".kofi").count() === 1 && (await q.textContent(".big")).includes("まちがいなし"));
    await q.click("#back"); await q.click("#go-d");
    check("結果をもう一度見ても Ko-fi は出さない", await q.locator(".kofi").count() === 0);
    await q.context().close();
  }

  // カレンダー・あとから：過去の日の記録を置いて見る。公開から8日たつまでは、時計を10日先に進めて見る（第1回より前の日は遊べないため）
  {
    const shift = Date.parse(TODAY) - Date.parse("2026-11-07") < 8 * 864e5 ? 10 * 864e5 : 0;
    const T2 = new Date(Date.now() + shift + 9 * 3600e3).toISOString().slice(0, 10), dayBefore = (n) => new Date(Date.parse(T2) - n * 864e5).toISOString().slice(0, 10);
    const cx = await browser.newContext({ viewport: { width: 390, height: 800 } });
    if (shift) await cx.clock.setFixedTime(new Date(Date.now() + shift));
    const q = await newPage(390, cx);
    await q.evaluate(([d2, d3]) => { localStorage.setItem("sentaku-v1", JSON.stringify({ v: 1, tut: true, days: { [d2]: { m: [0, 0, 0, 0, 0], k: [] }, [d3]: { m: [1, 0, 0, 2, 0], k: [] } }, hdays: {}, adays: {}, dex: {}, runs: {}, kofi: {}, ach: {}, ebest: 0 })); }, [dayBefore(2), dayBefore(3)]);
    await q.reload(); await q.waitForTimeout(150);
    check("ホームの「続けて」は、きのうを休んだら — （休んだ日を責めない）", (await q.textContent(".stats")).includes("—"));
    await q.click("#go-cal");
    const lateList = await q.evaluate(() => __bs.lateDays(__bs.load()));
    const exp = [1, 4, 5, 6, 7].map(dayBefore).filter((d) => d >= "2026-11-07");
    check("カレンダー：取りこぼした過去7日（第1回より後）を押せる", JSON.stringify(lateList) === JSON.stringify(exp), lateList.join(","));
    check("カレンダー：遊んだ日は★の数の文字も付く", (await q.locator(".cal .c.p3").count()) + (await q.locator(".cal .c.p2").count()) + (await q.locator(".cal .c.p1").count()) >= (dayBefore(3).slice(0, 7) === T2.slice(0, 7) ? 2 : 0));
    if (lateList.length) {
      const d = lateList[0];
      await q.evaluate((d) => { const b = document.querySelector(`.cal .miss[data-k="${d}"]`); if (b) b.click(); else { const m = document.querySelector(".calnav #prev"); m && m.click(); } }, d);
      if (!(await q.locator(".ch").count())) await q.click(`.cal .miss[data-k="${d}"]`);
      check("あとから：その日の今日の5問と同じ問題", JSON.stringify(await q.evaluate((d) => __bs.load().runs["a:" + d].list, d)) === JSON.stringify(G.dailyTags(d)));
      for (let i = 0; i < 5; i++) { await solve(q); await q.click("#next"); }
      await q.waitForTimeout(150);
      const s = await mem(q);
      check("あとからは adays に入り、今日の記録・続けた日には数えない", s.adays[d] && !s.days[d] && (await q.locator(".share").count()) === 0 && (await q.locator(".kofi").count()) === 0);
    } else check("あとから：遊べる日がある", false, "第1回の日から日がたっていない");
    await q.context().close();
  }

  // 古いタブ：同じ問題を2つのタブで開き、片方で答えたら、もう片方は二重に入れない
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
    const a = await newPage(390, ctx); await closeHow(a); await a.click("#go-d");
    const b = await ctx.newPage(); b.on("pageerror", (e) => errors.push(e.message)); await b.goto(url); await b.waitForTimeout(150); await b.click("#go-d");
    await solve(a);
    await b.click(`.ch[data-j="${await ansIdx(b)}"]`);
    await b.waitForTimeout(200);
    const s = await mem(a);
    check("古いタブで同じ問題に答えても二重に数えない", s.runs.d.res.length === 1 && Object.values(s.dex).reduce((x, y) => x + y) === 1);
    // ヒントの数は、別のタブで使った分も減らさない
    await a.click("#next"); await b.goto(url); await b.waitForTimeout(150); await b.click("#go-d");
    await a.click("#hint"); await a.click("#hint");
    await b.click("#hint");
    check("別のタブで使ったヒントの数を減らさない", (await mem(a)).runs.d.cur.hints === 2);
    await ctx.close();
  }

  // スマホ幅・とても大きい文字でもはみ出さない・押す所は44px以上
  {
    const bad = [], small = [];
    for (const [w, fs] of [[320, 3], [390, 2], [320, 1]]) {
      const q = await newPage(w); await closeHow(q);
      await q.evaluate((fs) => localStorage.setItem("sentaku-fs", String(fs)), fs); await q.reload(); await q.waitForTimeout(150);
      for (const go of [null, "#go-d", "solve", "#go-cal", "#go-dex", "#go-ach", "#go-e"]) {
        if (go === "solve") { await solve(q); }
        else if (go) { await q.goto(url); await q.waitForTimeout(100); await q.click(go); }
        await q.waitForTimeout(100);
        const ov = await q.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (ov > 0) bad.push(`${w}px 文字${fs} ${go || "ホーム"} ${ov}px`);
        small.push(...(await q.$$eval("button:not([disabled]), a[href]", (bs) => bs.filter((b) => b.checkVisibility() && !b.closest(".cal")).filter((b) => b.getBoundingClientRect().height < 44).map((b) => (b.id || b.className || b.textContent).slice(0, 20)))).map((x) => `${w}/${fs}/${go}:${x}`));
      }
      await q.context().close();
    }
    check("幅320px・とても大きい文字でも横にはみ出さない", bad.length === 0, bad.join(" / "));
    check("押せる所は高さ44px以上", small.length === 0, [...new Set(small)].slice(0, 8).join(","));
  }

  // 見やすさの設定を全部入れても、ページの一番下まで動ける（読み上げの class が html に当たって固まった。2026-11-05）
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 700 } });
    await ctx.addInitScript(() => localStorage.setItem("a11y-v1", JSON.stringify({ read: true, cvd: true, calm: true, say: true, ruby: true })));
    const q = await newPage(390, ctx); await closeHow(q);
    const r = await q.evaluate(() => { window.scrollTo(0, 1e5); const f = document.querySelector("footer").getBoundingClientRect(); return [scrollY, Math.round(f.bottom), innerHeight, getComputedStyle(document.documentElement).position]; });
    check("見やすさの設定を全部入れても、いちばん下まで動ける（html が固定されない）", r[0] > 0 && r[1] <= r[2] && r[3] === "static", r.join(","));
    await ctx.close();
  }
  // キーボードだけで遊べる（Tab と Enter）
  {
    const q = await newPage(); await closeHow(q);
    await q.focus("#go-d"); await q.keyboard.press("Enter"); await q.waitForTimeout(100);
    const j = await ansIdx(q);
    await q.focus(`.ch[data-j="${j}"]`); await q.keyboard.press("Enter"); await q.waitForTimeout(100);
    check("キーボードだけで選んで答えられる", await q.locator(".verdict").count() === 1);
    await q.context().close();
  }
} catch (e) { check("ブラウザでの検査が最後まで動く", false, e.stack.split("\n").slice(0, 3).join(" ")); }

// 引き継ぎコード（shared-workflows template/qa/transfer-check.mjs）
try {
  const sample = { "sentaku-v1": JSON.stringify({ v: 1, tut: true, days: { "2026-11-07": { m: [0, 1, 0, 0, 2], k: ["temp", "iron", "dry", "pro", "pair"] } }, hdays: {}, adays: {}, dex: { temp: 1, iron: 1, dry: 1, pro: 1, pair: 1 }, runs: {}, kofi: {}, ach: {}, ebest: 7, t: 1 }), "sentaku-fs": "3" };
  await checkTransfer({ browser, url, game: "sentaku-hyoji", sample, check, open: async (pg) => { if (await pg.locator("#howto[open]").count()) await pg.click("#howto-ok"); } });
} catch (e) { check("引き継ぎの検査が最後まで動く", false, e.message.split("\n")[0]); }
await browser.close();
server.close();
check("画面のエラーが無い", errors.length === 0, errors.slice(0, 3).join(" | "));

{ // 見やすさ・読みやすさ・偏り（shared-workflows template/qa/a11y.mjs の写し）
  const { spawnSync } = await import("node:child_process");
  const a = spawnSync(process.execPath, [path.join(root, "qa", "a11y.mjs")], { encoding: "utf8", env: process.env });
  check("見やすさ・読みやすさの検査（qa/a11y.mjs。中身は qa-report/a11y.md）", a.status === 0, (a.stdout.match(/^- ❌.*$/gm) || []).join(" / ") || (a.status ? a.stderr.slice(-300) : ""));
}

const ng = results.filter((r) => !r.ok);
const md = `# 洗濯表示よみ QA\n\n${results.map((r) => `- ${r.ok ? "✅" : "❌"} ${r.name}${r.detail ? `（${r.detail}）` : ""}`).join("\n")}\n\n${ng.length ? `❌ ${ng.length}件` : `✅ ${results.length}項目すべて通過`}\n`;
mkdirSync(path.join(root, "qa-report"), { recursive: true });
writeFileSync(path.join(root, "qa-report/report.md"), md);
console.log(md);
process.exit(ng.length ? 1 : 0);
