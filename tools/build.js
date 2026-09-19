#!/usr/bin/env node
/**
 * 포켓몬 트레이너 카드 — 빌드 스크립트
 *
 *   node tools/build.js            전체 빌드 (데이터 → 스프라이트 → 시트 → HTML)
 *   node tools/build.js data       데이터만 (data/payload.json)
 *   node tools/build.js sheets     스프라이트 내려받아 시트만
 *   node tools/build.js html       template.html + payload.json → index.html
 *
 * 내려받은 원본은 .cache/ 에 쌓이며 재실행 시 재사용한다.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT  = path.resolve(__dirname, "..");
const CACHE = path.join(ROOT, ".cache");
const CSV   = path.join(CACHE, "csv");
const WIKI  = path.join(CACHE, "wiki");
const SPR   = path.join(CACHE, "sprites");
const MISSING_FILE = path.join(CACHE, "missing-sprites.json");

const CSV_BASE    = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv";
const SPRITE_BASE = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon";
const WIKI_API    = "https://pokemon.fandom.com/ko/api.php";

const KO = 3, EN = 9;          // PokeAPI local_language_id
const CELL = 96, COLS = 32;    // 스프라이트시트 한 칸 크기 / 열 수
const MAX_SPECIES = 1025;

const mkdir = d => fs.mkdirSync(d, { recursive: true });
const log = (...a) => console.log(...a);

/* ─────────────────────────────────────────────── 다운로드 */

async function download(url, dest, { retries = 3, allow404 = false } = {}) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return true;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url);
      if (res.status === 404 && allow404) return false;
      if (!res.ok) throw new Error("HTTP " + res.status);
      mkdir(path.dirname(dest));
      fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
      return true;
    } catch (err) {
      if (i === retries - 1) throw new Error(`${url} — ${err.message}`);
      await new Promise(r => setTimeout(r, 400 * (i + 1)));
    }
  }
}

/** 동시 실행 수를 제한해 job 목록을 처리한다. */
async function pool(jobs, concurrency, worker) {
  let index = 0;
  const run = async () => { while (index < jobs.length) await worker(jobs[index++]); };
  await Promise.all(Array.from({ length: concurrency }, run));
}

/* ─────────────────────────────────────────────── CSV 파싱 */

