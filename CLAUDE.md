# 여행경비 (trip_hj) — AI 작업 컨텍스트

**구조**: Firebase Hosting `trip-hj.web.app` (프론트, `index_travel.html` 단일 파일) + Firebase Auth (PIN 인증) + Firestore (DB) + GAS/Sheets (백업).
배포는 `git push origin main` → GitHub Actions 자동 배포. 비용 0원.
저장소는 **public** (github.com/bhlee-dev/trip_hj) — 시크릿·ID류는 절대 커밋하지 말 것.

형제 앱: balance_hj(가계부, GitHub Pages), snowball_hj(자산관리, Firebase Hosting). 앱 스위처로 상호 이동.

---

## ⚠️ 절대 건드리지 말 것 (실수 시 앱 즉시 파손)

### Auth 방식 — PIN + "00" suffix
입력 PIN 뒤에 `"00"`을 붙여 Firebase 이메일/비밀번호 인증 수행. 계정: `hj@ledger.com`(희) / `jeong@ledger.com`(정).
balance_hj와 동일 패턴이며 **가계부 내보내기 시 balance 재인증에도 같은 PIN을 사용**하므로, suffix 로직 변경 시 두 앱 모두 깨짐.

### Firestore 컬렉션 3종
`trips` / `trip_exchanges` / `trip_expenses`. 컬렉션명·필드명 변경 금지.
- trips: `{title, startDate, endDate, legs:[{name,currency}], currency, createdAt, exportedAt?, exportedAmount?}`
- trip_exchanges: `{tripId, currency, date, amountLocal, amountKRW, payer, createdAt}`
- trip_expenses: `{tripId, currency, date, category, detail, amountLocal, amountKRW, payer, createdAt}`

### 멀티 구간(나라/통화) 구조 — v3.0 / v3.1
한 여행 세트에 여러 나라(통화)를 기록. 핵심: **통화(currency)가 구간(leg)의 키** — 통화당 1구간.
- `trip.legs` = `[{name:'상하이', currency:'CNY'}, {name:'쿠알라룸푸르', currency:'MYR'}]`. 각 환전/지출 기록은 자신의 `currency`를 가짐.
- **마이그레이션 불필요(하위호환)**: `tripLegs(t)`는 `legs` 없으면 옛 `trip.currency`로 단일 구간 합성. `recCur(rec,t)`는 기록 `currency` 없으면 `trip.currency`로 폴백. 신규 여행은 `legs` + `currency:legs[0].currency`(폴백용) 둘 다 저장.
- **평균환율은 구간별**: `legAvgRate = 해당 통화 Σ amountKRW ÷ Σ amountLocal`. CNY와 MYR을 한 평균에 섞지 않음. 지출 KRW 환산도 구간 환율 사용.
- **KRW 구간 = 한국 사전 결제(항공·숙소 등 출국 전 원화 결제)**: rate 고정 1, 환전 개념 없음, `amountLocal===amountKRW`. 환전 탭 구간 칩에서는 KRW 제외(환전 대상 아님), 지출 탭에는 KRW 포함. **KRW는 방문국이 아님** — 홈/관리 배지(`tripCurBadge`)와 나라 수(`tripCountries`, "N개국")에서 제외. 해외 구간이 없으면 배지는 '국내'.
- UI: 새 여행 폼·수정 시트에 구간 에디터(`mg-legs`/`ed-legs`, 행 추가/삭제). 환전·지출 탭은 여행 선택 아래 **구간 칩 바**로 통화 전환. 기록 있는 구간은 수정 시 통화 변경/삭제 잠금(`_locked`).
- **v3.1 — 카드 목적 = "이 여행에서 KRW로 얼마 썼나(몇박 몇일/어디) 한눈에"**: 트래블월렛 잔액 표시 전면 삭제(`tripStats`에서 `wallet` 필드 제거). 홈 카드 = 총 지출(KRW) + 기간(`tripDuration`, N박N일) + 해외 나라 수. 상세 상단 = 총 지출/총 환전 KRW 카드(sub에 기간·N개국·"한국 사전결제 포함"). 구간별 = 현지지출+환전+가중평균환율(KRW 구간은 '한국 사전 결제' 단일 카드).
- **v3.1 — 상세에서 수정**: 상세 헤더 연필 버튼(`#detail-edit`)→`openEdit('trip', …)`(제목·날짜·구간 수정, 비행기표 구매일로 시작일이 잡힌 경우 날짜 교정 용도). 타임라인 지출 행 탭→`openEdit('expense', id)`. 기록 탭의 목록 탭→수정 로직과 동일 경험. 환전 수정은 기록 탭에서만(상세는 지출 중심).

