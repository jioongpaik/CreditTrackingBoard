import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  Upload, Loader2, Check, X, Trash2, FolderKanban,
  TrendingUp, Users, Image as ImageIcon, AlertCircle, Pencil, Database, KeyRound,
  PieChart as PieChartIcon, Settings2, RotateCcw
} from "lucide-react";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell
} from "recharts";

/* ────────────────────────────────────────────────────────────
   크레딧 트래킹보드
   생성은 매그니픽(Magnific)/Higgsfield 웹에서. 이 앱은 "누가 어느 프로젝트에 크레딧을
   얼마나 썼나"만 대략으로 본다 — 모델별 구분은 하지 않는다.
   프로젝트 시작 전/후 잔액 캡쳐 두 장을 던지면 Gemini 비전이 숫자를 읽고,
   그 델타를 한 건으로 원장에 기입한다.
   ──────────────────────────────────────────────────────────── */

const C = {
  ground: "#0A0B0D", panel: "#16171A", panel2: "#1D1F23",
  line: "#232529", line2: "#2E3136", text: "#F1F0ED",
  muted: "#9BA0A8", dim: "#83838D", // dim은 #63676E였는데 패널 배경 대비 명암비가 3.4:1(WCAG 본문 기준 4.5:1 미달)이라
  // 서브텍스트가 흐릿하게 읽혔음 — 4.5:1대로 밝혀서 라벨·캡션·축 눈금까지 한번에 가독성을 올린다.
  primary: "#8B7CF6", primaryDeep: "#6C5CE0", // 앱 고유 액센트(구 브라스/골드 대체) — 버튼·포커스링·강조 숫자
  rust: "#E2725B", slate: "#4FB6DB", moss: "#5FBF77",
};
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const SANS = "'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";
// 프로젝트 식별 색상 — 항상 이 순서로 고정 배정. 인접 슬롯끼리 확실히 구별되도록 색상환을 순회한다.
// slot 0(primary)은 앱 액센트와 동일 — 브랜드 색이 곧 1순위 카테고리 색이 되는 흔한 패턴.
const SERIES = [C.primary, C.slate, C.moss, C.rust, "#E8779A", "#57C7C0", "#5B8FE0", "#E8965A"];
// 데이터 배열에서의 index로 색을 고정 배정 (정렬 순서가 곧 색 순서 — Tooltip·라벨·Cell이 전부 이 함수 하나만 참조한다)
const colorAt = (i) => SERIES[i % SERIES.length];

// 플랫폼(게이트웨이) 고유 색 — 실제 브랜드 색에서 따옴(매그니픽(Magnific) 네온 핑크, Higgsfield 네온 라임 확인;
// Kling은 사이트에서 뚜렷한 브랜드 색을 확인 못 해 요청하신 "초록" 톤으로 대체 지정).
// 이름 기준으로 고정 배정하는 이유: byGateway 정렬 순서(rank)가 바뀌어도 같은 플랫폼은 항상 같은 색이어야 함.
const GATEWAY_COLORS = { magnific: "#FF58AE", higgsfield: "#D1FE17", kling: "#2FE87D" };
function hashIndex(str, mod) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h % mod;
}
function gatewayColor(name) {
  const key = (name || "").trim().toLowerCase();
  if (GATEWAY_COLORS[key]) return GATEWAY_COLORS[key];
  return SERIES[hashIndex(key || "기타", SERIES.length)];
}

// 플랫폼 한글 표시명 — 게이트웨이 값(영문 식별자)과 화면에 보여줄 한글 이름을 분리해서,
// 어디서 이 이름을 렌더링하든(링, 카드 헤더, 표, 차트 라벨) 여기 한 곳만 고치면 된다.
const GATEWAY_LABELS = { magnific: "매그니픽", higgsfield: "힉스필드", kling: "클링" };
function gatewayLabel(name) {
  const key = (name || "").trim().toLowerCase();
  return GATEWAY_LABELS[key] || name || "기타";
}
// 수동 입력 폼의 게이트웨이 드롭다운 선택지 — 자유 입력 대신 알려진 플랫폼만 고르게 해서
// 오탈자로 색·한도·갱신일 매칭이 깨지는 걸 막는다.
const GATEWAY_OPTIONS = [
  { value: "Magnific", label: "매그니픽" },
  { value: "Higgsfield", label: "힉스필드" },
  { value: "Kling", label: "클링" },
];

// 플랫폼별 크레딧 갱신일(매월 며칠) — 사용자가 알려준 값. 알려지지 않은 게이트웨이는 null(표시 안 함).
const GATEWAY_RESET_DAY = { magnific: 7, higgsfield: 6, kling: 6 };
function gatewayResetDay(name) {
  const key = (name || "").trim().toLowerCase();
  return GATEWAY_RESET_DAY[key] ?? null;
}
// 오늘 기준 "이번 달 그 날짜"가 이미 지났으면 다음 달로 — 매달 반복되는 갱신일의 다음 발생일을 구한다.
function nextReset(day) {
  const now = new Date();
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let d = new Date(now.getFullYear(), now.getMonth(), day);
  if (d <= today0) d = new Date(now.getFullYear(), now.getMonth() + 1, day);
  const daysLeft = Math.round((d - today0) / 86400000);
  return { date: d, daysLeft };
}

// 플랫폼별 매달 전체 크레딧 한도 — 알려진 값만 채운다. 모르는 플랫폼은 null로 둬서
// "이 링이 뭘 나타내는지" 링 자체(사용량/한도)와 "얼마나 썼는지"(총 사용량)를 섞어 보여주지 않는다.
const GATEWAY_LIMIT = { higgsfield: 4000, magnific: 299900 }; // kling 등은 총량 확인되면 여기 추가
function gatewayLimit(name) {
  const key = (name || "").trim().toLowerCase();
  return GATEWAY_LIMIT[key] ?? null;
}

const STORE_KEY = "creditboard-v1";
const API_KEY_STORE = "creditboard-api-key-v1"; // 로컬 테스트 전용 저장소 — 팀 배포판엔 넣지 말 것
const GEMINI_MODEL = "gemini-2.5-flash"; // 계정에서 접근 가능한 다른 비전 모델이 있다면 여기만 바꾸면 됨

const SEED = {
  projects: ["케이뱅크", "폴바셋", "듀오버스터", "제주항공", "이마트 자연주의"],
  users: ["백지웅", "황주혜"],
  projectColors: {}, // { "프로젝트명": "#hex" } — 지정 없으면 projectColorOf()가 자동 배정
  // { "게이트웨이(소문자)": number } — 플랫폼 자체 화면에서 읽은 "현재 총 사용량"을 직접 기록.
  // 있으면 플랫폼별 사용현황 링은 이 값을 우선 쓴다. 원장은 시작/종료 스냅샷의 델타만 기록하기
  // 때문에, 캡쳐와 캡쳐 사이 공백 기간에 쓴 크레딧은 원장 합계에 안 잡힌다 — 그래서 원장 합계보다
  // 이 값이 항상 크거나 같다. (사용자별 세부 내역은 여전히 원장 기준이라 이 값과는 안 맞을 수 있음.)
  gatewayTotals: {}, // 매그니픽은 아래 e15/e16으로 공백 구간을 원장에 직접 채워서 이제 필요 없음
  entries: [
    { id: "e1", ts: "2026-07-13", project: "제주항공", user: "백지웅", gateway: "Magnific", count: 0, credits: 1200 },
    { id: "e2", ts: "2026-07-14", project: "제주항공", user: "백지웅", gateway: "Magnific", count: 0, credits: 900 },
    { id: "e3", ts: "2026-07-15", project: "듀오버스터", user: "백지웅", gateway: "Magnific", count: 0, credits: 12300 },
    { id: "e4", ts: "2026-07-16", project: "듀오버스터", user: "백지웅", gateway: "Magnific", count: 0, credits: 4100 },
    { id: "e5", ts: "2026-07-20", project: "케이뱅크", user: "백지웅", gateway: "Magnific", count: 0, credits: 45500 },
    { id: "e6", ts: "2026-07-21", project: "케이뱅크", user: "백지웅", gateway: "Magnific", count: 0, credits: 10000 },
    { id: "e7", ts: "2026-07-22", project: "듀오버스터", user: "백지웅", gateway: "Magnific", count: 0, credits: 16800 },
    { id: "e8", ts: "2026-07-27", project: "듀오버스터", user: "백지웅", gateway: "Magnific", count: 0, credits: 7900 },
    { id: "e9", ts: "2026-07-28", project: "듀오버스터", user: "백지웅", gateway: "Magnific", count: 0, credits: 1400 },
    { id: "e10", ts: "2026-07-31", project: "듀오버스터", user: "백지웅", gateway: "Magnific", count: 0, credits: 400 },
    // 0714 힉스필드 930cr을 듀오버스터 60% / 제주항공 40%로 분배(사용자 확인값)
    { id: "e11", ts: "2026-07-14", project: "듀오버스터", user: "백지웅", gateway: "Higgsfield", count: 0, credits: 558 },
    { id: "e12", ts: "2026-07-14", project: "제주항공", user: "백지웅", gateway: "Higgsfield", count: 0, credits: 372 },
    { id: "e13", ts: "2026-07-29", project: "케이뱅크", user: "황주혜", gateway: "Higgsfield", count: 0, credits: 352 },
    // 정확한 날짜 없음 — 7/6~7/8 사이 사용, 범위 중간인 7/7로 기입(사용자 확인)
    { id: "e14", ts: "2026-07-07", project: "폴바셋", user: "황주혜", gateway: "Higgsfield", count: 0, credits: 2006 },
    // 매그니픽 실제 총 사용(230,900) - 원장 추적분(100,500) = 130,400cr 공백 구간 보정.
    // 케이뱅크 80% / 제주항공 20% 비율 유지, 7월 1~3주차에 걸쳐 분할 기입(사용자 확인값).
    { id: "e15", ts: "2026-07-03", project: "케이뱅크", user: "백지웅", gateway: "Magnific", count: 0, credits: 35200 },
    { id: "e16", ts: "2026-07-03", project: "제주항공", user: "백지웅", gateway: "Magnific", count: 0, credits: 8800 },
    { id: "e17", ts: "2026-07-09", project: "케이뱅크", user: "백지웅", gateway: "Magnific", count: 0, credits: 35200 },
    { id: "e18", ts: "2026-07-09", project: "제주항공", user: "백지웅", gateway: "Magnific", count: 0, credits: 8800 },
    { id: "e19", ts: "2026-07-17", project: "케이뱅크", user: "백지웅", gateway: "Magnific", count: 0, credits: 33920 },
    { id: "e20", ts: "2026-07-17", project: "제주항공", user: "백지웅", gateway: "Magnific", count: 0, credits: 8480 },
  ],
};

