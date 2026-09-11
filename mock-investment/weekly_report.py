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
# 가격/수급/공시는 market_data.py 어댑터가 stock-brief 의 검증된 KRX/DART 계층에
# 연결한다(새 API 키 불필요 — 사용자가 준 OPENDART 키 + KRX 로그인 재활용).
# stock-brief venv 파이썬으로 실행할 것. 자세한 전제는 market_data.py 참조.
from market_data import (  # noqa: E402
    fetch_price, fetch_investor_flows, fetch_disclosures, resolve_code,
    fetch_index_levels,
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
    """Claude 종목의 진입가(9/5 종가)와 매수 수량을 확정. 인간측 ETF 코드도 채운다."""
    # 인간측 ETF: code 가 null 인 것을 이름으로 해석해 채운다(재평가에 필요).
    for h in d["human"]["holdings"]:
        if not h.get("code"):
            h["code"] = resolve_code(h["name"])
            if not h["code"]:
                print(f"  [경고] 코드 미해결 인간측 종목: {h['name']}")

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


def signals(d, days=7):
    """Claude 보유 7종목의 수급(외인·기관)+공시 신호를 모아 출력. TRADING-POLICY
    1순위(수급)·4순위(촉매) 신호원. 매매 판단(리밸런싱)은 이 신호를 근거로
    weekly-log.md 에 사람이/LLM 이 기록한다 — 코드가 매매를 자동 집행하지 않는다."""
    print(f"\n=== 🤖 Claude 보유 종목 신호 (최근 {days}일 공시 / 5·20일 수급) ===")
    for p in d["claude"]["picks"]:
        code, name = p["code"], p["name"]
        try:
            fl = fetch_investor_flows(code, name)
            f5, i5 = fl["foreign_net_5d"], fl["inst_net_5d"]
            f20, i20 = fl["foreign_net_20d"], fl["inst_net_20d"]
            flow = (f"외인5d {f5/1e8:+.0f}억·20d {f20/1e8:+.0f}억 / "
                    f"기관5d {i5/1e8:+.0f}억·20d {i20/1e8:+.0f}억")
            dual = "🟢쌍끌이매수" if (f20 > 0 and i20 > 0) else (
                   "🔴쌍끌이매도" if (f20 < 0 and i20 < 0) else "⚪혼조")
        except Exception as e:
            flow, dual = f"수급조회실패({e})", "?"
        try:
            disc = fetch_disclosures(code, name, days=days)
            dtxt = "; ".join(f"{x['date']} {x['title']}" for x in disc[:5]) or "공시없음"
        except Exception as e:
            dtxt = f"공시조회실패({e})"
        print(f"\n  {name}({code}) {dual}")
        print(f"    수급: {flow}")
        print(f"    공시: {dtxt}")


def value_now(holdings, price_key_shares="shares"):
    total = 0
    for h in holdings:
        px = fetch_price(h["code"], h["name"])
        total += h[price_key_shares] * px
    return total


def run_week(d, week, human_value=None, kospi_now=None, spx_now=None):
    seed = d["meta"]["seed_krw"]

    # 인간측: 기본은 보유종목 종가 재평가 + 프로즌 예수금(2026-09-09 정정으로
    # start_value_krw 가 주식+예수금 합산으로 바뀌었으므로, 비교 기준을 맞추려면
    # 예수금을 더해야 한다 — 안 더하면 "주식만 재평가" vs "주식+예수금 출발선"을
    # 비교하는 셈이 되어 수익률이 터무니없이 왜곡된다). 실제 계좌값을 주면 그걸 그대로 사용.
    if human_value is None:
        human_value = value_now(d["human"]["holdings"]) + d["human"].get("cash_start_krw", 0)
    human_pct = round((human_value / d["human"]["start_value_krw"] - 1) * 100, 2)

    # 클로드측: 보유주식 평가 + 잔여현금
    if d["claude"].get("cash_krw") is None:
        sys.exit("먼저 --finalize 로 Claude 진입가를 확정하세요.")
    claude_value = d["claude"]["cash_krw"] + value_now(d["claude"]["picks"])
    claude_pct = round((claude_value / seed - 1) * 100, 2)

    # 벤치마크: 인자로 안 주면 자동 조회(코스피=pykrx, S&P500=yfinance).
    # 시작레벨은 meta의 kospi_start/spx_start.
    if kospi_now is None or spx_now is None:
        lv = fetch_index_levels()
        if kospi_now is None:
            kospi_now = lv["kospi"]
        if spx_now is None:
            spx_now = lv["spx"]

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
    ap.add_argument("--signals", action="store_true", help="보유종목 수급+공시 신호 조회(매매 판단용)")
    ap.add_argument("--human-value", type=int, default=None, help="인간측 실제 계좌 평가금액(원)")
    ap.add_argument("--kospi", type=float, default=None, help="현재 코스피 지수")
    ap.add_argument("--spx", type=float, default=None, help="현재 S&P500 지수")
    args = ap.parse_args()

    d = load()
    if args.finalize:
        finalize(d)
    if args.signals:
        signals(d)
    if args.week is not None:
        run_week(d, args.week, args.human_value, args.kospi, args.spx)
    if not args.finalize and args.week is None and not args.signals:
        ap.print_help()


if __name__ == "__main__":
    main()
