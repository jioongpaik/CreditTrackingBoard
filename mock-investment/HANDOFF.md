# 📋 인수인계 — 데스크탑 로컬 Claude에게

이 모의투자 실험은 **데스크탑 로컬 Claude**에서 실행하기로 정해졌다.
이유: 원격/웹 세션은 금융 API egress가 막혀 있고(구글·네이버·다음·공공데이터포털·한투·KRX 전부 403),
데스크탑에는 **거래소 API 키와 인터넷 연결**이 있다.

## 배경 (무엇을 하는가)
백지웅 님(사람) vs Claude(AI)의 **국내주식 전용 모의투자 대결**. 같은 시드(₩22,279,060),
같은 출발선(2026-09-05 종가). 매주 수익률을 비교한다. **이건 테스트이며, 실제 투자 판단에 쓰지 않는다.**

- 전체 규칙·포트폴리오·근거: [`README.md`](./README.md)
- 기계가 읽는 데이터: [`portfolios.json`](./portfolios.json)  ← 계산의 단일 원천(single source of truth)
- 실행 스크립트: [`weekly_report.py`](./weekly_report.py)  ← 계산 로직 완비, **가격/수급 조회만 API 연결**
- 트레이딩 정책: [`TRADING-POLICY.md`](./TRADING-POLICY.md)  ← 수급 기반 리밸런싱 규칙(집행 기준)
- 주차별 로그: [`weekly-log.md`](./weekly-log.md)

## 데스크탑에서 할 일 (순서대로)

### 0) 보안
- API 키/시크릿은 **절대 레포에 커밋하지 말 것.** 환경변수나 로컬 설정으로만 다룬다.
- `.gitignore`에 키 파일 경로를 넣는다.

### 1) `weekly_report.py`의 `fetch_price(code)` 를 API로 연결
- KRX 종목코드 → 종가/현재가(원) 반환. `on_date="2026-09-05"`면 그 날 종가.
- 한국투자증권 OpenAPI(국내주식 시세) 또는 공공데이터포털 금융위 주식시세정보(getStockPriceInfo, basDt) 등 님이 가진 API 사용.
- 인간측 ETF는 `code`가 `null`이다 → 이름으로 종목코드를 먼저 조회해 `portfolios.json`에 채운다.
  (인간측 ETF 이름 목록: TIGER 반도체TOP10 / SOL 코리아밸류업TR / SOL 조선TOP3플러스 / ACE 원자력TOP10 /
   PLUS K방산 / TIGER 2차전지TOP10 / KODEX 로봇액티브 / KoAct 배당성장액티브 / SOL 한국원자력SMR)

### 2) W0 확정 (최초 1회)
```
python weekly_report.py --finalize
```
- Claude 7종목의 2026-09-05 종가로 진입가·수량을 확정(정수 주 매수, 잔여현금 기록).
- 두산에너빌리티는 이미 89,300원(님 계좌값)으로 확정돼 있음 — API값과 대조해 검증만.
- 벤치마크 시작레벨: `portfolios.json`의 `meta`에 `kospi_start`, `spx_start`(2026-09-05 종가)를 추가.
- 확정 후 `README.md` §3 표의 "확정대기"를 실제 진입가·수량으로 채우고 커밋.

### 3) 매주 (금요일 종가 이후 권장)
```
python weekly_report.py --week 1        # 보유종목 종가로 인간측도 재평가
# 또는 님 실제 계좌 평가금액을 직접:
python weekly_report.py --week 1 --human-value 22750000 --kospi 3210.5 --spx 5980.2
```
- 인간측: 기본은 보유종목 종가 재평가(프로즌 베이스라인). 백지웅 님이 실제 계좌를 능동매매하면
  `--human-value`로 실제 평가금액을 넣어 "진짜 백지웅"과 겨루는 게 더 공정하다. (님께 물어볼 것.)
- 스크립트가 `portfolios.json`의 `weekly_results`를 갱신 → 그 값으로 `README.md` §4 성적표와
  `weekly-log.md`에 그 주 해설(무엇이 오르고 내렸나, 승패 이유)을 한글로 추가.

### 4) 커밋/푸시 (같은 브랜치)
- 브랜치: `claude/mock-investment-weekly-report-htilza` (기록을 여기 한 곳에 모은다).
- PR은 사용자가 명시적으로 요청할 때만.

## 공정성 규칙 (반드시 지킬 것)
- Claude 종목·비중은 **2026-09-07에 락**됨. 과거 결정을 미래 정보로 바꾸지 않는다.
- 리밸런싱을 하면 **하는 시점에** `weekly-log.md`에 근거와 함께 기록(후견지명 금지).
- 국내주식만. 가격 소스는 매주 동일하게.

## 향후 (사용자 최종 목표)
사용자의 궁극 목표는 "에이전트가 실제 시드를 주식으로 운용". 이 실험은 그 전 단계 검증이다.
데이터·로직을 `portfolios.json`+`weekly_report.py`로 구조화해둔 이유 = 나중에 자동매매 에이전트로
확장하기 쉽게. 단, **현재는 테스트일 뿐 실제 투자 판단에 쓰지 않는다.**
