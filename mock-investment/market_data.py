"""거래소·공시 데이터 어댑터 — 🤖 vs 🧑 모의투자용.

이 데스크탑에는 이미 검증된 국내 데이터 수집 계층(`stock-brief/briefkit`)이 있다.
KRX 로그인 로그 유출 방지(pykrx_gate), ETF 0행 함정 회피, DART corp_code zip
캐싱까지 그 프로젝트가 다 풀어놨으므로, 여기서 재구현하지 않고 그대로 재활용한다.

전제:
  - 이 스크립트는 stock-brief 의 venv 파이썬으로 실행해야 한다(pykrx 가 거기 설치됨).
  - KRX_ID/KRX_PW/OPENDART_API_KEY 는 stock-brief/.env 에서 읽는다(레포에 없음).
  - stock-brief 위치는 STOCK_BRIEF_PATH 환경변수로 바꿀 수 있다(기본: 옆 디렉터리).

새 API 키를 발급할 필요 없이, 사용자가 예전에 준 공시 API(OPENDART)와 KRX
로그인을 그대로 쓴다."""
import datetime
import os
import sys

_DEFAULT_STOCK_BRIEF = r"C:\Users\user\Documents\stock-brief"


def _stock_brief_root() -> str:
    root = os.environ.get("STOCK_BRIEF_PATH", _DEFAULT_STOCK_BRIEF)
    if not os.path.isdir(root):
        raise RuntimeError(
            f"stock-brief 를 찾을 수 없습니다: {root}\n"
            "STOCK_BRIEF_PATH 환경변수로 실제 경로를 지정하세요. 이 모듈은 그 "
            "프로젝트의 검증된 briefkit(KRX/DART) 계층을 재활용합니다."
        )
    return root


_ROOT = _stock_brief_root()
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from briefkit.config import load_env, load_api_key  # noqa: E402
from briefkit.pykrx_gate import require_krx_credentials, pykrx_stock  # noqa: E402
from briefkit import news as _news  # noqa: E402

# stock-brief/.env 의 KRX_ID/KRX_PW/OPENDART_API_KEY 를 os.environ 에 반영.
_ENV_PATH = os.path.join(_ROOT, ".env")
load_env(_ENV_PATH)

# 인간측 ETF 이름 → KRX 코드 (stock-brief/holdings.yaml 과 대조 확정).
HUMAN_ETF_CODES = {
    "SOL 한국원자력SMR": "0092B0",
    "TIGER 2차전지TOP10": "364980",
    "TIGER 반도체TOP10": "396500",
    "ACE 원자력TOP10": "433500",
    "KODEX 로봇액티브": "445290",
    "PLUS K방산": "449450",
    "SOL 조선TOP3플러스": "466920",
    "KoAct 배당성장액티브": "476850",
    "SOL 코리아밸류업TR": "495550",
}


def _ymd(on_date=None) -> str:
    if on_date is None:
        return datetime.date.today().strftime("%Y%m%d")
    return on_date.replace("-", "")


def resolve_code(name: str) -> "str | None":
    """이름만 있는 인간측 ETF 의 코드를 채운다. 매핑에 없으면 None."""
    return HUMAN_ETF_CODES.get(name)


def fetch_price(code, name=None, on_date=None) -> int:
    """KRX 종목/ETF 코드의 종가(원, 정수). on_date(YYYY-MM-DD)면 그 날(또는
    그 이전 마지막 거래일) 종가. 조회 실패면 RuntimeError — 값을 지어내지 않는다."""
    if not code and name:
        code = resolve_code(name)
    if not code:
        raise RuntimeError(f"종목코드 없음: {name!r} — HUMAN_ETF_CODES 에 매핑을 추가하세요.")
    todate = _ymd(on_date)
    fromdate = (datetime.datetime.strptime(todate, "%Y%m%d")
                - datetime.timedelta(days=14)).strftime("%Y%m%d")
    with pykrx_stock() as stock:
        df = stock.get_market_ohlcv_by_date(fromdate, todate, code)
    if df is None or df.empty or "종가" not in df.columns:
        raise RuntimeError(f"가격 조회 실패: {name or ''}({code}) {fromdate}~{todate}")
    closes = [c for c in df["종가"].tolist() if c == c and c > 0]
    if not closes:
        raise RuntimeError(f"유효 종가 없음: {name or ''}({code}) {fromdate}~{todate}")
    return int(round(closes[-1]))