let seq = 100;
const nid = () => "e" + (seq++) + Date.now().toString(36);

/* ── 저장 계층 ────────────────────────────────────────────── */
async function loadState() {
  try {
    const r = await window.storage.get(STORE_KEY);
    if (r && r.value) return JSON.parse(r.value);
  } catch { /* 최초 실행이면 키가 없다 */ }
  return null;
}
async function saveState(state) {
  try { await window.storage.set(STORE_KEY, JSON.stringify(state)); } catch (e) { console.error(e); }
}

/* ── 캡쳐 한 장 → 원장 여러 줄 (Gemini 비전) ──────────────────
   로컬 테스트 전용: Gemini API를 브라우저에서 직접 호출한다. Google의 Generative Language
   API는 클라이언트에서 API 키로 직접 부르는 걸 표준으로 지원하지만, 그래도 이 키는 브라우저에
   그대로 노출된다 — 팀 배포판에는 이 방식을 쓰지 말 것. HANDOFF.md §4/§P0의 백엔드 프록시로
   교체하거나, 최소한 Google AI Studio에서 이 키에 HTTP 리퍼러 제한을 걸어둘 것.
   팀원들이 실제로 공유하는 캡쳐는 한 항목짜리 카톡 캡쳐 한 장일 때도 있고, 한 주 치를
   "0713 제주항공 / 0714 제주항공 / 0715 듀오버스터…" 식으로 날짜·프로젝트 블록 여러 개를
   나란히 이어붙인 배치 캡쳐일 때도 있다 — 그래서 응답을 항상 entries 배열로 받는다(단일
   항목이면 배열 길이 1). 플랫폼(게이트웨이)이나 사람 이름은 보통 캡쳐 전체에 한 번만
   나오므로(예: 왼쪽 여백의 "매그니픽" 라벨, 카톡 발신자명) 최상위 필드로 따로 받고,
   블록마다 다르게 보이면 그 블록의 entries 항목에서 값을 덮어쓸 수 있게 한다. */
async function parseUsageCapture(base64, mediaType, apiKey, { projects, users, currentYear }) {
  const sys = `너는 팀 크레딧 사용 기록용 캡쳐를 읽어 원장 항목(들)을 만드는 파서다.
캡쳐는 두 가지 형태일 수 있다:
1) 날짜 하나 + 프로젝트 하나 + 크레딧 위젯 한두 개만 있는 단일 항목 캡쳐.
2) "MMDD 프로젝트명" 헤더가 여러 개 나란히(가로로) 이어붙은 주간 배치 캡쳐. 각 헤더 아래에
   보통 "Credit usage"(또는 Spent/Available) 카드가 1~2개 있다 — 위/먼저 나오는 카드가 시작
   (before), 아래/나중 카드가 종료(after)다. Spent 숫자가 더 작은 쪽이 항상 시작 캡쳐다.
   플랫폼 이름(예: "매그니픽")은 보통 캡쳐 왼쪽 여백에 세로로 한 번만 적혀 전체 블록에 공통 적용된다.

각 날짜/프로젝트 블록을 entries 배열의 항목 하나로 만들어라. 블록이 하나뿐이면 entries 길이는 1이다.

읽는 규칙:
- 날짜: MMDD나 M/D처럼 연도 없는 형식이면 ${currentYear}년 기준으로 YYYY-MM-DD로 변환해라. 못 찾으면 null.
- 프로젝트명: 알려진 프로젝트 목록과 같은 프로젝트면 반드시 그 목록의 정확한 표기로 반환해라(오탈자·띄어쓰기 차이는 목록 표기를 우선). 알려진 프로젝트 목록: ${JSON.stringify(projects)}
- 게이트웨이(플랫폼): 로고·여백 라벨·배경색·텍스트로 판단해라. 화면에 "Freepik"이 보이면 "Magnific"으로 적어라. 라임/노란 배경에 점 게이지는 Higgsfield일 가능성이 높다. 캡쳐 전체에 공통이면 최상위 gateway에, 블록마다 다르면 해당 entries 항목에도 넣어라.
- 사람 이름: 별명이거나 성이 빠져 있어도 알려진 사용자 목록 중 같은 사람이면 목록의 정확한 표기로 반환해라(예: "주혜"→목록에 "황주혜"가 있으면 "황주혜"). 캡쳐 전체에 한 번만 보이면 최상위 user에 넣어라. 알려진 사용자 목록: ${JSON.stringify(users)}
- 크레딧: 한 블록에 위젯이 두 개면 위=before, 아래=after로 보고 credits = after_spent - before_spent (또는 before_available - after_available)로 계산해라. 숫자에 K(천) 단위가 붙어 있으면 환산해라(113.8K→113800). 위젯이 하나뿐이면 before/after 중 보이는 값만 채우고 credits는 null로 둬라.
- 중요: 이미지 안에 사람이 직접 쓴 메모나 캡션이 화면 숫자와 다른 "진짜 시작값/사용량"을 알려주면(예: "캡쳐를 뒤늦게 했어요, 874개로 시작했습니다") 화면 배지 숫자보다 그 메모를 우선해서 반영해라.
- 확신이 없는 값은 절대 지어내지 말고 null로 둬라.

반드시 아래 JSON만 출력한다:
{"gateway":string|null,"user":string|null,"entries":[{"date":string|null,"project":string|null,"gateway":string|null,"user":string|null,"before":number|null,"after":number|null,"credits":number|null,"note":string}]}
note에는 그 항목에서 읽기 어려웠던 점이나 메모로 값을 보정했다면 그 내용을 한국어 한 문장으로, 없으면 빈 문자열.`;

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: sys }] },
      contents: [{
        role: "user",
        parts: [
          { text: "이 캡쳐에서 날짜·프로젝트·게이트웨이·사람·전후 크레딧을 항목별로 읽어줘. JSON만 출력." },
          { inline_data: { mime_type: mediaType, data: base64 } },
        ],
      }],
      generationConfig: { responseMimeType: "application/json" },
    }),
  });
  if (!res.ok) {
    if (res.status === 400 || res.status === 403) throw new Error("API 키가 올바르지 않습니다");
    const body = await res.text().catch(() => "");
    throw new Error("파싱 요청 실패 (" + res.status + ")" + (body ? " — " + body.slice(0, 160) : ""));
  }
  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1]);
    r.onerror = () => rej(new Error("파일 읽기 실패"));
    r.readAsDataURL(file);
  });
}

/* ── 전역 스타일 (폰트 로드 · 포커스 링 · 스크롤바 · 모션) ── */
const GLOBAL_CSS = `
  @import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css');
  *{box-sizing:border-box}
  ::selection{background:rgba(139,124,246,0.35);color:#fff}
  ::-webkit-scrollbar{width:9px;height:9px}
  ::-webkit-scrollbar-track{background:transparent}
  ::-webkit-scrollbar-thumb{background:${C.line2};border-radius:999px}
  ::-webkit-scrollbar-thumb:hover{background:${C.dim}}
  button,select,input{font-family:inherit}
  button{cursor:pointer}
  button:disabled{cursor:not-allowed}
  button:focus-visible,select:focus-visible,input:focus-visible{
    outline:none;
    box-shadow:0 0 0 2px ${C.ground},0 0 0 4px rgba(139,124,246,0.55);
    border-radius:6px;
  }
  .cb-card{transition:background-color .2s ease}
  .cb-dropzone{transition:border-color .2s ease,box-shadow .2s ease,background-color .2s ease}
  .cb-dropzone:hover{border-color:${C.primary};box-shadow:0 0 0 3px rgba(139,124,246,0.1)}
  .cb-ghost:hover{background:rgba(255,255,255,0.06)}
  .cb-ghost{transition:background-color .15s ease,color .15s ease}
  .cb-row{transition:background-color .15s ease}
  .cb-row:hover{background:rgba(255,255,255,0.025)}
  .cb-primary{transition:filter .15s ease,transform .1s ease}
  .cb-primary:hover:not(:disabled){filter:brightness(1.1)}
  .cb-primary:active:not(:disabled){transform:scale(0.98)}
  .cb-select{transition:border-color .15s ease}
  .cb-select:hover{border-color:${C.line2}}
  @keyframes cbFadeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}
  @keyframes cbToastIn{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}
  .cb-fade-in{animation:cbFadeIn .2s ease-out}
  .cb-toast-in{animation:cbToastIn .22s ease-out}
  @media (prefers-reduced-motion: reduce){
    *{animation-duration:.001ms!important;transition-duration:.001ms!important}
  }
`;

