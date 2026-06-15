# 여행경비 (trip_hj) — 부부 여행경비 관리 웹앱

해외여행 중 **환전 → 지출 → 정산**을 한 곳에서 관리하는 모바일 웹앱.
트래블월렛처럼 수시로 환전하는 패턴에 맞춰 **가중평균환율**로 지출의 원화 가치를 자동 환산한다.
외부 서버 없이 Firebase 무료 티어로 운영 — 비용 0원.

**앱 주소**: https://trip-hj.web.app (v3.3)

---

## 아키텍처

```
[index_travel.html (단일 파일 SPA)]
        │
        ├── Firebase Auth ── PIN+"00" 이메일/비밀번호 인증 (hj@/jeong@ledger.com)
        ├── Firestore ────── trips / trip_exchanges / trip_expenses (원본 데이터)
        ├── GAS 백업 ─────── 신규 기록 시 Google Sheets(RAW_TRAVEL)에 fire-and-forget 백업
        └── balance 연동 ─── 여행 종료 후 가계부(balance-hj) Firestore로 총액 내보내기
```

| 구성 요소 | 내용 |
|---|---|
| 호스팅 | Firebase Hosting `trip-hj.web.app` — **main 푸시 시 GitHub Actions 자동 배포** |
| 인증 | Firebase Auth, PIN 4자리 + `"00"` suffix (balance와 동일 패턴) |
| DB | Firestore 3컬렉션 (아래 스키마 참고) |
| 백업 | Google Apps Script 웹앱 → Google Sheets `RAW_TRAVEL` 시트 |
| PWA | manifest + service worker + 홈화면 아이콘(✈), 오프라인 셸 캐싱 |
| 저장소 | github.com/bhlee-dev/trip_hj (**public** — 시크릿은 절대 커밋 금지) |

---

## 주요 기능

- **여행 관리**: 여행 생성(이름·기간·**멀티 구간/나라·통화**), 수정, 삭제(환전/지출 연쇄 삭제 — writeBatch 원자 처리)
  - **멀티 구간(통화당 1구간)**: 한 여행에 여러 나라(예: 상하이 CNY + 쿠알라룸푸르 MYR)를 기록. 평균환율은 구간별로 계산. KRW 구간은 한국 사전결제(항공·숙소 등) 전용.
- **환전 기록**: 현지화폐 금액 + 지불 원화 기록 → 구간별 가중평균환율 자동 계산
- **지출 기록**: 카테고리·세부항목·현지금액 입력 → 구간 평균환율로 원화 자동 환산
  - 해당 통화 환전 내역이 없으면 지출 저장 차단 (KRW=0 영구 기록 방지). 단 KRW 구간은 rate=1로 직접 저장.
- **공동지출**: trip의 모든 지출은 공동지출로 취급 — 결제자(희/정) 구분을 UI에 노출하지 않음 (데이터 구조상 `payer`는 유지).
- **수정**: 목록 항목 탭 또는 상세 타임라인 탭 → 바텀시트에서 환전/지출/여행 수정
- **상세 화면**: 총지출/총환전(KRW) stat 카운트업, 기간(N박N일)·해외 N개국, 구간별·카테고리별 집계
  - **일자별 지출 필터·정렬**: 카테고리 다중 필터 + 정렬(최신/오래된/금액↑↓) 바텀시트
- **가계부 내보내기**: 여행 총액을 balance(가계부) 앱의 `expenses` 컬렉션에 `여행/숙박` 카테고리로 기록 (PIN 재인증 필요)
- **UX**: 바텀시트 모션 + 스와이프 닫기, **상세 화면 왼쪽→오른쪽 스와이프/네이티브 제스처로 뒤로가기**, iOS safe-area 대응, 다크모드 고정

---

## Firestore 스키마

