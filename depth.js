// 深さの部品（depth.js）：1問の中に2つ目の判断を足す「自信をかける」と、まちがえた問題が間をあけて戻る「復習」。
// 深さの版: 6
// 正：satou-aaaaa/shared-workflows の template/depth.js（各ゲームはこれをそのまま写す。直すときはひな形を直して配り、版を上げる）
// 考え（routines/game-dev.md「1問を深くする」）:
//   - 自信をかける：答える前に「たしか」を押せる（押さなければ「たぶん」）。自分の見立てが当たったかが2つ目の勝負になる。
//     確信度採点（Gardner-Medwin, UCL）・自信のあるまちがいほど直すと残る（Butterfield & Metcalfe 2001）。
//     失うものは無い（★・遊べる量・記録は変えない）。当たり具合を知らせるだけ（game-dev.md 研究5・F1）。
//   - 復習：まちがえた・ヒントを2回使った問題を、1日後 → 3日後 → 7日後に出し直す。正解で次の間へ、まちがいで1日後に戻る。
//     3回続けて正解したら「覚えた」。種類はまぜて出す（Cepeda 2006・Rohrer & Taylor 2007・game-dev.md 研究18）。
// 使い方（index.html の <head> の中、ゲームの script より前に、defer を付けずに置く）:
//   <script src="depth.js" data-game="kokoku-minuki" data-key="kokoku-depth"></script>
//   - 記録は data-key のキー（ゲームの記録とは別）。引き継ぎ（transfer.js）の data-keys にもこのキーを足す。
//   - 問題の「鍵」は、その鍵だけで同じ問題を作り直せる文字（例 とことんの tag）。種類は鍵の | より前（DEPTH_CONFIG.kindOf で変えられる）。
//   自信： 問題の画面に Depth.sureHtml() を置き、描いたあとに Depth.bindSure(鍵, 回の印)。
//          回の印は、その回のその問題だけを指す文字（例 cur.id + "|" + cur.i）。別のタブ・開き直したあとで同じ問題に答えても、
//          judge は最初の1回だけ数え、2回目からは null（版5。shared-workflows #352：別のタブで先に答えると「自信あり」が2回数えられた）。
//          最初に答えたとき Depth.judge(正解か) → { sure, ok, text }（text を知らせに出す）。同じ問題で2回目からは null。
//          Depth.runStart() で1回分の数え直し、Depth.runStats() → { n, sure, sureOk }（結果の画面に「たしかの当たり sureOk/sure」）。
//          Depth.stats() → { sure, sureOk, learned }（実績に使う。learned は復習で覚えた数）。
//   復習： 問題が終わったら Depth.mark(鍵, まちがい＋ヒントの数, 名前) を呼ぶ（0なら、復習中の問題を次の間へ進める。1以上なら復習に入れる。
//          自信ありでまちがえた問題は、まちがいの数にかかわらず入る）。
//          Depth.due() → 今日出す鍵の並び（種類をまぜる・多くて10）。Depth.count() → 今日出す数（ホームのボタンに「復習 N問」）。
//          Depth.setValid(鍵 → 作り直せるか) を最初に1回呼ぶ（引き継ぎで入った・種類が消えた鍵を数えず、出さない）。
// 守ること: 外へ通信しない。保存に失敗したら開いているあいだだけ覚え、ゲームの saveWarn があれば帯を出す。
//          保存の前に読み直す（ほかのタブの分を消さない）。今日のお題・上級の並びには触らない（F7）。
(function () {
  "use strict";
  var me = document.currentScript;
  var cfg = window.DEPTH_CONFIG || {};
  var GAME = cfg.game || (me && me.dataset.game) || "";
  var KEY = cfg.key || (me && me.dataset.key) || GAME + "-depth";
  var GAPS = [1, 3, 7]; // 復習の間（日）
  var MAX = 300; // 復習に置いておく数の上限（古いものから捨てる）
  var GONE_DAYS = 400; // 「覚えた」で消した印を置いておく日数（保存に失敗したままの古い控えより長く）
  var DUE_MAX = 10; // 1日に出す復習の数
  var kindOf = typeof cfg.kindOf === "function" ? cfg.kindOf : function (k) { return String(k).split("|")[0]; };
  var valid = function () { return true; }; // 作り直せる鍵か（ゲームが setValid で渡す）
  var mem = null; // 保存できないあいだの控え
  // 保存できないあいだに足した数（自信あり・当たり・覚えた）。合わせるとき「保存済みの数＋足した分」にする
  // （多いほうを取ると、そのあいだにほかのタブが保存した分が消えていた。版6、recycle-mark #7 の CodeRabbit）
  var pend = { sure: 0, sureOk: 0, learned: 0 };
  // 復習の控えが残っているあいだは、ゲーム本体の保存がうまくいっても帯を消さない（2026-11-11 CodeRabbit、版3）
  var held = false;
  function hold() {
    if (held || typeof window.saveWarn !== "function") return;
    var orig = window.saveWarn; held = true;
    window.saveWarn = function (on) { return orig(on || mem !== null); };
  }
  var last = null; // いまの問題の { key, sure, ok }（自信ありでまちがえたら、mark で復習に入れる）
  var today = function () { return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); };
  var addDays = function (d, n) { return new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10); };
  // 文字・数でないもの（{ toString: null } など）は + で例外になるので先に外す（版6、kimari-sagashi #17 の CodeRabbit）
  var num = function (v) { if (typeof v !== "number" && typeof v !== "string") return 0; return Number.isFinite(+v) && +v >= 0 ? Math.floor(+v) : 0; };
  var okDate = function (v) { return typeof v === "string" && /^\d{4}-\d\d-\d\d$/.test(v) && Number.isFinite(Date.parse(v + "T00:00:00Z")); };
  // rv はプロトタイプの無い辞書にする（鍵が constructor・__proto__ などでも、もとからある値と混ざらない）
  // gone は「覚えた」で消した鍵と消した時刻（保存に失敗した控えと合わせるとき、保存済みの古い項目を戻さない。版4、hatsuden-kurabe #1 の CodeRabbit）
  // at は「自信を数えた回の印」と数えた時刻（別のタブ・開き直しで同じ問題を2回数えない。版5）
  var AT_MAX = 200; // 回の印を置いておく数（新しいものから）
  var fresh = function () { return { v: 1, rv: Object.create(null), gone: Object.create(null), at: Object.create(null), sure: 0, sureOk: 0, learned: 0 }; };

  // 形を直す（引き継ぎコードなどから入った値で画面を壊さない）
  function tidy(s) {
    var o = fresh();
    if (!s || typeof s !== "object" || Array.isArray(s)) return o;
    o.sure = num(s.sure); o.sureOk = Math.min(num(s.sureOk), o.sure); o.learned = num(s.learned);
    var rv = s.rv && typeof s.rv === "object" && !Array.isArray(s.rv) ? s.rv : {};
    var list = [];
    for (var k in rv) {
      var x = rv[k];
      if (!Object.prototype.hasOwnProperty.call(rv, k) || typeof k !== "string" || k === "__proto__" || k.length > 200 || !x || typeof x !== "object" || !okDate(x.due)) continue;
      list.push([k, { s: Math.min(num(x.s), GAPS.length - 1), due: x.due, t: num(x.t), lab: typeof x.lab === "string" ? x.lab.slice(0, 60) : "" }]);
    }
    list.sort(function (a, b) { return b[1].t - a[1].t; });
    var gone = s.gone && typeof s.gone === "object" && !Array.isArray(s.gone) ? s.gone : {};
    var gl = [];
    for (var g in gone) {
      if (!Object.prototype.hasOwnProperty.call(gone, g) || g === "__proto__" || g.length > 200 || !(num(gone[g]) > 0)) continue;
      gl.push([g, num(gone[g])]);
    }
    // 消した印は数で切らない（切ると、保存されている古い分から消した項目が戻る）。GONE_DAYS より古い印だけ捨てる
    var keepFrom = Date.now() - GONE_DAYS * 864e5;
    gl.forEach(function (e) { if (e[1] >= keepFrom) o.gone[e[0]] = e[1]; });
    // 消したあとに書かれていない項目は戻さない（消した時刻より新しく入れ直したものだけ残す）
    list = list.filter(function (e) { return !(e[0] in o.gone) || e[1].t > o.gone[e[0]]; });
    list.slice(0, MAX).forEach(function (e) { o.rv[e[0]] = e[1]; });
    var at = s.at && typeof s.at === "object" && !Array.isArray(s.at) ? s.at : {};
    var al = [];
    for (var a in at) if (Object.prototype.hasOwnProperty.call(at, a) && a !== "__proto__" && a.length <= 200 && num(at[a]) > 0) al.push([a, num(at[a])]);
    al.sort(function (x, y) { return y[1] - x[1]; });
    al.slice(0, AT_MAX).forEach(function (e) { o.at[e[0]] = e[1]; });
    return o;
  }
  function read() {
    var a = null, b = null;
    try { b = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
    try { a = mem !== null ? JSON.parse(mem) : null; } catch (e) {}
    if (!a) return tidy(b);
    if (!b) return tidy(a);
    // 保存に失敗していたあいだの控えと、保存されている分を合わせる（数は保存済み＋控えで足した分、復習は新しく書いたほう）
    a = tidy(a); b = tidy(b);
    var s = fresh();
    ["sure", "sureOk", "learned"].forEach(function (n) { s[n] = Math.max(a[n], b[n] + pend[n]); });
    [b.rv, a.rv].forEach(function (rv) { for (var k in rv) if (!s.rv[k] || rv[k].t >= s.rv[k].t) s.rv[k] = rv[k]; });
    // 消した印も合わせる（控えで消した項目を、保存されている分から戻さない。版4）
    [b.gone, a.gone].forEach(function (gone) { for (var k in gone) if (!(k in s.gone) || gone[k] > s.gone[k]) s.gone[k] = gone[k]; });
    [b.at, a.at].forEach(function (at) { for (var k in at) if (!(k in s.at) || at[k] > s.at[k]) s.at[k] = at[k]; });
    return tidy(s);
  }
  function write(fn) {
    var s = read(), was = { sure: s.sure, sureOk: s.sureOk, learned: s.learned };
    fn(s);
    var j = JSON.stringify(s);
    try { localStorage.setItem(KEY, j); mem = null; pend = { sure: 0, sureOk: 0, learned: 0 }; } catch (e) {
      for (var n in pend) pend[n] += Math.max(0, num(s[n]) - was[n]);
      mem = j; hold(); if (typeof window.saveWarn === "function") { try { window.saveWarn(true); } catch (e2) {} } }
    return s;
  }

  // ---- 復習 ----
  function mark(key, miss, label) {
    key = String(key);
    if (key === "__proto__") return;
    var bad = num(miss) > 0 || (last && last.key === key && last.sure && !last.ok);
    var now = Date.now(), d = today();
    write(function (s) {
      var x = s.rv[key];
      // 書いた時刻は、前の項目・消した印より必ず新しくする（端末の時計が戻っても、消した印に負けない）
      var t = Math.max(now, x ? x.t + 1 : 0, key in s.gone ? s.gone[key] + 1 : 0);
      if (bad) { delete s.gone[key]; s.rv[key] = { s: 0, due: addDays(d, GAPS[0]), t: t, lab: String(label || (x && x.lab) || "").slice(0, 60) }; return; }
      if (!x || x.due > d) return; // 復習に入っていない・まだ日が来ていない問題は動かさない
      if (x.s + 1 >= GAPS.length) { delete s.rv[key]; s.gone[key] = t; s.learned++; return; }
      s.rv[key] = { s: x.s + 1, due: addDays(d, GAPS[x.s + 1]), t: t, lab: x.lab };
    });
  }
  // 今日出す鍵：日の来たものを古い順に取り、種類が続かないように並べる
  function due() {
    var s = read(), d = today(), list = [];
    for (var k in s.rv) if (s.rv[k].due <= d && okKey(k)) list.push([k, s.rv[k]]);
    list.sort(function (a, b) { return a[1].due < b[1].due ? -1 : a[1].due > b[1].due ? 1 : a[1].t - b[1].t; });
    var groups = Object.create(null), order = [];
    list.forEach(function (e) { var g = kindOf(e[0]); if (!groups[g]) { groups[g] = []; order.push(g); } groups[g].push(e[0]); });
    // 毎回、直前と別の種類のうち残りが多いものから出す（同じなら古いほう）。数がかたよっていても、続けずに並べられるなら続けない
    // （順に1つずつ取ると a2・b3・c5 で c が4つ続いていた。版6、teate-junban #9 の CodeRabbit）
    var out = [], prev = null, n = Math.min(DUE_MAX, list.length);
    while (out.length < n) {
      var pick = null;
      order.forEach(function (g) { if (groups[g].length && g !== prev && (pick === null || groups[g].length > groups[pick].length)) pick = g; });
      if (pick === null) pick = prev;
      out.push(groups[pick].shift()); prev = pick;
    }
    return out;
  }
  function okKey(k) { try { return !!valid(k); } catch (e) { return false; } }
  function setValid(fn) { valid = typeof fn === "function" ? fn : function () { return true; }; }
  function count() { return due().length; }
  function waiting() { var s = read(); return Object.keys(s.rv).length; }

  // ---- 自信をかける ----
  var sureNow = false, judged = false, curAt = null, run = { n: 0, sure: 0, sureOk: 0 };
  function sureHtml() {
    return '<button type="button" class="dp-sure" id="dp-sure" aria-pressed="false">' + label(false) + "</button>";
  }
  function label(on) { return on ? "🎯 たしか ✓" : "🎯 自信あり？"; }
  function paintSure() {
    var b = document.getElementById("dp-sure");
    if (!b) return;
    b.setAttribute("aria-pressed", sureNow ? "true" : "false");
    b.textContent = label(sureNow);
    b.disabled = judged;
  }
  function bindSure(key, at) {
    sureNow = false; judged = false; last = { key: key == null ? null : String(key), sure: false, ok: true };
    curAt = at == null || at === "" ? null : String(at).slice(0, 200);
    // 別のタブ・開き直す前に、この回のこの問題をもう数えていたら、ボタンは押せないまま
    if (curAt !== null && curAt !== "__proto__" && curAt in read().at) judged = true;
    var b = document.getElementById("dp-sure");
    if (b) b.onclick = function () { if (judged) return; sureNow = !sureNow; paintSure(); };
    paintSure();
  }
  // 最初に答えたときだけ呼ばれる想定。2回目からは null
  function judge(ok) {
    if (judged) return null;
    judged = true; ok = !!ok;
    // 回の印があれば、書く直前に読み直して、ほかのタブが先に数えていないか見る（数えていたら数えない）
    if (curAt !== null && curAt !== "__proto__") {
      var dup = false;
      write(function (s) { if (curAt in s.at) dup = true; else s.at[curAt] = Date.now(); });
      if (dup) { paintSure(); return null; }
    }
    var sure = sureNow;
    if (last) { last.sure = sure; last.ok = ok; }
    run.n++;
    if (sure) {
      run.sure++; if (ok) run.sureOk++;
      write(function (s) { s.sure++; if (ok) s.sureOk++; });
    }
    paintSure();
    var text = !sure ? "" : ok ? "🎯 見立てどおり！" : "🎯 思いこみに気づけた。復習に入れます";
    return { sure: sure, ok: ok, text: text };
  }
  function runStart() { run = { n: 0, sure: 0, sureOk: 0 }; }
  function runStats() { return { n: run.n, sure: run.sure, sureOk: run.sureOk }; }
  function stats() { var s = read(); return { sure: s.sure, sureOk: s.sureOk, learned: s.learned }; }

  // 見た目（ゲームの色の変数があれば使う）。押した・押していないは ✓ と枠の形でも分かる（色だけで分けない）
  function style() {
    if (document.getElementById("dp-style")) return;
    var st = document.createElement("style");
    st.id = "dp-style";
    st.textContent = ".dp-sure{min-height:44px;min-width:44px;padding:6px 14px;border-radius:999px;border:2px dashed var(--ink2,#555);background:transparent;color:var(--ink,#222);font:inherit;font-size:.9rem;cursor:pointer}" +
      ".dp-sure[aria-pressed=true]{border-style:solid;border-width:3px;font-weight:700}.dp-sure:disabled{cursor:default;opacity:.85}";
    (document.head || document.documentElement).appendChild(st);
  }
  if (document.head) style(); else document.addEventListener("DOMContentLoaded", style);

  window.Depth = { VERSION: 6, KEY: KEY, GAPS: GAPS, mark: mark, due: due, count: count, waiting: waiting, setValid: setValid, sureHtml: sureHtml, bindSure: bindSure, judge: judge, runStart: runStart, runStats: runStats, stats: stats, _tidy: tidy };
})();