/* 플랫폼 링(도넛)에 쓰는 SVG 그라디언트 — 실제로 화면에 등장한 색만 동적으로 정의한다.
   (매그니픽/Higgsfield/Kling 브랜드 색은 SERIES 밖의 임의 hex라 카테고리 그라디언트를 재사용할 수 없음) */
function GatewayGradientDefs({ colors }) {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        {colors.map((c) => (
          <linearGradient id={`pf-grad-${c.replace("#", "")}`} key={c} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={c} stopOpacity="1" />
            <stop offset="100%" stopColor={c} stopOpacity="0.55" />
          </linearGradient>
        ))}
      </defs>
    </svg>
  );
}

/* ── API 키 입력 (로컬 테스트 전용) ──────────────────────────
   프론트에서 Gemini API를 직접 부르기 위한 임시 수단. 키는 이 브라우저의
   localStorage에만 남는다 — 팀원과 공유되는 순간 그 사람 브라우저에도 키가
   그대로 노출되므로, 실제 배포 전에는 반드시 백엔드 프록시로 교체해야 한다. */
function ApiKeyBox({ apiKey, onSave }) {
  const [editing, setEditing] = useState(!apiKey);
  const [val, setVal] = useState(apiKey || "");

  return (
    <div style={{ background: C.ground, border: `1px solid ${C.line}` }} className="rounded-[10px] p-2.5 mb-3">
      <div className="flex items-center gap-1.5 mb-1.5">
        <KeyRound size={12} style={{ color: C.dim }} />
        <span style={{ color: C.dim, fontFamily: MONO }} className="text-[9px] tracking-[0.12em] uppercase">Gemini API 키 · 로컬 테스트용</span>
      </div>
      {editing ? (
        <div className="flex gap-1.5">
          <input
            type="password"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            placeholder="AIzaSy..."
            style={selStyle}
            className="cb-select flex-1 px-2 py-1.5 rounded-[6px] text-[11.5px] outline-none"
          />
          <button
            disabled={!val}
            onClick={() => { onSave(val); setEditing(false); }}
            style={{ background: val ? C.primary : C.line, color: val ? "#fff" : C.dim }}
            className="cb-primary px-3 rounded-[6px] text-[11.5px] font-semibold"
          >저장</button>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <span style={{ color: C.muted, fontFamily: MONO }} className="text-[11.5px]">키 저장됨 · ••••{apiKey.slice(-4)}</span>
          <button onClick={() => { setVal(apiKey); setEditing(true); }} style={{ color: C.dim }} className="cb-ghost text-[11px] px-2 py-1 rounded-[5px]">변경</button>
        </div>
      )}
      <p style={{ color: C.muted }} className="text-[11px] leading-relaxed mt-1.5">
        이 브라우저에만 저장됩니다. 개인 테스트용 — 이 상태로 팀원과 공유하지 마세요.
      </p>
    </div>
  );
}


/* ── 프로젝트 관리 (추가/삭제/색) ─────────────────────────────
   헤더 필터 옆의 톱니 버튼 — 누르면 목록이 펼쳐지고, 각 항목의 색 스와치로 그 프로젝트의
   색을 바꾸거나(네이티브 컬러 피커), X로 삭제하거나, 맨 아래 입력창으로 새 프로젝트를
   추가할 수 있다. 기록이 있는 프로젝트를 지우려 하면 확인을 한 번 거친다(기존 기록은
   지워지지 않고 필터 목록에서만 빠진다). */