### trips
```json
{ "title": "오사카", "startDate": "2026-07-01", "endDate": "2026-07-05",
  "legs": [{ "name": "오사카", "currency": "JPY" }],
  "currency": "JPY", "createdAt": "...", "exportedAt": "...", "exportedAmount": 850000 }
```
- `legs`: 멀티 구간(나라/통화) 배열 — 통화당 1구간. `currency`는 폴백용(legs[0].currency). 옛 문서는 `legs` 없이 `currency`만 있어도 하위호환(`tripLegs()`가 단일 구간 합성).
- `exportedAt`/`exportedAmount`는 가계부 내보내기 후에만 존재.

### trip_exchanges (환전)
```json
{ "tripId": "...", "currency": "JPY", "date": "2026-07-01", "amountLocal": 10000,
  "amountKRW": 92000, "payer": "희", "createdAt": "..." }
```

### trip_expenses (지출)
```json
{ "tripId": "...", "currency": "JPY", "date": "2026-07-02", "category": "식비", "detail": "라멘",
  "amountLocal": 1200, "amountKRW": 11040, "payer": "정", "createdAt": "..." }
```

- `currency`: 기록이 속한 구간(통화). 없으면 `trip.currency`로 폴백(`recCur()`).
- `payer`: 로그인한 사람으로 저장되지만 **trip은 공동지출이라 UI에 표시하지 않는다**(백업·내보내기 호환용 메타데이터). 형제 앱 balance/snowball은 희/정 구분을 유지.

**가중평균환율** = Σ`amountKRW` ÷ Σ`amountLocal` (**구간(통화)별**). CNY·MYR을 한 평균에 섞지 않음.
지출의 `amountKRW`는 입력 시점의 구간 평균환율로 환산되어 저장된다.

### Google Sheets 백업 (RAW_TRAVEL)
| 날짜 | 여행명 | 구분 | 카테고리 | 세부항목 | 현지금액 | 원화금액 | 결제자 | 기록시각 | docId | 통화 |
|---|---|---|---|---|---|---|---|---|---|---|

`통화` 컬럼은 **맨 끝에 추가**(기존 행 정렬 유지). 중간 삽입 금지.

신규 추가(addDoc)만 백업되며 수정/삭제는 반영되지 않는다. Firestore가 원본(source of truth).

---

## 배포

### 프론트엔드 (자동)
```bash
git push origin main   # GitHub Actions가 trip-hj.web.app에 자동 배포 (1~2분)
```

### GAS 백엔드 (clasp)
```bash
clasp push                              # Code.gs + appsscript.json 업로드 (.claspignore 적용)
clasp deploy -i <기존_배포ID> -d "설명"   # 기존 배포 ID 유지 — URL이 바뀌면 안 됨
```
- 배포 ID는 `index_travel.html`의 `GAS_URL` 경로에 들어있는 `AKfycb...` 문자열
- 새 OAuth 스코프 추가 시: GAS 편집기에서 `authorizeOnce()` 실행 → 권한 승인 (1회)
- Spreadsheet ID는 GAS Script Properties에만 저장 (repo에 없음) — 초기 설정은 `setupSpreadsheetId()` 참고

---

## 보안 모델

- **GAS 요청 검증**: 프론트가 Firebase ID 토큰을 보내면 GAS가 `identitytoolkit accounts:lookup`으로 검증 후 허용 이메일(hj@/jeong@ledger.com)만 통과. 공유 시크릿 없음 — public repo에 안전.
- **Firestore Rules**: 허용된 2개 계정만 읽기/쓰기 (`firestore.rules`)
- **firebaseConfig의 apiKey**: 클라이언트 공개가 Firebase 표준 — 노출 자체는 문제없음
- **gitignore**: `.clasp.json`(scriptId) 커밋 금지

---

## 폰 설치 (PWA)

- **아이폰**: Safari에서 접속 → 공유(□↑) → "홈 화면에 추가"
- **안드로이드**: Chrome 메뉴(⋮) → "홈 화면에 추가"
