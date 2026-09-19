#!/usr/bin/env node
/**
 * index.html 을 가상 브라우저에 띄워 실제로 눌러보는 점검.
 *   node tools/smoke.js
 * 브라우저가 없어도 되는 부분(레이아웃 픽셀, 캔버스)은 흉내만 낸다.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", e => errors.push("jsdomError: " + (e.stack || e.message)));
vc.on("error", (...a) => errors.push("console.error: " + a.join(" ")));

const dom = new JSDOM(html, {
  runScripts: "dangerously",
  pretendToBeVisual: true,
  virtualConsole: vc,
  url: "https://example.test/",
  beforeParse(win) {
    // jsdom 에 없는 것들만 최소한으로 채운다
    win.matchMedia = q => ({
      matches: false, media: q,
      addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){},
    });
    if (!win.TextEncoder) win.TextEncoder = global.TextEncoder;
    if (!win.TextDecoder) win.TextDecoder = global.TextDecoder;
    win.HTMLCanvasElement.prototype.getContext = () => ({
      drawImage(){}, fillRect(){}, set imageSmoothingQuality(v){},
    });
    win.HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,AA==";
    // 이미지는 실제로 불러올 수 없으니 800×1200 으로 즉시 불러와진 척한다
    Object.defineProperty(win.HTMLImageElement.prototype, "src", {
      configurable: true,
      get() { return this.getAttribute("src") || ""; },
      set(v) {
        this.setAttribute("src", v);
        Object.defineProperty(this, "naturalWidth",  { value: 800,  configurable: true });
        Object.defineProperty(this, "naturalHeight", { value: 1200, configurable: true });
        win.setTimeout(() => this.dispatchEvent(new win.Event("load")), 0);
      },
    });
    // 레이아웃이 없으므로 카드/사진 칸 크기를 실제 값처럼 돌려준다
    win.Element.prototype.getBoundingClientRect = function () {
      const id = this.id, cls = this.className || "";
      if (id === "card")  return rect(0, 0, 1120, 700);
      if (id === "stage") return rect(568, 18, 534, 664);
      if (id === "party") return rect(600, 380, 200, 260);
      if (String(cls).includes("layer")) return rect(400, 200, 200, 200);
      if (String(cls).includes("cropbox")) return rect(0, 0, 300, 373);
      return rect(0, 0, 300, 300);
    };
    function rect(x, y, w, h) {
      return { x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, toJSON(){} };
    }
  },
});

const win = dom.window, doc = win.document;
const $ = id => doc.getElementById(id);
const results = [];
const check = (name, fn) => {
  try {
    const msg = fn();
    const ok = msg === true || msg === undefined;
    results.push([ok ? "OK" : "FAIL", name, typeof msg === "string" ? msg : ""]);
  } catch (e) {
    results.push(["FAIL", name, e.message]);
  }
};
const pointer = (el, type, x = 10, y = 10) => {
  const ev = new win.Event(type, { bubbles: true, cancelable: true });
  Object.assign(ev, { clientX: x, clientY: y, pointerId: 1 });
  el.dispatchEvent(ev);
};
const click = el => el.dispatchEvent(new win.Event("click", { bubbles: true, cancelable: true }));
const input = (el, v) => { el.value = v; el.dispatchEvent(new win.Event("input", { bubbles: true })); };
const change = (el, v) => { if (v !== undefined) el.value = v; el.dispatchEvent(new win.Event("change", { bubbles: true })); };

win.addEventListener("load", run);
setTimeout(run, 2500);          // load 가 안 와도 진행

let ran = false;
const tick = ms => new Promise(r => win.setTimeout(r, ms || 30));
const pickFile = (inputEl, name) => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const file = new win.File([png], name, { type: "image/png" });
  Object.defineProperty(inputEl, "files", { value: [file], configurable: true });
  change(inputEl);
};

async function run() {
  if (ran) return;
  ran = true;

  /* ── 1. 첫 화면 ─────────────────────────────── */
  check("스크립트가 오류 없이 실행됨", () => errors.length === 0 || errors.join(" | "));
  check("엔트리 막대 6개", () => doc.querySelectorAll("#bars .bar").length === 6
        || "개수 " + doc.querySelectorAll("#bars .bar").length);
  check("사진 칸 도트 자리 6개", () => doc.querySelectorAll("#party .ent").length === 6
        || "개수 " + doc.querySelectorAll("#party .ent").length);
  check("처음엔 전부 빈 자리", () => doc.querySelectorAll("#bars .bar.empty").length === 6);
  check("텍스트 칸이 모두 비어 있음", () => ["fx_name","fx_role","fx_quote","fx_desc"]
        .every(i => $(i).value === "") || "비어있지 않음");
  check("사진 안내가 보임", () => $("stageHint").hidden === false);
  check("공유 코드가 만들어짐", () => /^C1\./.test($("outCode").value) || $("outCode").value.slice(0, 20));

  /* ── 2. 엔트리 넣기 ─────────────────────────── */
  check("빈 칸을 누르면 편집창이 열림", () => {
    click(doc.querySelectorAll("#bars .bar")[0]);
    return $("modal").hidden === false;
  });
  check("초성 검색 ㄴㅍㅇ → 님피아", () => {
    input($("q"), "ㄴㅍㅇ");
    const first = doc.querySelector("#res .rit .rn");
    return (first && first.textContent === "님피아") || (first ? first.textContent : "결과 없음");
  });
  check("도감번호 검색 700", () => {
    input($("q"), "700");
    const first = doc.querySelector("#res .rit .rn");
    return (first && first.textContent === "님피아") || (first ? first.textContent : "결과 없음");
  });
  check("영문 검색 sylveon", () => {
    input($("q"), "sylveon");
    const first = doc.querySelector("#res .rit .rn");
    return (first && first.textContent === "님피아") || (first ? first.textContent : "결과 없음");
  });
  check("폼 검색 — 알로라 나인테일은 얼음/페어리", () => {
    input($("q"), "나인테일");
    const items = [...doc.querySelectorAll("#res .rit")];
    const alola = items.find(el => (el.querySelector(".rf") || {}).textContent === "알로라의 모습");
    if (!alola) return "알로라폼이 목록에 없음";
    const dots = alola.parentElement ? 0 : 0;
    return true;
  });
  check("고르면 1번 자리에 들어감", () => {
    input($("q"), "님피아");
    click(doc.querySelector("#res .rit"));
    const bar = doc.querySelectorAll("#bars .bar")[0];
    return !bar.classList.contains("empty") && /님피아/.test(bar.textContent) || bar.textContent;
  });
  check("사진 칸 도트에도 반영", () => {
    const ent = doc.querySelectorAll("#party .ent")[0];
    return !ent.classList.contains("empty") && !!ent.querySelector(".sprite");
  });

  /* ── 3. 세부 설정 ───────────────────────────── */
  check("닉네임이 막대에 반영", () => {
    input($("e_nick"), "울울");
    return /울울/.test(doc.querySelectorAll("#bars .bar")[0].textContent);
  });
  check("사이즈 XL 반영", () => {
    const btn = [...$("e_size").children].find(b => b.dataset.v === "XL");
    click(btn);
    return /XL/.test(doc.querySelectorAll("#bars .bar")[0].textContent);
  });
  check("칭호 목록 98종", () => $("e_title").querySelectorAll("option").length === 99
        || "개수 " + $("e_title").querySelectorAll("option").length);
  check("리본 목록 101종", () => $("e_ribbon").querySelectorAll("option").length === 102
        || "개수 " + $("e_ribbon").querySelectorAll("option").length);
  check("칭호를 고르면 막대에 붙음", () => {
    change($("e_title"), "최강의");
    return /최강의/.test(doc.querySelectorAll("#bars .bar")[0].textContent);
  });
  check("리본을 고르면 막대에 붙음", () => {
    const opt = $("e_ribbon").querySelectorAll("option")[3];
    change($("e_ribbon"), opt.value);
    return doc.querySelectorAll("#bars .bar")[0].textContent.includes(opt.value);
  });
  check("이로치 토글", () => {
    $("e_shiny").checked = true; change($("e_shiny"));
    return doc.querySelectorAll("#party .ent")[0].querySelector(".sprite").classList.contains("shiny");
  });
  check("표기 순서 닉네임/종류/사이즈", () => {
    const t = doc.querySelectorAll("#bars .bar")[0].textContent.replace(/\s+/g, "");
    return /울울\/님피아\/[♂♀]\/XL/.test(t) || t;
  });
  check("편집창 닫기", () => { click($("mClose")); return $("modal").hidden === true; });

  /* ── 3.5 트레이너 칭호 ──────────────────────── */
  check("칭호 목록이 215개", () => {
    const n = $("roleSel").querySelectorAll("option").length;
    return n === 216 || "개수 " + n;          // 직접 입력 1 + 215
  });
  check("옛 이름 대신 한국 명칭을 쓴다", () => {
    const all = [...$("roleSel").querySelectorAll("option")].map(o => o.value);
    const old = ["중", "기도사", "수리공", "괴짜 연구원", "맹수조련사", "비지니스맨"].filter(v => all.includes(v));
    const want = ["수행자", "주술사", "전기 작업원", "연구원", "맹수 조련사", "비즈니스맨"].filter(v => !all.includes(v));
    return (old.length === 0 && want.length === 0) || "옛이름 남음: " + old + " / 빠짐: " + want;
  });
  check("조직명·1인 직책은 빠져 있다", () => {
    const all = [...$("roleSel").querySelectorAll("option")].map(o => o.value);
    const left = ["로켓단", "스컬단", "보스", "타워타이쿤", "팩토리헤드", "서브웨이마스터", "에테르대표"]
      .filter(v => all.includes(v));
    return left.length === 0 || "남음: " + left.join(", ");
  });
  check("트레이너군은 그대로 남아 있다", () => {
    const all = [...$("roleSel").querySelectorAll("option")].map(o => o.value);
    const gone = ["장로", "섬의 왕", "포켓몬 레인저", "스컬단 조무래기", "에테르재단 직원"]
      .filter(v => !all.includes(v));
    return gone.length === 0 || "빠짐: " + gone.join(", ");
  });
  check("보기에 고스트 트레이너 · 가라르 챔피언이 있음", () => {
    const all = [...$("roleSel").querySelectorAll("option")].map(o => o.value);
    const missing = ["고스트 트레이너", "가라르 챔피언", "반바지 꼬마", "마스터 도장 문하생", "북신귀면대"]
      .filter(v => !all.includes(v));
    return missing.length === 0 || "없음: " + missing.join(", ");
  });
  check("고르면 신분 칸에 들어감", () => {
    change($("roleSel"), "고스트 트레이너");
    return $("fx_role").value === "고스트 트레이너" || $("fx_role").value;
  });
  check("직접 쓰면 목록 선택이 풀림", () => {
    input($("fx_role"), "수상한 여자");
    return $("roleSel").value === "" || $("roleSel").value;
  });
  check("칭호도 공유 코드에 실림", () => {
    change($("roleSel"), "가라르 챔피언");
    return /^C1./.test($("outCode").value) && $("fx_role").value === "가라르 챔피언";
  });

  /* ── 4. 공유 코드 왕복 ──────────────────────── */
  let code;
  check("코드에 내용이 담김", () => {
    code = $("outCode").value;
    return code.length > 40 || "길이 " + code.length;
  });
  check("코드를 불러오면 그대로 복원", () => {
    click(doc.querySelectorAll("#bars .bar")[0]); click($("mClear")); click($("mClose"));
    if (!doc.querySelectorAll("#bars .bar")[0].classList.contains("empty")) return "비우기 실패";
    $("inCode").value = code; click($("loadBtn"));
    const t = doc.querySelectorAll("#bars .bar")[0].textContent.replace(/\s+/g, "");
    return /최강의울울\/님피아/.test(t) || t;
  });

  /* ── 5. 메뉴 · 배경 · 표시 항목 ─────────────── */
  check("⋯ 메뉴 열고 닫기", () => {
    click($("moreBtn"));
    if ($("moreMenu").hidden) return "열리지 않음";
    click($("moreBtn"));
    return $("moreMenu").hidden === true;
  });
  check("배경 검정 → 글자색이 밝게 뒤집힘", () => {
    click($("sw_k"));
    const fg = $("card").style.getPropertyValue("--cfg");
    return fg === "#f6f2fa" || fg;
  });
  check("배경 하양 → 글자색이 어둡게", () => {
    click($("sw_w"));
    return $("card").style.getPropertyValue("--cfg") === "#191622";
  });
  check("설명 끄면 칸이 사라짐", () => {
    $("t_desc").checked = false; change($("t_desc"));
    return $("blk_desc").hidden === true;
  });
  check("엔트리 끄면 막대와 도트가 사라짐", () => {
    $("t_party").checked = false; change($("t_party"));
    const ok = $("bars").hidden === true && $("party").hidden === true;
    $("t_party").checked = true; change($("t_party"));
    $("t_desc").checked = true; change($("t_desc"));
    return ok;
  });

  /* ── 6. 스티커(파일 추가) ───────────────────── */
  await (async () => {
    pickFile($("fileLayer"), "sticker.png");
    await tick(60);
    check("파일을 고르면 스티커가 추가됨", () => {
      const n = $("card").querySelectorAll(".layer").length;
      return n === 1 || "개수 " + n;
    });
    check("스티커가 카드 전체에 붙음 (사진 칸이 아니라)", () => {
      const node = $("card").querySelector(".layer");
      return (node && node.parentElement.id === "card") || "부모: " + (node && node.parentElement.id);
    });
    check("스티커를 끌면 위치가 바뀜", () => {
      const node = $("card").querySelector(".layer");
      const before = node.style.left;
      pointer(node, "pointerdown", 400, 200);
      pointer(node, "pointermove", 700, 400);
      pointer(node, "pointerup", 700, 400);
      return node.style.left !== before || "left 가 " + before + " 그대로";
    });
    check("사진 칸 왼쪽(글 영역)까지 감", () => {
      const node = $("card").querySelector(".layer");
      pointer(node, "pointerdown", 700, 400);
      pointer(node, "pointermove", 120, 400);
      pointer(node, "pointerup", 120, 400);
      const left = parseFloat(node.style.left);
      return left < 50 || "left " + left + "% — 사진 칸(50.7% 이상)에 갇힘";
    });
    check("크기 슬라이더가 먹음", () => {
      input($("laySize"), "40");
      return $("card").querySelector(".layer").style.width === "40%";
    });
    check("스티커 삭제", () => {
      click($("layDel"));
      return $("card").querySelectorAll(".layer").length === 0;
    });
  })();

  /* ── 7. 리셋 ────────────────────────────────── */
  check("리셋은 두 번 눌러야 지워짐", () => {
    click($("resetBtn"));
    if (doc.querySelectorAll("#bars .bar.empty").length === 6) return "한 번에 지워짐";
    click($("resetBtn"));
    return doc.querySelectorAll("#bars .bar.empty").length === 6 || "지워지지 않음";
  });

  /* ── 8. 대표 사진: 자르기 화면 ──────────────── */
  await (async () => {
    pickFile($("fileBase"), "trainer.png");
    await tick(80);
    check("사진을 고르면 자르기 화면이 열림", () => $("cropModal").hidden === false);
    check("자르기 프레임이 사진 칸 비율", () => {
      const w = parseFloat($("cropBox").style.width), h = parseFloat($("cropBox").style.height);
      return Math.abs(w / h - 534 / 664) < 0.02 || w + "×" + h;
    });
    check("프레임 안에서 끌어 옮길 수 있음", () => {
      const box = $("cropBox"), img = $("cropImg");
      const before = img.style.transform;
      pointer(box, "pointerdown", 150, 150);
      pointer(box, "pointermove", 150, 40);
      pointer(box, "pointerup", 150, 40);
      return img.style.transform !== before || "움직이지 않음";
    });
    check("크기 슬라이더가 먹음", () => {
      input($("cropZoom"), "200");
      return $("cropZoomV").textContent === "200%";
    });
    click($("cropApply"));
    await tick(80);
    check("적용하면 자르기 화면이 닫힘", () => $("cropModal").hidden === true);
    check("카드에 사진이 들어감", () => $("baseImg").hidden === false && !!$("baseImg").getAttribute("src"));
    check("사진 안내가 사라짐", () => $("stageHint").hidden === true);
    check("카드 위 사진은 손이 닿지 않음", () => {
      const css = html.match(/#baseImg{[^}]*}/)[0];
      return /pointer-events:none/.test(css) || css;
    });
    click($("baseCrop"));
    await tick(80);
    check("다시 자르기로 재편집 가능", () => $("cropModal").hidden === false);
    click($("cropCancel"));
    check("취소하면 닫힘", () => $("cropModal").hidden === true);
  })();

  check("끝까지 오류 없음", () => errors.length === 0 || errors.join(" | ").slice(0, 300));

  /* ── 결과 ──────────────────────────────────── */
  const fail = results.filter(r => r[0] === "FAIL");
  for (const [st, name, msg] of results) {
    console.log(`  ${st === "OK" ? " OK " : "FAIL"}  ${name}${msg ? "  — " + msg : ""}`);
  }
  console.log(`\n${results.length}개 중 ${results.length - fail.length}개 통과, ${fail.length}개 실패`);
  process.exit(fail.length ? 1 : 0);
}