function ProjectManager({ projects, entryCounts, colorOf, customColors, onAdd, onRemove, onColorChange, onColorReset }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState("");

  const submit = () => {
    const name = val.trim();
    if (!name) return;
    onAdd(name);
    setVal("");
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="프로젝트 관리"
        title="프로젝트 관리"
        style={{ border: `1px solid ${C.line}`, color: open ? C.primary : C.muted }}
        className="cb-ghost w-[34px] h-[34px] rounded-[8px] grid place-items-center shrink-0"
      >
        <Settings2 size={14} />
      </button>
      {open && (
        <div
          style={{ background: C.panel2, border: `1px solid ${C.line2}`, boxShadow: "0 12px 28px -10px rgba(0,0,0,0.6)" }}
          className="cb-fade-in absolute right-0 top-[calc(100%+6px)] z-40 w-[268px] rounded-[12px] p-3"
        >
          <div style={{ color: C.dim, fontFamily: MONO }} className="text-[9px] tracking-[0.12em] uppercase mb-2">프로젝트 관리</div>
          <div className="space-y-1 max-h-[220px] overflow-y-auto mb-2">
            {projects.map((p) => (
              <div key={p} className="flex items-center justify-between gap-2 py-1">
                <div className="flex items-center gap-2 min-w-0">
                  <label className="relative shrink-0 block w-4 h-4 rounded-[4px] cursor-pointer" title={p + " 색 지정"}>
                    <span style={{ background: colorOf(p), border: `1px solid ${C.line2}` }} className="block w-4 h-4 rounded-[4px]" />
                    <input
                      type="color"
                      value={colorOf(p)}
                      onChange={(e) => onColorChange(p, e.target.value)}
                      className="absolute inset-0 w-4 h-4 opacity-0 cursor-pointer"
                    />
                  </label>
                  <span className="text-[12px] truncate">{p}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {entryCounts[p] ? <span style={{ color: C.dim, fontFamily: MONO }} className="text-[10px]">{entryCounts[p]}건</span> : null}
                  {customColors[p] && <button onClick={() => onColorReset(p)} aria-label={p + " 색 초기화"} title="자동 색으로" style={{ color: C.dim }} className="cb-ghost p-1 rounded-[5px]"><RotateCcw size={11} /></button>}
                  <button onClick={() => onRemove(p)} aria-label={p + " 삭제"} style={{ color: C.dim }} className="cb-ghost p-1 rounded-[5px]"><X size={12} /></button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-1.5">
            <input
              value={val}
              onChange={(e) => setVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              placeholder="새 프로젝트명"
              style={selStyle}
              className="cb-select flex-1 px-2 py-1.5 rounded-[6px] text-[11.5px] outline-none"
            />
            <button onClick={submit} style={{ background: C.primary, color: "#fff" }} className="cb-primary px-2.5 rounded-[6px] text-[11.5px] font-semibold">추가</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── 소형 UI ──────────────────────────────────────────────── */
function Card({ children, className = "", style = {} }) {
  return (
    <div
      style={{
        background: C.panel,
        boxShadow: "0 1px 0 rgba(255,255,255,0.03) inset, 0 14px 28px -20px rgba(0,0,0,0.7)",
        ...style,
      }}
      className={"cb-card rounded-[18px] " + className}
    >
      {children}
    </div>
  );
}
function SectionTitle({ icon: Icon, children, rank }) {
  return (
    <div className="flex items-center gap-2 mb-3.5">
      {rank && <span style={{ background: C.primary, color: "#fff", fontFamily: MONO }} className="w-[18px] h-[18px] rounded-[5px] grid place-items-center text-[10px] font-bold">{rank}</span>}
      <Icon size={15} style={{ color: C.primary }} />
      <h3 className="text-[13.5px] font-semibold tracking-tight">{children}</h3>
    </div>
  );
}
const selStyle = { background: C.ground, border: `1px solid ${C.line}`, color: C.text, fontFamily: SANS };

// colorFor(label)이 있으면 그걸로 스와치·수치 색을 정한다 — Recharts Tooltip은 개별 <Cell> 색을
// 그대로 물려주지 않고 <Bar>의 기본 fill을 쓰기 때문에, Cell로 항목마다 색을 다르게 준 차트는
// colorFor 없이는 "막대 색"과 "툴팁 색"이 어긋난다.
function TT({ active, payload, label, unit, colorFor }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{ background: C.panel2, border: `1px solid ${C.line2}`, fontFamily: MONO, boxShadow: "0 8px 20px -6px rgba(0,0,0,0.5)" }} className="px-2.5 py-2 rounded-[8px] text-[11px] min-w-[120px]">
      <div style={{ color: C.dim, fontFamily: SANS }} className="mb-1.5 text-[10.5px]">{label}</div>
      {payload.map((p, i) => {
        const color = colorFor ? colorFor(label) : (p.color || C.muted);
        return (
          <div key={i} className="flex items-center gap-1.5 tabular-nums">
            <span style={{ background: color, width: 6, height: 6, borderRadius: 2 }} className="shrink-0" />
            <span style={{ color: C.muted, fontFamily: SANS }} className="truncate">{p.name}</span>
            <span style={{ color }} className="ml-auto pl-2 font-medium">{Number(p.value).toLocaleString()}{unit}</span>
          </div>
        );
      })}
    </div>
  );
}

// 누적(stacked) 막대 끝에 합계를 붙이는 라벨 — 폭 0짜리 더미 시리즈(__total)에 매달아서
// "이 사용자가 총 얼마 썼는지"를 막대 끝에서 바로 읽을 수 있게 한다. pct=true면 플랫폼 한도
// 대비 %를 주 값으로, 원크레딧 합계는 괄호 안에 참고용으로 같이 보여준다.
function makeStackTotalLabel(rows, pct = false) {
  return (props) => {
    const { x, y, height, index } = props;
    const row = rows[index];
    if (!row) return null;
    if (!pct) {
      return (
        <text x={x + 6} y={y + height / 2 + 4} fontSize={11} fontFamily={MONO} fill={C.text} textAnchor="start">
          {(row.total ?? 0).toLocaleString()}
        </text>
      );
    }
    return (
      <text x={x + 6} y={y + height / 2 + 4} fontSize={11} fontFamily={MONO} textAnchor="start">
        <tspan fill={C.text}>{row.totalPct}%</tspan>
        <tspan fill={C.dim}> ({(row.total ?? 0).toLocaleString()}cr)</tspan>
      </text>
    );
  };
}

/* ── 플랫폼 사용현황 링 ───────────────────────────────────────
   플랫폼(게이트웨이)마다 독립된 도넛 카드 하나 — "이 플랫폼의 이번 달 한도 중 얼마나 썼나"를
   보여준다. 한도(GATEWAY_LIMIT)를 아는 플랫폼만 %를 계산하고, 모르는 플랫폼은 링을 채우지
   않고 "한도 미설정"이라고 정직하게 표시한다.
   ledgerCredits(원장 델타 합계)와 override(플랫폼 화면에서 직접 읽은 현재 총 사용량)를 따로
   받는다 — 캡쳐 사이 공백 기간의 사용량은 원장에 안 잡히기 때문에 원장 합계가 실제보다 작을 수
   있어서, override가 있으면 그걸 우선한다("직접입력" 표시). 없으면 원장 합계를 쓴다("기록 합계").
   링 색은 gatewayColor(name)로 고정 배정 — 정렬 순위가 아니라 플랫폼 이름 자체에 묶여 있어서,
   필터를 바꿔 순위가 뒤집혀도 같은 플랫폼은 항상 같은 색이다. */
function PlatformRing({ name, ledgerCredits, override, onSetOverride, onResetOverride }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  const credits = override != null ? override : ledgerCredits;
  const limit = gatewayLimit(name);
  const hasLimit = limit != null && limit > 0;
  const pct = hasLimit ? Math.round((credits / limit) * 100) : null;
  const color = gatewayColor(name);
  const resetDay = gatewayResetDay(name);
  const reset = resetDay ? nextReset(resetDay) : null;
  const data = hasLimit
    ? [{ name, value: Math.min(credits, limit) }, { name: "rest", value: Math.max(limit - credits, 0) }]
    : [{ name, value: 0 }, { name: "rest", value: 1 }];

  const submit = () => {
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0) { setEditing(false); return; }
    onSetOverride(name, n);
    setEditing(false);
  };

  return (
    <Card className="p-4 flex flex-col items-center">
      <div style={{ color: C.dim, fontFamily: MONO }} className="self-start text-[9.5px] tracking-[0.12em] uppercase mb-1 truncate w-full">{gatewayLabel(name)}</div>
      <div style={{ width: "100%", height: 128, position: "relative" }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius="70%"
              outerRadius="100%"
              startAngle={90}
              endAngle={-270}
              stroke="none"
              cornerRadius={6}
              isAnimationActive={false}
            >
              <Cell fill={`url(#pf-grad-${color.replace("#", "")})`} />
              <Cell fill={C.line} />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div style={{ position: "absolute", inset: 0 }} className="flex flex-col items-center justify-center pointer-events-none">
          <div style={{ fontFamily: MONO, color: C.text }} className="text-[17px] font-semibold tabular-nums leading-tight">{credits.toLocaleString()}</div>
          {hasLimit ? (
            <div style={{ color, fontFamily: MONO }} className="text-[10px] font-medium">{pct}% · 한도 {limit.toLocaleString()}</div>
          ) : (
            <div style={{ color: C.dim, fontFamily: MONO }} className="text-[9px]">한도 미설정</div>
          )}
        </div>
      </div>

      {editing ? (
        <div className="flex gap-1 mt-2 w-full">
          <input
            autoFocus
            type="number"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") setEditing(false); }}
            placeholder="현재 총 사용량"
            style={{ ...selStyle, fontFamily: MONO }}
            className="cb-select flex-1 min-w-0 px-2 py-1 rounded-[6px] text-[10.5px] outline-none"
          />
          <button onClick={submit} style={{ background: color, color: C.ground }} className="cb-primary px-2 rounded-[6px] text-[10px] font-semibold shrink-0">저장</button>
        </div>
      ) : (
        <button
          onClick={() => { setVal(String(credits)); setEditing(true); }}
          style={{ color: C.dim }}
          className="cb-ghost mt-2 px-1.5 py-0.5 rounded-[4px] text-[9px] flex items-center gap-1"
        >
          <Pencil size={9} />{override != null ? "직접입력값" : "기록 합계"}
        </button>
      )}
      {override != null && !editing && (
        <button onClick={() => onResetOverride(name)} style={{ color: C.dim }} className="cb-ghost -mt-0.5 px-1.5 py-0.5 rounded-[4px] text-[9px] flex items-center gap-1">
          <RotateCcw size={9} />기록 합계로
        </button>
      )}

      {reset && (
        <div style={{ color: C.dim, fontFamily: MONO }} className="text-[10px] mt-1.5 tabular-nums">
          {reset.date.getMonth() + 1}/{reset.date.getDate()} 갱신 · {reset.daysLeft === 0 ? "오늘" : `D-${reset.daysLeft}`}
        </div>
      )}
    </Card>
  );
}

export default function CreditBoard() {
  const [state, setState] = useState(null);        // {projects, users, entries}
  const [ready, setReady] = useState(false);
  const [project, setProject] = useState("전체");
  const [range, setRange] = useState("월");
  const [toast, setToast] = useState(null);

  // 캡쳐 한 장으로 자동 기입 — 단일 항목이든 여러 날짜/프로젝트가 이어붙은 배치 캡쳐든
  // 항상 행(row) 배열로 다룬다(단일 항목이면 배열 길이 1).
  const [captureBusy, setCaptureBusy] = useState(false);
  const [captureErr, setCaptureErr] = useState(null);
  const [captureRows, setCaptureRows] = useState([]); // [{id, date, project, user, gateway, before, after, credits, note}]
  const [bulkUser, setBulkUser] = useState("");
  const [bulkGateway, setBulkGateway] = useState("");
  const captureFileRef = useRef(null);
  const [apiKey, setApiKey] = useState(() => {
    try { return window.localStorage.getItem(API_KEY_STORE) || ""; } catch { return ""; }
  });
  const saveApiKey = (k) => {
    setApiKey(k);
    try { window.localStorage.setItem(API_KEY_STORE, k); } catch {}
  };

  // 수동 추가
  const [manual, setManual] = useState(false);

  useEffect(() => {
    (async () => {
      const saved = await loadState();
      setState(saved || SEED);
      setReady(true);
    })();
  }, []);
  useEffect(() => { if (ready && state) saveState(state); }, [state, ready]);

  const flash = (m) => { setToast(m); setTimeout(() => setToast(null), 2400); };

  const addProject = (name) => {
    setState((s) => {
      if (s.projects.includes(name)) { flash("이미 있는 프로젝트예요."); return s; }
      return { ...s, projects: [...s.projects, name] };
    });
    setProject(name);
    flash("프로젝트 추가됨 · " + name);
  };

  const removeProject = (name) => {
    const count = (state?.entries ?? []).filter((e) => e.project === name).length;
    if (count > 0 && !window.confirm(`"${name}"에 ${count}건의 기록이 있습니다. 그래도 목록에서 삭제할까요?\n(기존 기록은 남고, 필터·선택 목록에서만 빠집니다)`)) return;
    setState((s) => ({ ...s, projects: s.projects.filter((p) => p !== name) }));
    if (project === name) setProject("전체");
    flash("프로젝트 삭제됨 · " + name);
  };

  const entries = state?.entries ?? [];
  const filtered = useMemo(
    () => entries.filter((e) => project === "전체" || e.project === project),
    [entries, project]
  );

  /* ── 집계 ── */
  const totalCredits = filtered.reduce((s, e) => s + (e.credits || 0), 0);

  // 헤더 두 번째 지표: "생성 건수"는 원장에 건수가 안 쌓여(count가 항상 0) 늘 0만 보여서
  // 트래킹 대시보드에 의미가 없었다 — 대신 한도가 알려진 플랫폼들의 사용량/한도 합을 가중
  // 평균한 "한도 소진율"을 보여준다. 이 앱 전체가 "한도 대비 %" 관점으로 통일돼 있어서,
  // 헤더에서도 "이번 달 한도까지 얼마나 남았나"가 바로 보이는 게 트래킹 목적에 맞다.
  const limitUsagePct = useMemo(() => {
    const sums = {};
    filtered.forEach((e) => {
      const limit = gatewayLimit(e.gateway);
      if (!limit) return;
      const key = (e.gateway || "").trim().toLowerCase();
      if (!sums[key]) sums[key] = { used: 0, limit };
      sums[key].used += e.credits || 0;
    });
    const rows = Object.values(sums);
    if (!rows.length) return null;
    const usedTotal = rows.reduce((s, r) => s + r.used, 0);
    const limitTotal = rows.reduce((s, r) => s + r.limit, 0);
    return Math.round((usedTotal / limitTotal) * 1000) / 10;
  }, [filtered]);

  // 프로젝트별 크레딧 소모도 사용자별 사용 현황(§4)과 같은 이유로 원크레딧이 아니라 플랫폼 한도
  // 대비 %로 정규화한다 — 안 그러면 총량이 큰 플랫폼(매그니픽)을 쓴 프로젝트가 항상 커 보여서,
  // 작은 플랫폼(힉스필드)만 크게 쓴 프로젝트가 실제보다 작아 보이는 왜곡이 생긴다.
  const byProject = useMemo(() => {
    const m = {};
    entries.forEach((e) => {
      if (!m[e.project]) m[e.project] = { name: e.project, credits: 0, pct: 0, byGateway: {} };
      const limit = gatewayLimit(e.gateway);
      m[e.project].credits += e.credits || 0;
      m[e.project].pct += limit ? (e.credits || 0) / limit * 100 : 0;
      const gw = e.gateway || "기타";
      m[e.project].byGateway[gw] = (m[e.project].byGateway[gw] || 0) + (e.credits || 0);
    });
    return Object.values(m)
      .map((row) => ({ ...row, pct: Math.round(row.pct * 10) / 10 }))
      .sort((a, b) => b.pct - a.pct);
  }, [entries]);

  const byGateway = useMemo(() => {
    const m = {};
    filtered.forEach((e) => { const k = e.gateway || "기타"; m[k] = (m[k] || 0) + (e.credits || 0); });
    return Object.entries(m).map(([name, credits]) => ({ name, credits })).sort((a, b) => b.credits - a.credits);
  }, [filtered]);

  // 프로젝트 색: 사용자가 직접 지정한 색(state.projectColors)이 있으면 그걸 쓰고, 없으면
  // state.projects 안에서의 고정 위치로 자동 배정한다 — byGateway와 같은 이유로 정렬 순위가
  // 아니라 이름에 색을 묶어서, 다른 차트(사용자별 사용현황 등)와 색이 어긋나지 않게 한다.
  const projectColorOf = useCallback((name) => {
    const custom = state?.projectColors?.[name];
    if (custom) return custom;
    const idx = state?.projects.indexOf(name) ?? -1;
    return colorAt(idx < 0 ? 0 : idx);
  }, [state?.projects, state?.projectColors]);

  const setProjectColor = (name, hex) => {
    setState((s) => ({ ...s, projectColors: { ...(s.projectColors || {}), [name]: hex } }));
  };
  const resetProjectColor = (name) => {
    setState((s) => {
      const next = { ...(s.projectColors || {}) };
      delete next[name];
      return { ...s, projectColors: next };
    });
  };

  // 플랫폼의 "현재 총 사용량" 직접입력값 — 플랫폼 화면에서 읽은 값을 원장 합계보다 우선한다.
  const gatewayOverrideOf = useCallback((name) => {
    const key = (name || "").trim().toLowerCase();
    return state?.gatewayTotals?.[key] ?? null;
  }, [state?.gatewayTotals]);
  const setGatewayOverride = (name, n) => {
    const key = (name || "").trim().toLowerCase();
    setState((s) => ({ ...s, gatewayTotals: { ...(s.gatewayTotals || {}), [key]: n } }));
    flash(name + " 총 사용량 · " + n.toLocaleString() + "cr");
  };
  const resetGatewayOverride = (name) => {
    const key = (name || "").trim().toLowerCase();
    setState((s) => {
      const next = { ...(s.gatewayTotals || {}) };
      delete next[key];
      return { ...s, gatewayTotals: next };
    });
  };

  const projectEntryCounts = useMemo(() => {
    const m = {};
    entries.forEach((e) => { m[e.project] = (m[e.project] || 0) + 1; });
    return m;
  }, [entries]);

  const trend = useMemo(() => {
    const key = (ts) => {
      const d = new Date(ts);
      if (range === "일") return ts;
      if (range === "주") { const o = new Date(d); o.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return o.toISOString().slice(0, 10) + " 주"; }
      return ts.slice(0, 7);
    };
    const m = {};
    filtered.forEach((e) => { const k = key(e.ts); m[k] = (m[k] || 0) + (e.credits || 0); });
    return Object.entries(m).map(([t, credits]) => ({ t, credits })).sort((a, b) => a.t.localeCompare(b.t));
  }, [filtered, range]);

  // 사용자별 사용 현황: 사용자마다 "어느 프로젝트에 얼마나 썼는지"를 누적 막대로 쌓기 위한 집계.
  // 막대 값은 원크레딧이 아니라 "그 항목이 속한 플랫폼 한도 대비 %"의 합 — 원크레딧으로 쌓으면
  // 총량이 큰 플랫폼(매그니픽)을 쓴 사람이 항상 커 보이는 왜곡이 생겨서(예: 매그니픽 10만 vs
  // 힉스필드 2,358은 실제로는 각각 34%·59% 사용), 플랫폼별 비중으로 정규화한다. 한도를 모르는
  // 플랫폼의 항목은 기여도 0으로 빠진다(한도가 채워지면 자동으로 반영됨). 원크레딧 합계(total)는
  // 라벨에 참고용으로 같이 보여준다.
  // __total은 실제 값이 아니라 막대 끝에 합계 라벨을 앉히기 위한 폭 0짜리 더미 시리즈.
  const projectsInView = useMemo(
    () => (state?.projects ?? []).filter((p) => filtered.some((e) => e.project === p)),
    [state?.projects, filtered]
  );
  const byUserProject = useMemo(() => {
    const m = {};
    filtered.forEach((e) => {
      if (!m[e.user]) m[e.user] = { user: e.user, total: 0, totalPct: 0 };
      const limit = gatewayLimit(e.gateway);
      const pctShare = limit ? (e.credits || 0) / limit * 100 : 0;
      m[e.user][e.project] = (m[e.user][e.project] || 0) + pctShare;
      m[e.user].total += e.credits || 0;
      m[e.user].totalPct += pctShare;
    });
    return Object.values(m)
      .map((row) => {
        const out = { user: row.user, total: row.total, totalPct: Math.round(row.totalPct * 10) / 10, __total: 0.01 };
        for (const k of Object.keys(row)) {
          if (k !== "user" && k !== "total" && k !== "totalPct") out[k] = Math.round(row[k] * 10) / 10;
        }
        return out;
      })
      .sort((a, b) => b.totalPct - a.totalPct);
  }, [filtered]);

  // 사용자별 플랫폼 사용현황: 플랫폼마다 총량 스케일이 완전히 달라서(매그니픽 30만 vs 힉스필드
  // 4천) 한 막대에 같이 쌓으면 작은 쪽이 안 보인다 — 그래서 플랫폼별로 따로 집계해서
  // 스몰 멀티플(플랫폼 카드 여러 개, 각자 자기 스케일)로 그린다.
  // pct(플랫폼 한도 대비 %)도 같이 계산 — 원크레딧만 보면 "누가 더 썼나"가 플랫폼 총량 차이
  // 때문에 왜곡된다(예: 매그니픽 10만 vs 힉스필드 2,358이 실제로는 각각 33.5%·59% 사용).
  // 한도를 모르는 플랫폼은 pct를 null로 둬서 차트 쪽에서 크레딧 절대값으로 대체한다.
  const byUserGateway = useMemo(() => {
    const m = {};
    filtered.forEach((e) => {
      const g = e.gateway || "기타";
      if (!m[g]) m[g] = {};
      m[g][e.user] = (m[g][e.user] || 0) + (e.credits || 0);
    });
    const out = {};
    Object.entries(m).forEach(([g, users]) => {
      const limit = gatewayLimit(g);
      out[g] = Object.entries(users)
        .map(([name, credits]) => ({ name, credits, pct: limit ? Math.round((credits / limit) * 1000) / 10 : null }))
        .sort((a, b) => b.credits - a.credits);
    });
    return out;
  }, [filtered]);

  const ringGradientColors = useMemo(() => [...new Set(byGateway.map((g) => gatewayColor(g.name)))], [byGateway]);

  /* ── 캡쳐 한 장 → 자동 기입 (단일 항목/배치 공통) ── */
  const resetCapture = () => {
    setCaptureRows([]); setCaptureErr(null); setBulkUser(""); setBulkGateway("");
  };

  const handleCaptureFile = async (files) => {
    const file = files?.[0];
    if (!file || !file.type.startsWith("image/")) { setCaptureErr("이미지 파일만 됩니다."); return; }
    if (!apiKey) { setCaptureErr("API 키를 먼저 입력해주세요 (위 · 로컬 테스트용)."); return; }
    setCaptureErr(null); setCaptureBusy(true);
    try {
      const base64 = await fileToBase64(file);
      const parsed = await parseUsageCapture(base64, file.type, apiKey, {
        projects: state.projects, users: state.users, currentYear: new Date().getFullYear(),
      });
      const rawEntries = Array.isArray(parsed.entries) ? parsed.entries : [];
      if (!rawEntries.length) {
        setCaptureErr("캡쳐에서 항목을 찾지 못했습니다 — 다른 캡쳐를 시도하거나 수동으로 입력해주세요.");
        setCaptureRows([]);
        return;
      }
      const fallbackProject = project === "전체" ? (state.projects[0] || "") : project;
      const fallbackUser = (parsed.user && state.users.includes(parsed.user)) ? parsed.user : (state.users[0] || "");
      const fallbackGateway = parsed.gateway || "";
      const rows = rawEntries.map((e) => {
        const credits = e.credits ?? (e.before != null && e.after != null ? Math.round(e.before - e.after) : null);
        return {
          id: nid(),
          date: e.date || new Date().toISOString().slice(0, 10),
          project: e.project && state.projects.includes(e.project) ? e.project : fallbackProject,
          user: (e.user && state.users.includes(e.user)) ? e.user : fallbackUser,
          gateway: e.gateway || fallbackGateway,
          before: e.before ?? null,
          after: e.after ?? null,
          credits,
          note: e.note || "",
        };
      });
      setCaptureRows(rows);
      setBulkUser(fallbackUser);
      setBulkGateway(fallbackGateway);
      if (rows.some((r) => r.credits == null)) {
        setCaptureErr("일부 항목은 사용량을 계산하지 못했습니다 — 아래에서 직접 채우거나 제외해주세요.");
      }
    } catch (e) {
      setCaptureErr("자동 읽기 실패: " + (e.message || e) + " — 아래에서 수동으로 입력해주세요.");
      setCaptureRows([]);
    } finally {
      setCaptureBusy(false);
    }
  };

  const updateCaptureRow = (id, patch) => setCaptureRows((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeCaptureRow = (id) => setCaptureRows((rows) => rows.filter((r) => r.id !== id));
  const applyBulkUser = (u) => { setBulkUser(u); setCaptureRows((rows) => rows.map((r) => ({ ...r, user: u }))); };
  const applyBulkGateway = (g) => { setBulkGateway(g); setCaptureRows((rows) => rows.map((r) => ({ ...r, gateway: g }))); };

  const commitCaptureRows = () => {
    const toCommit = captureRows.filter((r) => r.credits != null && Number.isFinite(Number(r.credits)) && r.project);
    if (!toCommit.length) return;
    const newRows = toCommit.map((r) => ({
      id: nid(), ts: r.date, project: r.project, user: r.user || "", gateway: r.gateway || "-", count: 0, credits: Math.round(Number(r.credits)),
    }));
    setState((s) => ({ ...s, entries: [...newRows, ...s.entries] }));
    flash(newRows.length + "건 기입됨");
    resetCapture();
  };

  const removeEntry = (id) => setState((s) => ({ ...s, entries: s.entries.filter((e) => e.id !== id) }));

  const addManual = (row) => {
    setState((s) => ({ ...s, entries: [{ id: nid(), ...row }, ...s.entries] }));
    setManual(false);
    flash("수동 기입 완료 · " + row.credits + "cr");
  };

  const resetAll = () => {
    if (!window.confirm("모든 기록을 지우고 초기 예시로 되돌립니다. 계속할까요?")) return;
    setState(SEED); flash("초기화됨");
  };

  if (!ready) {
    return (
      <div style={{ background: C.ground, color: C.muted, fontFamily: SANS }} className="w-full min-h-screen grid place-items-center text-[13px]">
        <style>{GLOBAL_CSS}</style>
        <div className="flex items-center gap-2"><Loader2 size={15} className="animate-spin" style={{ color: C.primary }} /> 기록 불러오는 중…</div>
      </div>
    );
  }

  // "프로젝트별 크레딧 소모"는 전체 프로젝트를 볼 때만 의미가 있다 — 개별 프로젝트로 필터링된
  // 상태에서는 바(bar)가 하나뿐이라 보여줘 봐야 의미가 없어서 그때는 숨긴다. 섹션 번호(1/2/3…)는
  // 실제로 보이는 섹션 기준으로 다시 매겨서 번호가 건너뛰지 않게 한다.
  const showProjectChart = project === "전체";
  let rankSeq = 1;
  const rankPlatform = rankSeq++;
  const rankProject = showProjectChart ? rankSeq++ : null;
  const rankTrend = rankSeq++;
  const rankUser = rankSeq++;
  const rankUserGateway = rankSeq++;

  return (
    <div style={{ background: C.ground, color: C.text, fontFamily: SANS }} className="w-full min-h-screen flex flex-col text-[13px]">
      <style>{GLOBAL_CSS}</style>
      <GatewayGradientDefs colors={ringGradientColors} />

      {/* 헤더 */}
      <header style={{ borderBottom: `1px solid ${C.line}`, background: C.ground }} className="flex flex-wrap items-center gap-x-4 gap-y-2.5 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div style={{ background: `linear-gradient(135deg, ${C.primary}, ${C.primaryDeep})`, color: "#fff", fontFamily: MONO, boxShadow: "0 1px 2px rgba(0,0,0,0.3)" }} className="w-7 h-7 rounded-[9px] grid place-items-center text-[12px] font-bold">₵</div>
          <div className="leading-tight">
            <div className="text-[13.5px] font-semibold">크레딧 트래킹보드</div>
            <div style={{ background: "rgba(139,124,246,0.14)", color: C.primary, fontFamily: MONO }} className="inline-block mt-0.5 text-[9px] tracking-[0.13em] px-1.5 py-[2px] rounded-[4px] font-medium">TRACK ONLY · NO GENERATION</div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <select value={project} onChange={(e) => setProject(e.target.value)} style={selStyle} className="cb-select px-2.5 py-1.5 rounded-[8px] text-[12px] outline-none">
            <option value="전체">전체 프로젝트</option>
            {state.projects.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <ProjectManager
            projects={state.projects}
            entryCounts={projectEntryCounts}
            colorOf={projectColorOf}
            customColors={state.projectColors || {}}
            onAdd={addProject}
            onRemove={removeProject}
            onColorChange={setProjectColor}
            onColorReset={resetProjectColor}
          />
        </div>

        <div className="ml-auto flex items-center gap-4">
          <div className="text-right leading-tight">
            <div style={{ fontFamily: MONO, color: C.dim }} className="text-[9px] tracking-[0.14em] uppercase">누적 크레딧</div>
            <div style={{ fontFamily: MONO, color: C.primary }} className="text-[16.5px] tabular-nums">{totalCredits.toLocaleString()}<span style={{ color: C.dim }} className="text-[10px] ml-1">cr</span></div>
          </div>
          <div style={{ width: 1, background: C.line }} className="self-stretch" />
          <div className="text-right leading-tight">
            <div style={{ fontFamily: MONO, color: C.dim }} className="text-[9px] tracking-[0.14em] uppercase">한도 소진율</div>
            <div style={{ fontFamily: MONO, color: limitUsagePct != null && limitUsagePct >= 100 ? C.rust : C.text }} className="text-[16.5px] tabular-nums">
              {limitUsagePct != null ? `${limitUsagePct}%` : "—"}
            </div>
          </div>
          <button onClick={resetAll} aria-label="초기화" title="초기화" style={{ border: `1px solid ${C.line}`, color: C.dim }} className="cb-ghost p-2 rounded-[8px]"><Trash2 size={13} /></button>
        </div>
      </header>

      <div className="flex flex-col lg:flex-row flex-1 min-h-0">

        {/* 좌: 입력 */}
        <aside style={{ borderRight: `1px solid ${C.line}`, background: C.ground }} className="w-full lg:w-[320px] shrink-0 p-4 overflow-y-auto">
          <SectionTitle icon={ImageIcon}>캡쳐로 자동 기입</SectionTitle>
          <p style={{ color: C.muted }} className="text-[12.5px] leading-relaxed mb-3">
            날짜·프로젝트·전후 크레딧이 보이는 캡쳐를 올리면 AI가 읽어서 채웁니다. 한 주 치를 이어붙인 배치 캡쳐도 한 번에 여러 건으로 인식해요. 확인하고 기입하세요.
          </p>

          <ApiKeyBox apiKey={apiKey} onSave={saveApiKey} />

          <div
            onClick={() => !captureBusy && captureFileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); handleCaptureFile(e.dataTransfer.files); }}
            style={{ border: `1.5px dashed ${captureBusy ? C.primary : C.line2}` }}
            className="cb-dropzone rounded-[10px] px-3 py-5 flex flex-col items-center justify-center gap-1.5 cursor-pointer text-center"
          >
            {captureBusy ? <Loader2 size={16} className="animate-spin" style={{ color: C.primary }} /> : <Upload size={16} style={{ color: C.dim }} />}
            <span style={{ color: C.muted }} className="text-[11.5px]">{captureBusy ? "읽는 중…" : "캡쳐 올리기 또는 드래그"}</span>
            <input ref={captureFileRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleCaptureFile(e.target.files)} />
          </div>

          {captureErr && (
            <div style={{ background: "rgba(192,120,95,0.12)", border: `1px solid ${C.rust}`, color: C.text }} className="cb-fade-in mt-3 rounded-[10px] px-2.5 py-2.5 text-[12px] flex gap-2 leading-snug">
              <AlertCircle size={13} style={{ color: C.rust }} className="shrink-0 mt-0.5" />{captureErr}
            </div>
          )}

          {captureRows.length > 0 && (
            <div className="cb-fade-in mt-3 rounded-[10px] p-2.5" style={{ background: C.panel }}>
              <div style={{ color: C.dim, fontFamily: MONO }} className="text-[9px] tracking-[0.1em] uppercase mb-2">캡쳐에서 {captureRows.length}건 인식됨 · 아래에서 확인</div>

              <div className="grid grid-cols-2 gap-1.5 mb-2">
                <select value={bulkUser} onChange={(e) => applyBulkUser(e.target.value)} style={selStyle} className="cb-select px-2 py-1.5 rounded-[6px] text-[11.5px] outline-none">
                  {state.users.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
                <input value={bulkGateway} onChange={(e) => applyBulkGateway(e.target.value)} placeholder="게이트웨이" style={selStyle} className="cb-select px-2 py-1.5 rounded-[6px] text-[11.5px] outline-none" />
              </div>
              <p style={{ color: C.dim }} className="text-[10px] leading-snug mb-2">위 사용자/게이트웨이를 바꾸면 아래 모든 항목에 한 번에 적용돼요.</p>

              <div className="max-h-[380px] overflow-y-auto space-y-1.5 -mx-0.5 px-0.5">
                {captureRows.map((r) => (
                  <div key={r.id} style={{ background: C.ground, border: `1px solid ${C.line}` }} className="rounded-[8px] p-2">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <input
                        type="date"
                        value={r.date}
                        onChange={(e) => updateCaptureRow(r.id, { date: e.target.value })}
                        style={{ ...selStyle, fontFamily: MONO }}
                        className="cb-select px-1.5 py-1 rounded-[5px] text-[10.5px] outline-none w-[104px] shrink-0"
                      />
                      <select
                        value={r.project}
                        onChange={(e) => updateCaptureRow(r.id, { project: e.target.value })}
                        style={selStyle}
                        className="cb-select flex-1 min-w-0 px-1.5 py-1 rounded-[5px] text-[10.5px] outline-none"
                      >
                        {state.projects.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                      <button onClick={() => removeCaptureRow(r.id)} aria-label="이 항목 제외" style={{ color: C.dim }} className="cb-ghost p-1 rounded-[4px] shrink-0"><X size={11} /></button>
                    </div>
                    <div className="flex items-center justify-between gap-1.5">
                      <span style={{ color: C.dim, fontFamily: MONO }} className="text-[10px] tabular-nums truncate">
                        {r.before != null && r.after != null ? `${r.before.toLocaleString()} → ${r.after.toLocaleString()}` : ""}
                      </span>
                      <input
                        type="number"
                        value={r.credits ?? ""}
                        onChange={(e) => updateCaptureRow(r.id, { credits: e.target.value === "" ? null : Number(e.target.value) })}
                        placeholder="크레딧"
                        style={{ ...selStyle, fontFamily: MONO, color: r.credits != null ? C.primary : C.text }}
                        className="cb-select w-[92px] px-1.5 py-1 rounded-[5px] text-[11px] font-semibold text-right outline-none shrink-0"
                      />
                    </div>
                    {r.note && <div style={{ color: C.muted }} className="text-[10px] mt-1 leading-snug italic">"{r.note}"</div>}
                  </div>
                ))}
              </div>

              <div className="flex gap-1.5 mt-2.5">
                <button
                  onClick={commitCaptureRows}
                  disabled={!captureRows.some((r) => r.credits != null)}
                  style={{
                    background: captureRows.some((r) => r.credits != null) ? C.primary : C.line,
                    color: captureRows.some((r) => r.credits != null) ? "#fff" : C.dim,
                    boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
                  }}
                  className="cb-primary flex-1 py-2.5 rounded-[9px] text-[12.5px] font-semibold flex items-center justify-center gap-1.5"
                >
                  <Check size={14} />모두 기입 ({captureRows.filter((r) => r.credits != null).length}건)
                </button>
                <button onClick={resetCapture} style={{ border: `1px solid ${C.line}`, color: C.muted }} className="cb-ghost px-3 rounded-[9px] text-[12px]">취소</button>
              </div>
            </div>
          )}

          {/* 수동 입력 */}
          <div className="mt-4">
            {!manual ? (
              <button onClick={() => setManual(true)} style={{ border: `1px solid ${C.line}`, color: C.muted }} className="cb-ghost w-full py-2 rounded-[9px] text-[12px] flex items-center justify-center gap-1.5">
                <Pencil size={12} />수동으로 입력
              </button>
            ) : <ManualForm state={state} project={project} onCancel={() => setManual(false)} onAdd={addManual} />}
          </div>

          <div style={{ borderTop: `1px solid ${C.line}` }} className="mt-5 pt-3 flex items-start gap-2">
            <Database size={12} style={{ color: C.dim }} className="mt-0.5 shrink-0" />
            <p style={{ color: C.muted }} className="text-[12px] leading-relaxed">
              지금은 이 브라우저 안에만 저장됩니다. 팀 공유로 넘길 때 저장 위치만 바꾸면 됩니다 — 화면과 기록 구조는 그대로예요.
            </p>
          </div>
        </aside>

        {/* 우: 대시보드 (모듈식 그리드) */}
        <main className="flex-1 min-w-0 p-4 lg:p-5 overflow-y-auto space-y-5">

          {/* 플랫폼별 사용현황 */}
          <div>
            <SectionTitle icon={PieChartIcon} rank={rankPlatform}>플랫폼별 사용현황</SectionTitle>
            {byGateway.length ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {byGateway.map((g) => (
                  <PlatformRing
                    key={g.name}
                    name={g.name}
                    ledgerCredits={g.credits}
                    override={gatewayOverrideOf(g.name)}
                    onSetOverride={setGatewayOverride}
                    onResetOverride={resetGatewayOverride}
                  />
                ))}
              </div>
            ) : <EmptyChart />}
          </div>

          {/* 프로젝트별 — 전체 프로젝트를 볼 때만 (개별 프로젝트 필터에선 의미 없어서 숨김) */}
          {showProjectChart && (
            <Card className="p-4 lg:p-5">
              <SectionTitle icon={FolderKanban} rank={rankProject}>프로젝트별 크레딧 소모</SectionTitle>
              <p style={{ color: C.muted }} className="text-[11px] -mt-2 mb-3">
                여기도 원크레딧이 아니라 플랫폼 한도 대비 %예요 — 안 그러면 총량이 큰 매그니픽(Magnific)을 쓴 프로젝트가 항상 커 보여서, 힉스필드 위주 프로젝트는 실제보다 작아 보이는 왜곡이 생깁니다. 괄호 안은 참고용 원크레딧 합계와 플랫폼이예요.
              </p>
              {byProject.length ? (
                <div style={{ height: 60 + byProject.length * 46 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={byProject} layout="vertical" margin={{ left: 8, right: 230, top: 4, bottom: 4 }}>
                      <CartesianGrid horizontal={false} stroke={C.line} strokeOpacity={0.6} />
                      <XAxis type="number" tick={{ fill: C.dim, fontSize: 11, fontFamily: MONO }} axisLine={{ stroke: C.line }} tickLine={false} />
                      <YAxis type="category" dataKey="name" width={190} tick={{ fill: C.text, fontSize: 12.5, fontFamily: SANS }} axisLine={false} tickLine={false} />
                      <Tooltip content={<TT unit="%" colorFor={(name) => projectColorOf(name)} />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                      <Bar dataKey="pct" radius={[0, 4, 4, 0]} barSize={22} label={(props) => {
                        const { x, y, width, height, index } = props;
                        const row = byProject[index];
                        if (!row) return null;
                        const parts = Object.entries(row.byGateway)
                          .sort((a, b) => b[1] - a[1])
                          .map(([gw, cr]) => `${cr.toLocaleString()}cr ${gatewayLabel(gw)}`)
                          .join(" + ");
                        return (
                          <text x={x + width + 8} y={y + height / 2 + 5} fontSize={13} fontFamily={MONO} textAnchor="start">
                            <tspan fill={projectColorOf(row.name)} fontWeight={600}>{row.pct}%</tspan>
                            <tspan fill={C.dim}> ({parts})</tspan>
                          </text>
                        );
                      }}>
                        {byProject.map((d, i) => <Cell key={i} fill={projectColorOf(d.name)} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : <EmptyChart />}
            </Card>
          )}

          {/* 기간 추세 */}
          <Card className="p-4 lg:p-5">
            <div className="flex items-center justify-between mb-3.5">
              <SectionTitle icon={TrendingUp} rank={rankTrend}>기간별 추세</SectionTitle>
              <div style={{ background: C.ground, border: `1px solid ${C.line}` }} className="flex gap-0.5 p-0.5 rounded-[9px]">
                {["일", "주", "월"].map((r) => (
                  <button key={r} onClick={() => setRange(r)} style={{ background: range === r ? C.primary : "transparent", color: range === r ? "#fff" : C.muted }} className={"px-2.5 py-1 rounded-[7px] text-[11px] font-medium transition-colors duration-150" + (range === r ? "" : " cb-ghost")}>{r}</button>
                ))}
              </div>
            </div>
            {trend.length ? (
              <div style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trend} margin={{ left: 4, right: 12, top: 4, bottom: 4 }}>
                    <CartesianGrid stroke={C.line} strokeOpacity={0.6} />
                    <XAxis dataKey="t" tick={{ fill: C.dim, fontSize: 10, fontFamily: MONO }} axisLine={{ stroke: C.line }} tickLine={false} />
                    <YAxis tick={{ fill: C.dim, fontSize: 10, fontFamily: MONO }} axisLine={{ stroke: C.line }} tickLine={false} />
                    <Tooltip content={<TT unit="cr" />} />
                    <Line type="monotone" dataKey="credits" name="크레딧" stroke={C.primary} strokeWidth={2} dot={{ fill: C.primary, r: 3 }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : <EmptyChart />}
          </Card>

          {/* 4. 사용자별 사용 현황 — 사용자마다 어느 프로젝트에 얼마나 썼는지 누적 막대로 */}
          <Card className="p-4 lg:p-5">
            <SectionTitle icon={Users} rank={rankUser}>사용자별 사용 현황</SectionTitle>
            <p style={{ color: C.dim }} className="text-[11px] -mt-2 mb-3">
              매그니픽(Magnific)과 힉스필드 크레딧 총량이 달라서 생기는 왜곡을 없애기 위해 플랫폼별 비중으로 변환했습니다. 괄호 안은 참고용 원크레딧 합계예요.
            </p>
            {byUserProject.length ? (
              <>
                <div className="flex flex-wrap gap-x-3 gap-y-1.5 mb-3">
                  {projectsInView.map((p) => (
                    <div key={p} className="flex items-center gap-1.5">
                      <span style={{ background: projectColorOf(p), width: 7, height: 7, borderRadius: 2 }} className="shrink-0" />
                      <span style={{ color: C.muted }} className="text-[11px]">{p}</span>
                    </div>
                  ))}
                </div>
                <div style={{ height: Math.max(180, byUserProject.length * 50) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={byUserProject} layout="vertical" margin={{ left: 8, right: 46, top: 4, bottom: 4 }}>
                      <CartesianGrid horizontal={false} stroke={C.line} strokeOpacity={0.6} />
                      <XAxis type="number" tick={{ fill: C.dim, fontSize: 10, fontFamily: MONO }} axisLine={{ stroke: C.line }} tickLine={false} />
                      <YAxis type="category" dataKey="user" width={70} tick={{ fill: C.text, fontSize: 11.5, fontFamily: SANS }} axisLine={false} tickLine={false} />
                      <Tooltip content={<TT unit="%" />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                      {projectsInView.map((p) => (
                        <Bar key={p} dataKey={p} stackId="u" fill={projectColorOf(p)} stroke={C.panel} strokeWidth={2} barSize={20} />
                      ))}
                      <Bar dataKey="__total" stackId="u" fill="transparent" barSize={20} label={makeStackTotalLabel(byUserProject, true)} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>
            ) : <EmptyChart />}
          </Card>

          {/* 5. 사용자별 플랫폼 사용현황 — 플랫폼마다 총량 스케일이 달라서 한 막대에 안 합치고
              플랫폼별 카드로 나눈다(스몰 멀티플). 한도를 아는 플랫폼은 크레딧 절대값 대신
              "한도 대비 %"로 그린다 — 절대값만 보면 총량이 큰 플랫폼(매그니픽) 쪽 사용자가 항상
              커 보여서, 실제로는 작은 플랫폼(힉스필드)을 더 많이 쓴 사람이 덜 써 보이는
              왜곡이 생긴다. 라벨엔 %와 원크레딧을 같이 표기해 둘 다 확인 가능하게 한다. */}
          <div>
            <SectionTitle icon={Users} rank={rankUserGateway}>사용자별 플랫폼 사용현황</SectionTitle>
            {byGateway.length ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {byGateway.map((g) => {
                  const rows = byUserGateway[g.name] || [];
                  const gc = gatewayColor(g.name);
                  const hasLimit = gatewayLimit(g.name) != null;
                  const dataKey = hasLimit ? "pct" : "credits";
                  const label = (props) => {
                    const { x, y, width, height, index } = props;
                    const row = rows[index];
                    if (!row) return null;
                    return (
                      <text x={x + width + 6} y={y + height / 2 + 4} fontSize={10} fontFamily={MONO} textAnchor="start">
                        <tspan fill={gc}>{hasLimit ? `${row.pct}%` : row.credits.toLocaleString()}</tspan>
                        {hasLimit && <tspan fill={C.dim}> ({row.credits.toLocaleString()}cr)</tspan>}
                      </text>
                    );
                  };
                  return (
                    <Card key={g.name} className="p-4">
                      <div className="flex items-center gap-1.5 mb-3">
                        <span style={{ background: gc, width: 7, height: 7, borderRadius: 2 }} className="shrink-0" />
                        <span style={{ color: C.text, fontFamily: MONO }} className="text-[11.5px] font-medium uppercase tracking-[0.08em]">{gatewayLabel(g.name)}</span>
                        <span style={{ color: C.dim, fontFamily: MONO }} className="text-[9px]">{hasLimit ? "· 한도 대비 %" : "· 한도 미설정"}</span>
                      </div>
                      {rows.length ? (
                        <div style={{ height: Math.max(90, rows.length * 34) }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 64, top: 4, bottom: 4 }}>
                              <CartesianGrid horizontal={false} stroke={C.line} strokeOpacity={0.6} />
                              <XAxis
                                type="number"
                                domain={hasLimit ? [0, (max) => Math.max(100, Math.ceil(max))] : undefined}
                                tickFormatter={hasLimit ? (v) => `${v}%` : undefined}
                                tick={{ fill: C.dim, fontSize: 10, fontFamily: MONO }}
                                axisLine={{ stroke: C.line }}
                                tickLine={false}
                              />
                              <YAxis type="category" dataKey="name" width={70} tick={{ fill: C.text, fontSize: 11, fontFamily: SANS }} axisLine={false} tickLine={false} />
                              <Tooltip content={<TT unit={hasLimit ? "%" : "cr"} colorFor={() => gc} />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                              <Bar dataKey={dataKey} radius={[0, 4, 4, 0]} barSize={16} label={label}>
                                {rows.map((_, i) => <Cell key={i} fill={gc} />)}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      ) : <EmptyChart />}
                    </Card>
                  );
                })}
              </div>
            ) : <EmptyChart />}
          </div>

          {/* 원장 테이블 */}
          <Card className="p-4 lg:p-5">
            <SectionTitle icon={Database}>기입 내역 · {filtered.length}건</SectionTitle>
            <div className="overflow-x-auto">
              <table className="w-full text-[11.5px]" style={{ fontFamily: SANS }}>
                <thead>
                  <tr style={{ color: C.dim, fontFamily: MONO, borderBottom: `1px solid ${C.line}` }} className="text-[9.5px] uppercase tracking-[0.1em]">
                    <th className="text-left font-normal py-2 pr-2">날짜</th>
                    <th className="text-left font-normal py-2 pr-2">프로젝트</th>
                    <th className="text-left font-normal py-2 pr-2">사용자</th>
                    <th className="text-left font-normal py-2 pr-2">게이트웨이</th>
                    <th className="text-right font-normal py-2 pr-2">건수</th>
                    <th className="text-right font-normal py-2 pr-2">크레딧</th>
                    <th className="w-7"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((e) => (
                    <tr key={e.id} style={{ borderBottom: `1px solid ${C.line}` }} className="cb-row group">
                      <td className="py-2 pr-2 tabular-nums" style={{ fontFamily: MONO, color: C.muted }}>{e.ts}</td>
                      <td className="py-2 pr-2" style={{ color: C.muted }}>{e.project}</td>
                      <td className="py-2 pr-2">{e.user}</td>
                      <td className="py-2 pr-2" style={{ fontFamily: MONO, color: gatewayColor(e.gateway) }}>{e.gateway ? gatewayLabel(e.gateway) : "-"}</td>
                      <td className="py-2 pr-2 text-right tabular-nums" style={{ fontFamily: MONO, color: C.muted }}>{e.count || 0}</td>
                      <td className="py-2 pr-2 text-right tabular-nums" style={{ fontFamily: MONO, color: C.primary }}>{(e.credits || 0).toLocaleString()}</td>
                      <td><button onClick={() => removeEntry(e.id)} aria-label="행 삭제" style={{ color: C.dim }} className="cb-ghost opacity-0 group-hover:opacity-100 p-1.5 rounded-[6px]"><Trash2 size={12} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!filtered.length && (
                <div style={{ color: C.dim }} className="text-center py-8 text-[12px]">기입된 내역이 없습니다. 좌측에서 캡쳐를 올리거나 수동으로 입력해보세요.</div>
              )}
            </div>
          </Card>
        </main>
      </div>

      {toast && (
        <div style={{ background: C.panel2, border: `1px solid ${C.primary}`, color: C.text, boxShadow: "0 12px 32px -8px rgba(0,0,0,0.6)" }} className="cb-toast-in fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-[9px] text-[12.5px] z-50 flex items-center gap-2">
          <Check size={14} style={{ color: C.primary }} />{toast}
        </div>
      )}
    </div>
  );
}

/* ── 빈 차트 상태 ─────────────────────────────────────────── */
function EmptyChart() {
  return (
    <div style={{ color: C.dim, border: `1px dashed ${C.line}` }} className="rounded-[10px] py-8 text-center text-[11.5px]">
      아직 데이터가 없습니다.
    </div>
  );
}

/* ── 수동 입력 폼 ─────────────────────────────────────────── */
function ManualForm({ state, project, onCancel, onAdd }) {
  const [row, setRow] = useState({
    ts: new Date().toISOString().slice(0, 10),
    project: project === "전체" ? (state.projects[0] || "") : project,
    user: state.users[0] || "", gateway: "Magnific", count: null, credits: null,
  });
  const set = (k, v) => setRow((r) => ({ ...r, [k]: v }));
  const ok = row.credits != null && row.credits > 0;
  const submit = () => onAdd({ ...row, count: row.count ?? 0, credits: row.credits ?? 0 });
  return (
    <div style={{ background: C.panel }} className="cb-fade-in rounded-[12px] p-3 space-y-1.5">
      <div className="grid grid-cols-2 gap-1.5">
        <select value={row.project} onChange={(e) => set("project", e.target.value)} style={selStyle} className="cb-select px-2 py-1.5 rounded-[6px] text-[11.5px] outline-none">
          {state.projects.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={row.user} onChange={(e) => set("user", e.target.value)} style={selStyle} className="cb-select px-2 py-1.5 rounded-[6px] text-[11.5px] outline-none">
          {state.users.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <select value={row.gateway} onChange={(e) => set("gateway", e.target.value)} style={selStyle} className="cb-select px-2 py-1.5 rounded-[6px] text-[11px] outline-none">
          {GATEWAY_OPTIONS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
        </select>
        <input
          type="number"
          value={row.count ?? ""}
          onChange={(e) => set("count", e.target.value === "" ? null : Number(e.target.value))}
          placeholder="생성 건수(선택)"
          style={{ ...selStyle, fontFamily: MONO }}
          className="cb-select px-2 py-1.5 rounded-[6px] text-[11.5px] outline-none"
        />
        <input
          type="number"
          value={row.credits ?? ""}
          onChange={(e) => set("credits", e.target.value === "" ? null : Number(e.target.value))}
          placeholder="사용 크레딧"
          style={{ ...selStyle, fontFamily: MONO, color: C.primary }}
          className="cb-select px-2 py-1.5 rounded-[6px] text-[11.5px] outline-none"
        />
      </div>
      <input type="date" value={row.ts} onChange={(e) => set("ts", e.target.value)} style={{ ...selStyle, fontFamily: MONO }} className="cb-select w-full px-2 py-1.5 rounded-[6px] text-[11px] outline-none" />
      <div className="flex gap-1.5 pt-0.5">
        <button disabled={!ok} onClick={submit} style={{ background: ok ? C.primary : C.line, color: ok ? "#fff" : C.dim }} className="cb-primary flex-1 py-1.5 rounded-[8px] text-[12px] font-semibold">추가</button>
        <button onClick={onCancel} style={{ border: `1px solid ${C.line}`, color: C.muted }} className="cb-ghost px-3 rounded-[8px] text-[12px]">취소</button>
      </div>
    </div>
  );
}