def fetch_investor_flows(code, name=None, days=20) -> dict:
    """외국인·기관 순매수(거래대금 기준, 원). 5일/20일 누적. TRADING-POLICY 1순위.
    반환: {foreign_net_5d, inst_net_5d, foreign_net_20d, inst_net_20d}."""
    if not code and name:
        code = resolve_code(name)
    if not code:
        raise RuntimeError(f"종목코드 없음: {name!r}")
    require_krx_credentials()
    todate = _ymd()
    fromdate = (datetime.date.today() - datetime.timedelta(days=45)).strftime("%Y%m%d")
    with pykrx_stock() as stock:
        df = stock.get_market_trading_value_by_date(fromdate, todate, code)
    if df is None or df.empty or "외국인합계" not in df.columns:
        raise RuntimeError(f"수급 조회 실패: {name or ''}({code})")
    foreign = df["외국인합계"].tolist()
    inst = df["기관합계"].tolist()
    return {
        "foreign_net_5d": int(sum(foreign[-5:])),
        "inst_net_5d": int(sum(inst[-5:])),
        "foreign_net_20d": int(sum(foreign[-20:])),
        "inst_net_20d": int(sum(inst[-20:])),
        "as_of": str(df.index[-1].date()) if hasattr(df.index[-1], "date") else str(df.index[-1]),
    }


def fetch_index_levels() -> dict:
    """벤치마크 현재 지수레벨: 코스피(pykrx 지수 1001), S&P500(yfinance ^GSPC).
    한쪽 조회가 실패해도 예외를 던지지 않고 그 값만 None(성적표에서 그
    벤치마크만 '—'). 주간 루틴이 --kospi/--spx 없이도 자동으로 채우게 한다."""
    out = {"kospi": None, "spx": None}
    try:
        require_krx_credentials()
        todate = _ymd()
        fromdate = (datetime.date.today() - datetime.timedelta(days=10)).strftime("%Y%m%d")
        with pykrx_stock() as stock:
            df = stock.get_index_ohlcv_by_date(fromdate, todate, "1001")
        vals = [c for c in df["종가"].tolist() if c == c] if df is not None and not df.empty else []
        if vals:
            out["kospi"] = round(float(vals[-1]), 2)
    except Exception:
        pass
    try:
        import yfinance as yf
        h = yf.Ticker("^GSPC").history(period="10d")
        cl = [c for c in h["Close"].tolist() if c == c]
        if cl:
            out["spx"] = round(float(cl[-1]), 2)
    except Exception:
        pass
    return out


def fetch_disclosures(code, name=None, days=7) -> list:
    """최근 `days` 일간 DART 공시 목록. TRADING-POLICY 4순위(촉매) 신호원.
    반환: [{date, title, url}, ...]. ETF 처럼 공시 주체가 아니면 [](corp_code
    없음)로 조용히 비운다 — 그 자체는 실패가 아니다. 진짜 조회 실패는 예외."""
    if not code and name:
        code = resolve_code(name)
    if not code:
        return []
    api_key = os.environ.get("OPENDART_API_KEY") or load_api_key(_ENV_PATH)
    if not api_key:
        raise RuntimeError("OPENDART_API_KEY 미설정 — stock-brief/.env 확인.")
    corp = _news.load_corp_codes(api_key)
    end = datetime.date.today()
    bgn = end - datetime.timedelta(days=days)
    try:
        return _news.fetch_disclosures(
            corp["mapping"], code, api_key,
            bgn.strftime("%Y%m%d"), end.strftime("%Y%m%d"))
    except LookupError:
        # corp_code 없음 = ETF/펀드 등 공시 주체 아님 → 신호 없음으로 처리.
        return []
