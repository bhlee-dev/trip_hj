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
- trips: `{title, startDate, endDate, currency, createdAt, exportedAt?, exportedAmount?}`
- trip_exchanges: `{tripId, date, amountLocal, amountKRW, payer, createdAt}`
- trip_expenses: `{tripId, date, category, detail, amountLocal, amountKRW, payer, createdAt}`

### GAS 백업 — 토큰 검증 + text/plain
- `gasBackup()`은 `{action, token, data}`를 **`Content-Type: 'text/plain'`**으로 POST (GAS는 application/json 차단)
- GAS `doPost`는 Firebase ID 토큰을 `identitytoolkit accounts:lookup`으로 검증 (공유 시크릿 방식으로 되돌리지 말 것 — public repo라 노출됨)
- **tokeninfo 엔드포인트는 Firebase 토큰 검증 불가** — accounts:lookup 방식 유지
- 백업은 fire-and-forget: 실패해도 앱은 정상 (Firestore가 원본)

### 가중평균환율 로직
지출의 원화 환산은 `여행별 Σ amountKRW ÷ Σ amountLocal`. **환전 0건이면 지출 저장을 차단**하는 가드가 있음 (sp-save) — 제거하면 KRW=0이 영구 기록되는 버그 재발.

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
- FAB 없음 — 하단 탭으로만 이동

---

## 트러블슈팅

| 증상 | 원인 | 조치 |
|---|---|---|
| 시트 백업이 안 쌓임 | GAS 배포본이 구버전이거나 authorizeOnce 미승인 | `clasp pull`로 배포본 확인, 편집기 실행 로그 확인 |
| 지출 저장이 막힘 | 해당 여행에 환전 기록 0건 | 정상 동작 — 환전 먼저 기록 |
| 내보내기 PIN 오류 | balance와 trip의 PIN은 동일해야 함 | Firebase Console에서 두 프로젝트 비밀번호 확인 |
| 배포가 반영 안 됨 | Actions 실패 또는 캐시 | GitHub Actions 로그 확인, 강력 새로고침 |