function parseCSV(file) {
  const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift();
  return rows
    .filter(r => r.length === head.length)
    .map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const CSV_FILES = [
  "pokemon.csv", "pokemon_species.csv", "pokemon_species_names.csv",
  "pokemon_types.csv", "type_names.csv",
  "pokemon_forms.csv", "pokemon_form_names.csv",
];

async function fetchCsv() {
  mkdir(CSV);
  for (const f of CSV_FILES) await download(`${CSV_BASE}/${f}`, path.join(CSV, f));
  log(`CSV ${CSV_FILES.length}개 준비됨`);
}

/* ─────────────────────────────────── 폼 한글 이름 보정표
   PokeAPI CSV에 한글 폼 이름이 없는 경우(히스이·팔데아·거다이맥스 등)를 메운다. */
const FORM_KO = {
  alola: "알로라의 모습", galar: "가라르의 모습", hisui: "히스이의 모습", paldea: "팔데아의 모습",
  "paldea-combat": "팔데아 컴뱃", "paldea-blaze": "팔데아 블레이즈", "paldea-aqua": "팔데아 아쿠아",
  mega: "메가", "mega-x": "메가 X", "mega-y": "메가 Y", primal: "원시",
  gmax: "거다이맥스", eternamax: "무한다이맥스",
  totem: "대장", "totem-alola": "대장(알로라)", "totem-busted": "대장(탄로난 모습)", "totem-disguised": "대장(둔갑한 모습)",
  origin: "오리진폼", therian: "영물폼", incarnate: "화신폼", sky: "스카이폼", land: "랜드폼",
  attack: "어택폼", defense: "디펜스폼", speed: "스피드폼", normal: "노말폼",
  blade: "블레이드폼", shield: "실드폼", zen: "달마모드",
  "galar-zen": "가라르 달마모드", "galar-standard": "가라르의 모습",
  school: "군집의 모습", solo: "단독의 모습",
  "dusk-mane": "황혼의 갈기", "dawn-wings": "새벽의 날개", ultra: "울트라",
  "crowned-sword": "검왕", "crowned-shield": "방패왕",
  "ice-rider": "백마를 탄 모습", "shadow-rider": "흑마를 탄 모습",
  hero: "마이티폼", resolute: "각성폼", ordinary: "평상시 모습",
  unbound: "해방폼", confined: "굴레의 모습",
  complete: "퍼펙트폼", "10": "10%폼", "10-power-construct": "10%폼", "50-power-construct": "50%폼",
  heat: "히트로토무", wash: "워시로토무", frost: "프로스트로토무", fan: "팬로토무", mow: "커트로토무",
  midnight: "한밤중의 모습", dusk: "황혼의 모습", "battle-bond": "유대변화", ash: "지우게닌가",
  eternal: "영원의 꽃", busted: "탄로난 모습", disguised: "둔갑한 모습",
  noice: "나이스페이스", ice: "아이스페이스", antique: "진품", phony: "모조품",
  "original-cap": "첫 여행의 모자", "hoenn-cap": "호연의 모자", "sinnoh-cap": "신오의 모자",
  "unova-cap": "하나의 모자", "kalos-cap": "칼로스의 모자", "alola-cap": "알로라의 모습",
  "partner-cap": "파트너 캡", "world-cap": "월드 캡",
  "rock-star": "록스타", belle: "마담", "pop-star": "아이돌", phd: "박사", libre: "마스크드",
  "low-key": "로우톤", amped: "하이톤",
  "rapid-strike": "연격의 태세", "single-strike": "일격의 태세",
  "three-segment": "세 토막", "family-of-three": "세 마리 가족", "family-of-four": "네 마리 가족",
  roaming: "질주하는 모습", terastal: "테라스탈폼", stellar: "스텔라폼",
  "blue-plumage": "파랑 깃털", "yellow-plumage": "노랑 깃털",
  "white-plumage": "하양 깃털", "green-plumage": "초록 깃털",
  droopy: "늘어진 모습", stretchy: "쭉 뻗은 모습", curly: "말린 모습",
  artisan: "장인의 모습", masterpiece: "명작의 모습", counterfeit: "모조품",
  bloodmoon: "블러드문", "wellspring-mask": "우물의 가면", "hearthflame-mask": "화덕의 가면",
  "cornerstone-mask": "주춧돌의 가면", "teal-mask": "박사의 가면", unremarkable: "평범한 모습",
};

/* ─────────────────────────────────────────────── 포켓몬 데이터 */

function buildPokemon(missingSprites = new Set()) {
  const C = f => parseCSV(path.join(CSV, f));
  const pokemon  = C("pokemon.csv");
  const species  = C("pokemon_species.csv");
  const spNames  = C("pokemon_species_names.csv");
  const pokTypes = C("pokemon_types.csv");
  const typeNames = C("type_names.csv");
  const forms     = C("pokemon_forms.csv");
  const formNames = C("pokemon_form_names.csv");

  const typeKo = {}, typeEn = {};
  for (const t of typeNames) {
    if (+t.local_language_id === KO) typeKo[t.type_id] = t.name;
    if (+t.local_language_id === EN) typeEn[t.type_id] = t.name;
  }
  const nameKo = {}, nameEn = {};
  for (const n of spNames) {
    if (+n.local_language_id === KO) nameKo[n.pokemon_species_id] = n.name;
    if (+n.local_language_id === EN) nameEn[n.pokemon_species_id] = n.name;
  }
  const types = {};
  for (const t of pokTypes) (types[t.pokemon_id] ||= [])[+t.slot - 1] = +t.type_id;

  const speciesById = Object.fromEntries(species.map(s => [s.id, s]));
  const formsByPokemon = {};
  for (const f of forms) (formsByPokemon[f.pokemon_id] ||= []).push(f);
  const formKo = {};
  for (const n of formNames) if (+n.local_language_id === KO) formKo[n.pokemon_form_id] = n;

  const titleCase = s => s.split("-").map(w => w[0].toUpperCase() + w.slice(1)).join(" ");

  const entries = [];
  const englishFallback = [];
  for (const p of pokemon) {
    const id = +p.id, speciesId = +p.species_id;
    const sp = speciesById[p.species_id];
    if (!sp || speciesId > MAX_SPECIES) continue;
    if (missingSprites.has(p.id)) continue;
    const ts = (types[p.id] || []).filter(Boolean);
    if (!ts.length) continue;

    let formLabel = "";
    if (+p.is_default === 0) {
      const form = (formsByPokemon[p.id] || [])[0];
      const ident = form && form.form_identifier;
      const koRow = form && formKo[form.id];
      if (ident && FORM_KO[ident]) formLabel = FORM_KO[ident];
      else if (koRow && koRow.form_name) formLabel = koRow.form_name;
      else if (ident) { formLabel = titleCase(ident); englishFallback.push(p.identifier); }
      else continue;
    }

    entries.push({
      x: 0,                                   // 시트 칸 번호 (아래에서 채움)
      i: id,                                  // pokemon id
      d: speciesId,                           // 도감 번호
      k: nameKo[speciesId] || sp.identifier,  // 한글 이름
      f: formLabel,                           // 폼 이름
      e: nameEn[speciesId] || sp.identifier,  // 영문 이름 (검색용)
      g: +sp.gender_rate,                     // -1 무성 / 0 수컷만 / 8 암컷만
      n: +sp.generation_id,
      t: ts,
    });
  }
  entries.sort((a, b) => a.d - b.d || a.i - b.i);
  entries.forEach((e, n) => (e.x = n));

  const typeList = {};
  for (const id of Object.keys(typeKo)) if (+id <= 18) typeList[id] = { ko: typeKo[id], en: typeEn[id] };

  return { entries, typeList, englishFallback };
}

/* ─────────────────────────────── 증표(칭호) · 리본 — 포켓몬 위키 */

async function fetchWiki(pageTitle, file) {
  mkdir(WIKI);
  const dest = path.join(WIKI, file);
  if (!fs.existsSync(dest)) {
    const url = `${WIKI_API}?action=parse&page=${encodeURIComponent(pageTitle)}` +
                `&prop=wikitext&format=json&formatversion=2`;
    const res = await fetch(url, { headers: { "User-Agent": "trainer-card-build/1.0" } });
    const json = await res.json();
    if (json.error) throw new Error(`위키 '${pageTitle}': ${json.error.info}`);
    fs.writeFileSync(dest, json.parse.wikitext, "utf8");
  }
  return fs.readFileSync(dest, "utf8");
}

function cleanWiki(s) {
  return String(s)
    .replace(/\[\[파일:[^\]]*\]\]/g, "")
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
    .replace(/\[\[([^\]]*)\]\]/g, "$1")
    .replace(/\{\{[^}]*\}\}/g, "")
    .replace(/'''/g, "").replace(/''/g, "")
    .replace(/<br\s*\/?>/gi, " / ")
    .replace(/<[^>]+>/g, "")
    .replace(/^\s*(align|colspan)="[^"]*"\s*\|\s*/i, "")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wikiTableRows(table) {
  const rows = [];
  let cur = null;
  for (const raw of table.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("{|") || line.startsWith("|}")) continue;
    if (line.startsWith("|-")) { if (cur && cur.length) rows.push(cur); cur = []; continue; }
    if (line.startsWith("!")) continue;
    if (!line.startsWith("|")) { if (cur && cur.length) cur[cur.length - 1] += " " + line; continue; }
    if (cur === null) cur = [];
    for (const piece of line.slice(1).split("||")) cur.push(cleanWiki(piece));
  }
  if (cur && cur.length) rows.push(cur);
  return rows;
}

function wikiSections(text) {
  const out = [];
  let title = "", buf = [];
  for (const line of text.split("\n")) {
    const h = line.match(/^={2,4}\s*(.+?)\s*={2,4}\s*$/);
    if (h) { out.push({ title, text: buf.join("\n") }); title = h[1]; buf = []; }
    else buf.push(line);
  }
  out.push({ title, text: buf.join("\n") });
  return out;
}

const tablesIn = text => text.match(/\{\|[\s\S]*?\n\|\}/g) || [];

async function buildMarksAndRibbons() {
  const markWiki = await fetchWiki("증표", "marks.wiki");
  const ribWiki  = await fetchWiki("리본", "ribbons.wiki");

  const marks = [];
  for (const sec of wikiSections(markWiki)) {
    for (const table of tablesIn(sec.text)) {
      for (const row of wikiTableRows(table)) {
        const cells = row.filter(Boolean);
        if (cells.length < 6) continue;
        const [ko, , , title] = cells;
        if (!ko || !/증표$/.test(ko)) continue;
        marks.push({ k: ko, t: title || "", g: sec.title });
      }
    }
  }

  const ribbons = [], seen = new Set();
  for (const sec of wikiSections(ribWiki)) {
    if (/불가사의 던전|애니메이션|갤러리|이야깃거리/.test(sec.title)) continue;
    for (const table of tablesIn(sec.text)) {
      for (const row of wikiTableRows(table)) {
        const cells = row.filter(Boolean);
        if (cells.length < 2) continue;
        const ko = cells[0];
        if (!ko || !/리본/.test(ko) || ko.length > 20) continue;
        if (seen.has(ko)) continue;
        seen.add(ko);
        ribbons.push({ k: ko, g: sec.title || "기타", d: (cells[1] || "").slice(0, 60) });
      }
    }
  }
  return { marks, ribbons };
}

/* ────────────────────────── 트레이너 칭호(트레이너군)

   위키의 '포켓몬 트레이너/종류' 문서는 7세대까지만 싣고 있어
   8·9세대는 여기에 적어 둔다. */
const TRAINER_GEN8 = ["마스터","모델","택시 드라이버","포스트맨","담력시험커플","댄서블 유닛",
  "마스터 도장 문하생","비즈니스 파트너","의료팀","체육관 트레이너"];
const TRAINER_GEN9 = ["등산걸","배달원","학생","축제소년","축제소녀","북신귀면대"];
const REGIONS = ["관동","성도","호연","신오","하나","칼로스","알로라","가라르","팔데아"];

async function buildTrainerRoles(typeList) {
  const wiki = await fetchWiki("포켓몬 트레이너/종류", "trainer-classes.wiki");
  const groups = [];
  let cur = null;
  for (const line of wiki.split("\n")) {
    const h = line.match(/^==\s*(.+?)\s*==\s*$/);
    if (h) { cur = { g: h[1], items: [] }; groups.push(cur); continue; }
    const m = line.match(/^\*\s*\[\[([^\]]+)\]\]/);
    if (m && cur) {
      const t = m[1];
      cur.items.push(t.includes("|") ? t.split("|")[1].trim() : t.trim());
    }
  }
  groups.push({ g: "8세대", items: TRAINER_GEN8 });
  groups.push({ g: "9세대", items: TRAINER_GEN9 });

  // 타입 전문가 — 18타입에서 만들어 낸다
  const types = Object.keys(typeList).sort((a, b) => a - b).map(id => typeList[id].ko);
  groups.push({ g: "타입 전문가", items: types.map(t => t + " 트레이너") });
  // 지방 챔피언 · 직책
  groups.push({ g: "지방 · 직책", items: REGIONS.map(r => r + " 챔피언")
    .concat(["포켓몬 마스터", "체육관 관장", "사천왕", "챔피언", "라이벌", "트레이너"]) });

  // 중복 정리 — 먼저 나온 그룹이 이긴다
  const seen = new Set();
  const roles = [];
  for (const grp of groups) {
    const items = grp.items.filter(it => it && !seen.has(it) && (seen.add(it), true));
    if (items.length) roles.push({ g: grp.g, items: items });
  }
  return roles;
}

/* ─────────────────────────────────────────────── 스프라이트 */

async function fetchSprites(ids) {
  for (const kind of ["normal", "shiny"]) mkdir(path.join(SPR, kind));
  const jobs = [];
  for (const id of ids) {
    jobs.push({ id, kind: "normal", url: `${SPRITE_BASE}/${id}.png` });
    jobs.push({ id, kind: "shiny",  url: `${SPRITE_BASE}/shiny/${id}.png` });
  }
  const missing = new Set();
  let done = 0;
  await pool(jobs, 32, async job => {
    const dest = path.join(SPR, job.kind, `${job.id}.png`);
    const ok = await download(job.url, dest, { allow404: true });
    if (!ok) missing.add(String(job.id));
    if (++done % 500 === 0) log(`  스프라이트 ${done}/${jobs.length}`);
  });
  // 어떤 종에 스프라이트가 없었는지 남겨둔다 — data 단계만 따로 돌려도
  // 시트에 없는 종이 payload 에 끼어들지 않도록.
  fs.writeFileSync(MISSING_FILE, JSON.stringify([...missing]));
  log(`스프라이트 ${jobs.length - missing.size * 2}장 준비됨 (없는 것 ${missing.size}종)`);
  return missing;
}

/** 이전 실행이 남긴 '스프라이트 없는 종' 목록. 없으면 null. */
function loadMissing() {
  if (!fs.existsSync(MISSING_FILE)) return null;
  try { return new Set(JSON.parse(fs.readFileSync(MISSING_FILE, "utf8"))); }
  catch { return null; }
}

/** 원본 PNG 중 pngjs가 못 읽는 파일을 sharp로 다시 인코딩한다. */
function repairSprites() {
  const { PNG } = require("pngjs");
  const sharp = require("sharp");
  const broken = [];
  for (const kind of ["normal", "shiny"]) {
    const dir = path.join(SPR, kind);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      try { PNG.sync.read(fs.readFileSync(p)); }
      catch { broken.push(p); }
    }
  }
  if (!broken.length) return Promise.resolve(0);
  return Promise.all(broken.map(p =>
    sharp(p)
      .resize(CELL, CELL, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png().toBuffer().then(buf => fs.writeFileSync(p, buf))
  )).then(() => { log(`깨진 스프라이트 ${broken.length}개 복구`); return broken.length; });
}

async function buildSheets(entries) {
  const { PNG } = require("pngjs");
  const sharp = require("sharp");
  const rows = Math.ceil(entries.length / COLS);
  const W = COLS * CELL, H = rows * CELL;

  for (const kind of ["normal", "shiny"]) {
    const sheet = new PNG({ width: W, height: H, colorType: 6 });
    sheet.data.fill(0);
    let placed = 0;
    for (const m of entries) {
      const src = path.join(SPR, kind, `${m.i}.png`);
      if (!fs.existsSync(src)) continue;
      PNG.bitblt(PNG.sync.read(fs.readFileSync(src)), sheet, 0, 0, CELL, CELL,
                 (m.x % COLS) * CELL, Math.floor(m.x / COLS) * CELL);
      placed++;
    }
    const raw = PNG.sync.write(sheet, { deflateLevel: 6 });
    const out = path.join(ROOT, `sheet-${kind}.webp`);
    await sharp(raw).webp({ lossless: true, effort: 6 }).toFile(out);
    log(`sheet-${kind}.webp  ${W}×${H}  ${(fs.statSync(out).size / 1048576).toFixed(2)}MB  (${placed}칸)`);
  }
}

/* ─────────────────────────────────────────────── HTML 조립 */

function buildHtml() {
  const tplPath = path.join(ROOT, "src", "template.html");
  const payPath = path.join(ROOT, "data", "payload.json");
  const tpl = fs.readFileSync(tplPath, "utf8");
  const payload = fs.readFileSync(payPath, "utf8");
  if (!tpl.includes("/*__DATA__*/")) throw new Error("template.html 에 /*__DATA__*/ 자리가 없습니다");
  if (payload.includes("</script")) throw new Error("payload 안에 </script 가 있어 인라인할 수 없습니다");
  const out = path.join(ROOT, "index.html");
  fs.writeFileSync(out, tpl.replace("/*__DATA__*/", payload));
  log(`index.html  ${(fs.statSync(out).size / 1024).toFixed(0)}KB`);
}

/* ─────────────────────────────────────────────── 실행 */

async function buildData({ withSprites }) {
  await fetchCsv();

  // 1차: 어떤 pokemon id가 있는지 알아내기 위해 스프라이트 없이 한 번 만든다.
  let { entries } = buildPokemon();
  let missing;
  if (withSprites) {
    missing = await fetchSprites(entries.map(e => e.i));
    await repairSprites();
  } else {
    missing = loadMissing();
    if (!missing) {
      missing = new Set();
      log("주의: 스프라이트를 아직 받은 적이 없어 도트가 없는 종도 데이터에 들어갑니다.\n" +
          "      `npm run build` 로 전체 빌드를 한 번 돌리세요.");
    }
  }

  // 2차: 스프라이트가 없는 종은 빼고 다시 번호를 매긴다.
  const built = buildPokemon(missing);
  entries = built.entries;

  const { marks, ribbons } = await buildMarksAndRibbons();
  const roles = await buildTrainerRoles(built.typeList);
  const payload = { cols: COLS, types: built.typeList, mons: entries, marks, ribbons, roles };
  mkdir(path.join(ROOT, "data"));
  fs.writeFileSync(path.join(ROOT, "data", "payload.json"), JSON.stringify(payload));

  log(`데이터 ${entries.length}종 ` +
      `(기본 ${entries.filter(e => !e.f).length} / 폼 ${entries.filter(e => e.f).length}) · ` +
      `증표 ${marks.length} · 리본 ${ribbons.length} · 트레이너 칭호 ${roles.reduce((n,g)=>n+g.items.length,0)}`);
  if (built.englishFallback.length) {
    log(`  한글 폼 이름이 없어 영문으로 둔 것 ${built.englishFallback.length}종: ` +
        built.englishFallback.slice(0, 8).join(", ") + (built.englishFallback.length > 8 ? " …" : ""));
  }
  return entries;
}

async function main() {
  const step = process.argv[2] || "all";
  mkdir(CACHE);

  if (step === "html") { buildHtml(); return; }

  if (step === "data") { await buildData({ withSprites: false }); buildHtml(); return; }

  if (step === "sheets") {
    const payload = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "payload.json"), "utf8"));
    await fetchSprites(payload.mons.map(m => m.i));
    await repairSprites();
    await buildSheets(payload.mons);
    return;
  }

  if (step !== "all") { console.error(`알 수 없는 단계: ${step}`); process.exit(1); }

  const entries = await buildData({ withSprites: true });
  await buildSheets(entries);
  buildHtml();
  log("\n빌드 완료 — index.html 을 브라우저로 열면 됩니다.");
}

main().catch(err => { console.error("\n빌드 실패:", err.message); process.exit(1); });