### GAS 백업 — 토큰 검증 + text/plain
- `gasBackup()`은 `{action, token, data}`를 **`Content-Type: 'text/plain'`**으로 POST (GAS는 application/json 차단)
- GAS `doPost`는 Firebase ID 토큰을 `identitytoolkit accounts:lookup`으로 검증 (공유 시크릿 방식으로 되돌리지 말 것 — public repo라 노출됨)
- **tokeninfo 엔드포인트는 Firebase 토큰 검증 불가** — accounts:lookup 방식 유지
- 백업은 fire-and-forget: 실패해도 앱은 정상 (Firestore가 원본)
- RAW_TRAVEL 시트 `통화` 컬럼은 **맨 끝에 추가**(기존 행 열 정렬 유지). `addExchange`/`addTripExpense`가 `data.currency`를 끝에 append. 컬럼 순서 중간 삽입 금지.

### 가중평균환율 로직 (구간별)
지출의 원화 환산은 `구간(통화)별 Σ amountKRW ÷ Σ amountLocal` (`legAvgRate`). **해당 통화 환전 0건이면 그 통화 지출 저장을 차단**하는 가드가 있음 (sp-save) — 제거하면 KRW=0이 영구 기록되는 버그 재발. 단 **KRW 구간은 rate=1**이라 환전 가드 없이 직접 저장.

### firebaseConfig / BALANCE_CONFIG
클라이언트 노출은 Firebase 표준 — 삭제·변경 금지. `BALANCE_CONFIG`는 가계부 내보내기용 balance-hj 프로젝트 설정이며, 보조 앱은 `window._balApp`으로 메모이즈(`initializeApp(BALANCE_CONFIG,'balance')`) — 중복 초기화 시 duplicate-app 에러.

---

## 배포 절차

| 대상 | 방법 |
|---|---|
| 프론트 | `git push origin main` → GitHub Actions → trip-hj.web.app (1~2분) |
| GAS | `clasp push` → `clasp deploy -i <기존배포ID> -d "설명"` (배포 ID = GAS_URL의 AKfycb... 부분, **URL 유지 필수**) |

- **.claspignore 확인 필수**: sw.js/manifest.json/html/icons가 GAS에 push되면 백엔드 전체가 깨짐 (sw.js의 top-level `self` 참조 — balance에서 실제 발생)
- GAS 수정 전 `clasp pull`로 배포본과 로컬 일치 확인 (과거 불일치 사고)
- 새 OAuth 스코프 추가 시 편집기에서 `authorizeOnce()` 실행·승인 필요 (계정 단위, 사용자만 가능)
- `.clasp.json`은 gitignored — scriptId는 로컬에만

---

## 가계부 내보내기 (balance 연동)

`submitExport()`: balance-hj 보조 앱 + `inMemoryPersistence` + PIN 재인증 → balance `expenses` 컬렉션에 addDoc.
- 기록 형식: `{date, item, category:'여행/숙박', user, amount, memo, createdAt(ISO 문자열)}` — **balance 스키마를 따를 것** (balance_hj/CLAUDE.md 참고)
- user는 `'희'`/`'정'`만 사용 (`'희정'`은 balance 고정비 전용)
- 내보내기 후 trip 문서에 `exportedAt`/`exportedAmount` 기록 — 중복 내보내기 시 버튼 라벨로 안내

---

## UX 원칙

- **항상 다크모드**, CSS 변수 기반 타이포그래피 (balance 디자인 시스템 계승)
- 입력·수정·삭제는 모두 **바텀시트** (openSheet/closeSheet + 스와이프 닫기 initSheetGestures)
- stat 숫자는 카운트업(animateValue)
- 하단 탭 4개: 홈 · 환전 · **지출(중앙 강조 원형 FAB, `.tab-btn-primary`)** · 관리. 사용 빈도(지출 하루 여러 번 > 환전 ≤1회/일 > 홈 개요 > 관리 여행당 1회)에 맞춰 지출을 강조색 원형 버튼으로 띄움(`.tab-primary-fab`, margin-top 음수로 바 위로 돌출). 관리=여행 세트 사전 생성용.

---

## 트러블슈팅

| 증상 | 원인 | 조치 |
|---|---|---|
| 시트 백업이 안 쌓임 | GAS 배포본이 구버전이거나 authorizeOnce 미승인 | `clasp pull`로 배포본 확인, 편집기 실행 로그 확인 |
| 지출 저장이 막힘 | 해당 여행에 환전 기록 0건 | 정상 동작 — 환전 먼저 기록 |
| 내보내기 PIN 오류 | balance와 trip의 PIN은 동일해야 함 | Firebase Console에서 두 프로젝트 비밀번호 확인 |
| 배포가 반영 안 됨 | Actions 실패 또는 캐시 | GitHub Actions 로그 확인, 강력 새로고침 |
