// 洗濯表示よみの問題を作る（ブラウザと node の両方で使う）。
// 1問 = 洗濯表示の記号（1つ、服のタグ、2枚の服）を見て、意味や、していいことを選ぶ。
// 記号の意味は経済産業省・消費者庁の資料（JIS L 0001。2024年8月の改正後の温度）で確かめたことだけ（出典は SRC。README にも同じ一覧）。
// 形の確かめられなかった記号（30℃の手洗い・スチームなしのアイロン・50℃の洗濯）は問題に出さない。
// 乱数 R は呼ぶ回数が毎回同じになるように使う（sort の比較の中では引かない）。同じ種なら、どの端末でも同じ問題になる。
(function (root) {
  "use strict";
  const LV = ["やさしい", "ふつう", "むずかしい"];
  const SRC = {
    P: ["経済産業省・消費者庁 衣類の新しい「取扱い表示」で上手な洗濯！（パンフレット）", "https://www.meti.go.jp/policy/economy/hyojun-kijun/keihatsu/pamphlet/pdf/sentakupanf.pdf"],
    H: ["経済産業省 衣類の「取扱表示」早見表（令和6年8月改正）", "https://www.meti.go.jp/policy/economy/hyojun-kijun/keihatsu/pamphlet/pdf/sentakuhayami.pdf"],
    R: ["経済産業省 繊維製品の洗濯表示に関する JIS の改正（2024年8月20日）", "https://www.meti.go.jp/press/2024/08/20240820001/20240820001-3r.pdf"],
  };

  const pickN = (R, arr, n) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n); };
  const shuffle = (R, arr) => pickN(R, arr, arr.length);
  const one = (R, arr) => arr[Math.floor(R() * arr.length)];
  // 答えと、まちがい（重ならないものを順に）を合わせて n 個にし、並びを混ぜる
  function opts(R, ans, wrongs, n = 4) {
    const out = [];
    for (const w of wrongs) { if (w && w !== ans && !out.includes(w)) out.push(w); if (out.length === n - 1) break; }
    return shuffle(R, [ans, ...out]);
  }

  // ---- 記号（g：グループ）----
  // wash：家庭の洗濯（おけ）。t＝液温の上限、b＝下の線の数（0 ふつう・1 弱い・2 非常に弱い）、hand＝手洗い（40℃まで）、no＝×
  // bleach：漂白（三角）。v＝any（塩素系も酸素系も）・oxy（酸素系だけ）・no
  // tumble：タンブル乾燥（四角の中に丸）。d＝点の数（2 高温・1 低温）、no
  // dry：自然乾燥（四角の中の線）。dir＝v（縦：つり干し）・h（横：平干し）、n＝線の数（1 脱水して・2 脱水せず）、shade＝左上の斜線（日陰）
  // iron：アイロン。d＝点の数（3 210℃・2 160℃・1 120℃）、no
  // pro：ドライクリーニング（丸に P・F）。l＝P・F、b＝下の線（0・1）、no
  // wet：ウエットクリーニング（丸に W）。b＝下の線（0・1・2）、no
  const GROUPS = { wash: "家で洗う（洗濯）", bleach: "漂白", tumble: "乾燥機（タンブル乾燥）", dry: "干し方（自然乾燥）", iron: "アイロン", pro: "クリーニング店のドライクリーニング", wet: "クリーニング店のウエットクリーニング" };
  const WASH_OK = [[95, 0], [70, 0], [60, 0], [60, 1], [40, 0], [40, 1], [40, 2], [30, 0], [30, 1], [30, 2]];
  const TEMPS = [95, 70, 60, 40, 30];
  const STR = ["ふつうの", "弱い", "非常に弱い"];
  const IRON = { 3: 210, 2: 160, 1: 120 };
  const TUMBLE = { 2: 80, 1: 60 };
  const ALL = [];
  for (const [t, b] of WASH_OK) ALL.push({ g: "wash", t, b });
  ALL.push({ g: "wash", hand: true }, { g: "wash", no: true });
  ALL.push({ g: "bleach", v: "any" }, { g: "bleach", v: "oxy" }, { g: "bleach", v: "no" });
  ALL.push({ g: "tumble", d: 2 }, { g: "tumble", d: 1 }, { g: "tumble", no: true });
  for (const shade of [false, true]) for (const dir of ["v", "h"]) for (const n of [1, 2]) ALL.push({ g: "dry", dir, n, shade });
  ALL.push({ g: "iron", d: 3 }, { g: "iron", d: 2 }, { g: "iron", d: 1 }, { g: "iron", no: true });
  ALL.push({ g: "pro", l: "P", b: 0 }, { g: "pro", l: "P", b: 1 }, { g: "pro", l: "F", b: 0 }, { g: "pro", l: "F", b: 1 }, { g: "pro", no: true });
  ALL.push({ g: "wet", b: 0 }, { g: "wet", b: 1 }, { g: "wet", b: 2 }, { g: "wet", no: true });
  const of = (g) => ALL.filter((s) => s.g === g);
  const symKey = (s) => JSON.stringify(s);

  // 記号の意味（早見表・パンフレットの言い方にそろえる）
  function mean(s) {
    switch (s.g) {
      case "wash": return s.no ? "家では洗濯できない" : s.hand ? "手洗いできる（40℃まで）" : `洗濯機で${STR[s.b]}洗い方（${s.t}℃まで）`;
      case "bleach": return s.v === "any" ? "塩素系も酸素系も、漂白剤が使える" : s.v === "oxy" ? "酸素系の漂白剤だけ使える" : "漂白剤は使えない";
      case "tumble": return s.no ? "乾燥機（タンブル乾燥）は使えない" : `乾燥機の${s.d === 2 ? "高い" : "低い"}温度で乾かせる（排気${TUMBLE[s.d]}℃まで）`;
      case "dry": return `${s.shade ? "日陰で、" : ""}${s.n === 1 ? "脱水して" : "脱水せず、ぬれたまま"}${s.dir === "v" ? "つり干し" : "平干し"}`;
      case "iron": return s.no ? "アイロンはかけられない" : `アイロンは${IRON[s.d]}℃まで（${["", "低", "中", "高"][s.d]}温）`;
      case "pro": return s.no ? "ドライクリーニングはできない" : `${s.l === "P" ? "パークロロエチレンなど" : "石油系"}の溶剤でドライクリーニング（${["ふつうの", "弱い"][s.b]}処理）`;
      case "wet": return s.no ? "ウエットクリーニングはできない" : `ウエットクリーニング（${["ふつうの", "弱い", "非常に弱い"][s.b]}処理）`;
    }
    return "";
  }
  // 形の説明（読み上げ用。意味は言わない）
  function shape(s) {
    const bars = (b) => (b ? `、下に線${b}本` : "");
    switch (s.g) {
      case "wash": return s.no ? "おけの形に×" : s.hand ? "おけの中に手" : `おけの中に数字${s.t}${bars(s.b)}`;
      case "bleach": return s.v === "any" ? "三角" : s.v === "oxy" ? "三角の中に斜めの線2本" : "三角に×";
      case "tumble": return s.no ? "四角の中に丸、それに×" : `四角の中に丸、丸の中に点${s.d}つ`;
      case "dry": return `四角の中に${s.dir === "v" ? "縦" : "横"}の線${s.n}本${s.shade ? "、左上に斜めの線" : ""}`;
      case "iron": return s.no ? "アイロンの形に×" : `アイロンの形、中に点${s.d}つ`;
      case "pro": return s.no ? "丸に×" : `丸の中に${s.l}${bars(s.b)}`;
      case "wet": return s.no ? "丸の中にWと×" : `丸の中にW${bars(s.b)}`;
    }
    return "";
  }

  // ---- 服のタグ：していいこと・してはいけないこと ----
  function okNg(s) {
    const ok = [], ng = [];
    switch (s.g) {
      case "wash":
        if (s.no) ng.push("家で水洗いする");
        else if (s.hand) { ok.push("手で洗う（40℃まで）"); ng.push("洗濯機のふつうの洗い方で洗う", "60℃のお湯で洗う"); }
        else { ok.push(`洗濯機で洗う（${s.t}℃まで）`); const hot = TEMPS.filter((x) => x > s.t).pop(); if (hot) ng.push(`${hot}℃のお湯で洗う`); }
        break;
      case "bleach":
        if (s.v === "any") ok.push("塩素系の漂白剤を使う", "酸素系の漂白剤を使う");
        else if (s.v === "oxy") { ok.push("酸素系の漂白剤を使う"); ng.push("塩素系の漂白剤を使う"); }
        else ng.push("塩素系の漂白剤を使う", "酸素系の漂白剤を使う");
        break;
      case "tumble":
        if (s.no) ng.push("乾燥機で乾かす");
        else if (s.d === 2) ok.push("乾燥機で乾かす");
        else { ok.push("乾燥機の低い温度で乾かす"); ng.push("乾燥機の高い温度で乾かす"); }
        break;
      case "dry": ok.push(mean(s)); break; // 干し方はおすすめなので、ほかの干し方を「してはいけない」とは言わない
      case "iron":
        if (s.no) ng.push("アイロンをかける");
        else { ok.push(`アイロンを${IRON[s.d]}℃までの温度でかける`); if (s.d < 3) ng.push(`アイロンを${IRON[s.d + 1]}℃でかける`); }
        break;
      case "pro": if (s.no) ng.push("ドライクリーニングに出す"); else ok.push("ドライクリーニングに出す"); break;
      case "wet": if (s.no) ng.push("ウエットクリーニングに出す"); else ok.push("ウエットクリーニングに出す"); break;
    }
    return { ok, ng };
  }
  // 並ぶ順（パンフレット：洗濯→漂白→乾燥→アイロン→クリーニング）
  const ORDER = ["wash", "bleach", "tumble", "dry", "iron", "pro", "wet"];
  function makeTag(R) { return ORDER.map((g) => one(R, of(g))); }
  function tagOkNg(tag) { const ok = [], ng = []; for (const s of tag) { const x = okNg(s); ok.push(...x.ok); ng.push(...x.ng); } return { ok, ng }; }
  // 条件に合うタグができるまで作り直す（呼ぶ回数は種で決まる）
  function tagWhere(R, f) { for (let i = 0; i < 200; i++) { const t = makeTag(R); if (f(t)) return t; } return null; }

  const meanOpts = (R, s, pool) => { const a = mean(s); return { ans: a, opts: opts(R, a, shuffle(R, pool.filter((x) => symKey(x) !== symKey(s)).map(mean))) }; };

  // 1問ずつの作り方：id・難しさ・分野・名前・見るところ（ヒント1）・覚えること（記号帳）・作り方
  const KINDS = [
    // ===== やさしい =====
    { id: "group", lv: 0, cat: "表示", name: "何の記号？", look: "おけ＝洗う、三角＝漂白、四角＝乾かす、アイロン、丸＝クリーニング店です。",
      note: "記号の形で分かれる。おけ＝家で洗う、三角＝漂白、四角＝乾かす（中に丸は乾燥機）、アイロンの形、丸＝クリーニング店。",
      make(R) {
        const s = one(R, ALL.filter((x) => !x.no)), a = GROUPS[s.g];
        return { scene: "服のタグに、この記号があった。", syms: [s], ask: "何についての記号？", ans: a, opts: opts(R, a, shuffle(R, Object.values(GROUPS).filter((x) => x !== a))),
          why: `${shape(s)}は「${a}」の記号。意味は「${mean(s)}」です。`, src: "P" };
      } },
    { id: "temp", lv: 0, cat: "洗う", name: "おけの中の数字", look: "おけの中の数字は、洗う水（洗濯液）の温度の上限です。",
      note: "おけの中の数字は、洗う水の温度の上限（℃）。40なら40℃まで。",
      make(R) {
        const s = one(R, of("wash").filter((x) => x.t && !x.b)), a = `${s.t}℃まで`;
        return { scene: "服のタグに、この記号があった。", syms: [s], ask: "洗う水の温度は？", ans: a, opts: opts(R, a, shuffle(R, TEMPS.filter((t) => t !== s.t).map((t) => `${t}℃まで`))),
          why: `おけの中の数字は、洗濯液の温度の上限です。この記号は${s.t}℃まで。`, src: "P" };
      } },
    { id: "cross", lv: 0, cat: "表示", name: "×の記号", look: "×がついた記号は「できない」という意味です。形で何ができないかを見ましょう。",
      note: "×がついた記号は「その扱いはできない」。おけに×は家で洗えない、三角に×は漂白できない、アイロンに×はかけられない。",
      make(R) {
        const s = one(R, ALL.filter((x) => x.no || x.v === "no")), pool = ALL.filter((x) => (x.no || x.v === "no") && x.g !== s.g);
        const a = mean(s), yes = one(R, of(s.g).filter((x) => !x.no && x.v !== "no"));
        return { scene: "服のタグに、×のついた記号があった。", syms: [s], ask: "どういう意味？", ans: a, opts: opts(R, a, [mean(yes), ...shuffle(R, pool).map(mean)]),
          why: `${shape(s)}は「${a}」。×は「その扱いはできない」という意味です。`, src: "P" };
      } },
    { id: "bleach", lv: 0, cat: "漂白", name: "漂白の三角", look: "三角は漂白の記号。中の斜めの線と×を見ましょう。",
      note: "三角だけ＝塩素系も酸素系も使える。中に斜めの線＝酸素系だけ。×＝漂白剤は使えない。",
      make(R) { const s = one(R, of("bleach")), m = meanOpts(R, s, of("bleach")); m.opts = opts(R, m.ans, [...of("bleach").filter((x) => x.v !== s.v).map(mean), "塩素系の漂白剤だけ使える"]);
        return { scene: "服のタグに、この記号があった。", syms: [s], ask: "漂白剤は？", ...m, why: `${shape(s)}は「${m.ans}」。斜めの線がある三角は、塩素系が使えません。`, src: "P" }; } },
    { id: "iron", lv: 0, cat: "アイロン", name: "アイロンの点", look: "点が多いほど高い温度。2024年の改正で 210・160・120℃になりました。",
      note: "アイロンの点は底の温度の上限。点3つ＝210℃、2つ＝160℃、1つ＝120℃（2024年の改正。前は200・150・110℃）。",
      make(R) {
        const s = one(R, of("iron").filter((x) => !x.no)), a = `${IRON[s.d]}℃まで`;
        return { scene: "服のタグに、この記号があった。", syms: [s], ask: "アイロンの温度は？", ans: a, opts: opts(R, a, shuffle(R, [...[3, 2, 1].filter((d) => d !== s.d).map((d) => `${IRON[d]}℃まで`), "アイロンはかけられない"])),
          why: `アイロンの中の点は、底の温度の上限。点${s.d}つは${IRON[s.d]}℃まで（${["", "低", "中", "高"][s.d]}温）です。`, src: "R" };
      } },
    { id: "hand", lv: 0, cat: "洗う", name: "手洗いの記号", look: "おけの中に手があれば手洗い。数字と線は洗濯機の洗い方です。",
      note: "おけの中に手＝手洗い（40℃まで）。洗濯機の「手洗いコース」で洗えるという意味ではない。",
      make(R) {
        const s = one(R, [{ g: "wash", hand: true }, ...pickN(R, of("wash").filter((x) => x.t && x.t <= 40), 2), { g: "wash", no: true }]);
        const pool = [{ g: "wash", hand: true }, { g: "wash", no: true }, { g: "wash", t: 40, b: 1 }, { g: "wash", t: 30, b: 2 }, { g: "wash", t: 40, b: 0 }];
        const m = meanOpts(R, s, pool);
        return { scene: "服のタグに、この記号があった。", syms: [s], ask: "家ではどう洗う？", ...m,
          why: `${shape(s)}は「${m.ans}」。おけの中に手は手洗い、数字は洗濯機の洗い方、×は家で洗えない、です。`, src: "P" };
      } },

    // ===== ふつう =====
    { id: "bars", lv: 1, cat: "洗う", name: "おけの下の線", look: "線が無い＝ふつう、1本＝弱い、2本＝非常に弱い洗い方です。",
      note: "おけの下の線：無し＝ふつう、1本＝弱い、2本＝非常に弱い洗い方。数字はいつも温度の上限。",
      make(R) {
        const s = one(R, of("wash").filter((x) => x.t && x.t <= 60)), a = `洗濯機で${STR[s.b]}洗い方`;
        return { scene: `服のタグに、この記号があった。`, syms: [s], ask: "洗濯機の洗い方は？", ans: a,
          opts: opts(R, a, [...[0, 1, 2].filter((b) => b !== s.b).map((b) => `洗濯機で${STR[b]}洗い方`), "手洗いだけ"]),
          why: `おけの下の線は洗い方の強さ。${s.b ? `線${s.b}本は「${STR[s.b]}」` : "線が無いのは「ふつうの」"}洗い方で、温度は${s.t}℃までです。`, src: "P" };
      } },
    { id: "dry", lv: 1, cat: "乾かす", name: "干し方の線", look: "縦の線＝つり干し、横の線＝平干し、2本＝脱水しない、左上の斜線＝日陰です。",
      note: "四角の中の縦の線＝つり干し、横の線＝平干し。線2本＝脱水せずぬれたまま。左上の斜線＝日陰で干す。",
      make(R) {
        const s = one(R, of("dry")), near = of("dry").filter((x) => [x.dir !== s.dir, x.n !== s.n, x.shade !== s.shade].filter(Boolean).length === 1);
        const a = mean(s);
        return { scene: "服のタグに、この記号があった。", syms: [s], ask: "どう干す？", ans: a, opts: opts(R, a, shuffle(R, near).map(mean)),
          why: `${shape(s)}は「${a}」。縦はつり干し・横は平干し、2本は脱水しない、左上の斜線は日陰（屋根やひさしの形）です。`, src: "P" };
      } },
    { id: "tumble", lv: 1, cat: "乾かす", name: "乾燥機の記号", look: "四角の中の丸は乾燥機。点2つは高い温度、1つは低い温度です。",
      note: "四角の中に丸＝乾燥機（タンブル乾燥）。点2つ＝高い温度（排気80℃まで）、1つ＝低い温度（60℃まで）、×＝使えない。",
      make(R) { const s = one(R, of("tumble")), m = meanOpts(R, s, [...of("tumble"), { g: "dry", dir: "v", n: 1, shade: false }]);
        return { scene: "服のタグに、この記号があった。", syms: [s], ask: "どういう意味？", ...m, why: `${shape(s)}は「${m.ans}」。点の数が乾燥の温度を表します。`, src: "H" }; } },
    { id: "pro", lv: 1, cat: "クリーニング", name: "丸の中の文字", look: "P・F はドライクリーニングの溶剤、W はウエットクリーニング、下の線は弱い処理です。",
      note: "丸はクリーニング店の記号。P＝パークロロエチレンなど、F＝石油系の溶剤でドライクリーニング。W＝ウエットクリーニング。下の線は弱い処理。",
      make(R) {
        const s = one(R, [...of("pro"), ...of("wet")]), pool = [...of("pro"), ...of("wet")].filter((x) => x.g === s.g || (s.no && x.no));
        const m = meanOpts(R, s, pool);
        return { scene: "服のタグに、この記号があった。", syms: [s], ask: "クリーニング店では？", ...m,
          why: `${shape(s)}は「${m.ans}」。P・Fは使う溶剤の種類、Wは水を使うウエットクリーニング、下の線は弱い処理です。`, src: "P" };
      } },
    { id: "both", lv: 1, cat: "洗う", name: "温度と強さの両方", look: "数字は温度の上限、下の線は洗い方の強さ。両方を読みましょう。",
      note: "洗濯の記号は、数字（温度の上限）と下の線（強さ）を両方読む。例：40に線1本＝40℃まで・弱い洗い方。",
      make(R) {
        const s = one(R, of("wash").filter((x) => x.t && x.t <= 60)), a = `${s.t}℃まで・${STR[s.b]}洗い方`;
        const ws = []; for (const t of [60, 40, 30]) for (const b of [0, 1, 2]) if (t !== s.t || b !== s.b) ws.push(`${t}℃まで・${STR[b]}洗い方`);
        const near = ws.filter((w) => w.startsWith(`${s.t}℃`) || w.endsWith(`${STR[s.b]}洗い方`));
        return { scene: "服のタグに、この記号があった。", syms: [s], ask: "洗濯機で洗うなら？", ans: a, opts: opts(R, a, shuffle(R, near)),
          why: `数字の${s.t}は温度の上限、${s.b ? `下の線${s.b}本は「${STR[s.b]}」` : "下に線が無いのは「ふつうの」"}洗い方です。`, src: "P" };
      } },

    // ===== むずかしい =====
    { id: "tag_ok", lv: 2, cat: "タグ", name: "タグを読む：できること", look: "記号を1つずつ、×や線や点に気をつけて読みましょう。",
      note: "タグの記号は、洗濯→漂白→乾燥→アイロン→クリーニングの順に並ぶ。1つずつ読めば、できることが分かる。",
      make(R) {
        const tag = tagWhere(R, (t) => { const x = tagOkNg(t); return x.ok.filter((o) => !/干し/.test(o)).length >= 1 && x.ng.length >= 3; });
        const { ok, ng } = tagOkNg(tag), a = one(R, ok.filter((o) => !/干し/.test(o)));
        return { scene: "服のタグを見た。", syms: tag, tag: true, ask: "この服で、してよいことは？", ans: a, opts: opts(R, a, shuffle(R, ng)),
          why: `「${a}」だけが表示のとおりです。ほかは、タグのどれかの記号で「できない」とされています。`, src: "P" };
      } },
    { id: "tag_ng", lv: 2, cat: "タグ", name: "タグを読む：してはいけないこと", look: "×のついた記号と、温度の上限を見ましょう。",
      note: "してはいけないことは、×のついた記号と、数字・点の温度の上限から分かる。",
      make(R) {
        const tag = tagWhere(R, (t) => { const x = tagOkNg(t); return x.ng.length >= 1 && x.ok.length >= 3; });
        const { ok, ng } = tagOkNg(tag), a = one(R, ng);
        return { scene: "服のタグを見た。", syms: tag, tag: true, ask: "この服で、してはいけないことは？", ans: a, opts: opts(R, a, shuffle(R, ok)),
          why: `「${a}」は、タグの記号で「できない」とされています。ほかの3つは表示のとおりにできます。`, src: "P" };
      } },
    { id: "tag_dry", lv: 2, cat: "タグ", name: "タグを読む：乾かし方", look: "四角の中の丸（乾燥機）と、四角の中の線（干し方）を両方見ましょう。",
      note: "乾かし方は2つの記号で決まる：四角の中の丸（乾燥機を使えるか）と、四角の中の線（干し方）。",
      make(R) {
        const tu = one(R, of("tumble")), dr = one(R, of("dry"));
        const tw = (t) => (t.no ? "乾燥機は使わず" : t.d === 2 ? "乾燥機を使ってよい。干すなら" : "乾燥機は低い温度なら使える。干すなら");
        const say = (t, d) => `${tw(t)}、${mean(d)}`;
        const a = say(tu, dr), ws = [];
        for (const t of of("tumble")) if (t.no !== tu.no || t.d !== tu.d) ws.push(say(t, dr));
        for (const d of of("dry")) if ([d.dir !== dr.dir, d.n !== dr.n, d.shade !== dr.shade].filter(Boolean).length === 1) ws.push(say(tu, d));
        return { scene: "洗ったあと、タグの乾かし方の記号を見た。", syms: [tu, dr], tag: true, ask: "どう乾かす？", ans: a, opts: opts(R, a, shuffle(R, ws)),
          why: `${shape(tu)}は「${mean(tu)}」、${shape(dr)}は「${mean(dr)}」です。`, src: "P" };
      } },
    { id: "pair", lv: 2, cat: "洗う", name: "2枚をいっしょに洗う", look: "どちらの表示も守れるのは、低いほうの温度と、弱いほうの洗い方です。",
      note: "ちがう表示の服をいっしょに洗うなら、どちらも守れるように、低いほうの温度・弱いほうの洗い方にそろえる。",
      make(R) {
        const pool = of("wash").filter((x) => x.t && x.t <= 60);
        let a1, a2; for (let i = 0; i < 50; i++) { [a1, a2] = pickN(R, pool, 2); if (a1.t !== a2.t && a1.b !== a2.b) break; }
        const t = Math.min(a1.t, a2.t), b = Math.max(a1.b, a2.b), T = Math.max(a1.t, a2.t), B = Math.min(a1.b, a2.b);
        const say = (t, b) => `${t}℃まで・${STR[b]}洗い方`, a = say(t, b);
        return { scene: "シャツとセーターを、いっしょに洗濯機で洗いたい。", syms: [a1, a2], pair: ["シャツ", "セーター"], ask: "どう洗う？", ans: a,
          opts: opts(R, a, [say(T, B), say(T, b), say(t, B), say(30 === t ? 40 : 30, b)]),
          why: `シャツは${a1.t}℃まで・${STR[a1.b]}、セーターは${a2.t}℃まで・${STR[a2.b]}。どちらも守れるのは${a}です。`, src: "P" };
      } },
  ];

  const BY = Object.fromEntries(KINDS.map((k) => [k.id, k]));
  const kindsOf = (lv) => KINDS.filter((k) => k.lv === lv).map((k) => k.id);

  function seedOf(str) { let h = 2166136261; for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  // 1問を作る。tag は「種類|種」（例 "temp|2026-11-07:d0"）。同じ tag ならいつも同じ問題
  function make(tag) {
    const [kind] = String(tag).split("|"), k = Object.prototype.hasOwnProperty.call(BY, kind) ? BY[kind] : null;
    if (!k) return null;
    const p = k.make(rng(seedOf(tag)));
    return { tag, kind, lv: k.lv, cat: k.cat, name: k.name, look: k.look, note: k.note, ...p };
  }
  // 同じ問題かを見分ける印（記号・答えが同じなら、選び肢の並びがちがっても同じ問題）
  const keyOf = (P) => JSON.stringify([P.kind, P.scene, P.syms || null, P.ans]);

  // 今日の5問（やさしい2・ふつう2・むずかしい1）。種類は重ねない
  function dailyTags(date) {
    const R = rng(seedOf("day:" + date)), e = pickN(R, kindsOf(0), 2), n = pickN(R, kindsOf(1), 2), h = pickN(R, kindsOf(2), 1);
    return [...e, ...n, ...h].map((id, i) => `${id}|${date}:d${i}`);
  }
  // 上級の3問（むずかしいだけ・今日の5問のむずかしいとは別の種類）
  function hardTags(date) {
    const dh = dailyTags(date)[4].split("|")[0], R = rng(seedOf("hard:" + date)), h = pickN(R, kindsOf(2).filter((x) => x !== dh), 3);
    return h.map((id, i) => `${id}|${date}:h${i}`);
  }

  const SENTAKU = { KINDS, BY, LV, SRC, ALL, GROUPS, IRON, TUMBLE, STR, TEMPS, ORDER, mean, shape, okNg, tagOkNg, kindsOf, seedOf, rng, make, keyOf, dailyTags, hardTags, pickN };
  if (typeof module !== "undefined" && module.exports) module.exports = SENTAKU; else root.SENTAKU = SENTAKU;
})(typeof self !== "undefined" ? self : this);
