#!/usr/bin/env python3
"""
weekly_report.py — 🤖 vs 🧑 모의투자 주간 리포트 러너

이 스크립트는 모든 계산 로직을 담고 있고, "가격 조회" 한 곳(fetch_price)만
거래소 API에 연결하면 완전 자동으로 돈다. (원격/웹 세션은 금융 API egress가
막혀 있으니 데스크탑 로컬 클로드에서 실행할 것 — 거기 API 키가 있다.)

쓰는 법:
  1) fetch_price(code) 안의 TODO를 님 API 호출로 채운다. (한투/공공데이터포털/KRX 등)
  2) 최초 1회:  python weekly_report.py --finalize
       → Claude 7종목의 2026-09-05 종가로 진입가·수량을 확정해 portfolios.json에 기록.
  3) 매주:      python weekly_report.py --week N
       → 양쪽 현재 평가금액·수익률과 벤치마크를 계산해 출력하고,
         portfolios.json의 weekly_results와 README 성적표를 갱신.

가격 소스는 매주 동일하게 유지할 것(일관성). 인간측은 실제 계좌 평가금액을
쓰고 싶으면 --human-value 로 직접 넘길 수 있다(기본은 보유종목 종가 재평가).
"""
import argparse
import json
import math
import os
import sys
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "portfolios.json")
START_DATE = "2026-09-05"


# ─────────────────────────────────────────────────────────────
# 여기 한 곳만 채우면 된다. 거래소 API로 code의 종가/현재가를 반환.
def fetch_price(code, name=None, on_date=None):
    """KRX 종목코드(code)의 가격을 원(KRW)으로 반환.
    on_date=None 이면 최신 종가. on_date="2026-09-05" 처럼 주면 그 날 종가.

    TODO(데스크탑): 아래를 님 API 호출로 교체.
      예) 한국투자증권 OpenAPI: 국내주식 시세 inquire-price / inquire-daily-price
          공공데이터포털 금융위 주식시세정보: getStockPriceInfo (basDt=날짜)
    ETF 이름만 있고 code가 null인 경우(인간측 ETF), 먼저 name->code를 조회해 채운다.
    """
    raise NotImplementedError(
        f"fetch_price 미구현: {name or ''}({code}) — 데스크탑에서 API로 연결하세요."
    )


def fetch_investor_flows(code, name=None, days=20):
    """종목별 투자자별 순매수(외국인/기관)를 반환. TRADING-POLICY.md의 1순위 신호.
    반환 예: {"foreign_net_5d": +12000, "inst_net_5d": +8000,
             "foreign_net_20d": +55000, "inst_net_20d": -3000}  (단위: 주 또는 원, 일관되게)

    TODO(데스크탑): 한국투자증권 OpenAPI(외국인/기관 매매동향) 또는
      KRX 정보데이터시스템 / 공공데이터포털 투자자별 거래실적으로 연결.
    """
    raise NotImplementedError(
        f"fetch_investor_flows 미구현: {name or ''}({code}) — 수급 신호용, 데스크탑에서 API 연결."
    )
# ─────────────────────────────────────────────────────────────


def load():
    with open(DATA, encoding="utf-8") as f:
        return json.load(f)


def save(d):
    with open(DATA, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
        f.write("\n")


def finalize(d):
    """Claude 종목의 진입가(9/5 종가)와 매수 수량을 확정."""
    seed = d["claude"]["seed_krw"]
    spent = 0
    for p in d["claude"]["picks"]:
        if p["start_price"] is None:
            p["start_price"] = fetch_price(p["code"], p["name"], START_DATE)
        # 정수 주 매수(공매도·소수점 없음), 배정금액 한도 내 최대 수량
        p["shares"] = int(p["alloc_krw"] // p["start_price"])
        spent += p["shares"] * p["start_price"]
    d["claude"]["invested_krw"] = spent
    d["claude"]["cash_krw"] = seed - spent
    save(d)
    print(f"[finalize] Claude 진입 확정: 투자 {spent:,}원 / 현금 {seed - spent:,}원")
    for p in d["claude"]["picks"]:
        print(f"  {p['name']:12} {p['shares']:>4}주 @ {p['start_price']:,} = {p['shares']*p['start_price']:,}")


def value_now(holdings, price_key_shares="shares"):
    total = 0
    for h in holdings:
        px = fetch_price(h["code"], h["name"])
        total += h[price_key_shares] * px
    return total


def run_week(d, week, human_value=None, kospi_now=None, spx_now=None):
    seed = d["meta"]["seed_krw"]

    # 인간측: 기본은 보유종목 종가 재평가(프로즌 베이스라인). 실제 계좌값을 주면 그걸 사용.
    if human_value is None:
        human_value = value_now(d["human"]["holdings"])
    human_pct = round((human_value / d["human"]["start_value_krw"] - 1) * 100, 2)

    # 클로드측: 보유주식 평가 + 잔여현금
    if d["claude"].get("cash_krw") is None:
        sys.exit("먼저 --finalize 로 Claude 진입가를 확정하세요.")
    claude_value = d["claude"]["cash_krw"] + value_now(d["claude"]["picks"])
    claude_pct = round((claude_value / seed - 1) * 100, 2)

    # 벤치마크 (지수 레벨을 넘기거나 fetch_price류로 조회). 시작레벨은 meta에 저장.
    def bench_pct(now, key):
        base = d["meta"].get(f"{key}_start")
        if base is None or now is None:
            return None
        return round((now / base - 1) * 100, 2)

    kospi_pct = bench_pct(kospi_now, "kospi")
    spx_pct = bench_pct(spx_now, "spx")

    winner = "🧑" if human_pct > claude_pct else ("🤖" if claude_pct > human_pct else "무승부")
    row = {
        "week": week, "date": date.today().isoformat(),
        "human_pct": human_pct, "claude_pct": claude_pct,
        "kospi_pct": kospi_pct, "spx_pct": spx_pct,
        "human_value": human_value, "claude_value": claude_value,
        "winner": winner,
    }
    d["weekly_results"] = [r for r in d["weekly_results"] if r["week"] != week] + [row]
    d["weekly_results"].sort(key=lambda r: r["week"])
    save(d)

    print(f"\n=== W{week} ({row['date']}) ===")
    print(f"🧑 백지웅 : {human_pct:+.2f}%  (평가 {human_value:,}원)")
    print(f"🤖 Claude : {claude_pct:+.2f}%  (평가 {claude_value:,}원)")
    print(f"코스피    : {kospi_pct}   S&P500: {spx_pct}")
    print(f"이번주 우세: {winner}")
    print("\n→ README.md 성적표와 weekly-log.md도 갱신하고 커밋/푸시하세요.")
    return row


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--finalize", action="store_true", help="Claude 진입가/수량 확정(최초 1회)")
    ap.add_argument("--week", type=int, help="해당 주차 계산")
    ap.add_argument("--human-value", type=int, default=None, help="인간측 실제 계좌 평가금액(원)")
    ap.add_argument("--kospi", type=float, default=None, help="현재 코스피 지수")
    ap.add_argument("--spx", type=float, default=None, help="현재 S&P500 지수")
    args = ap.parse_args()

    d = load()
    if args.finalize:
        finalize(d)
    if args.week is not None:
        run_week(d, args.week, args.human_value, args.kospi, args.spx)
    if not args.finalize and args.week is None:
        ap.print_help()


if __name__ == "__main__":
    main()
