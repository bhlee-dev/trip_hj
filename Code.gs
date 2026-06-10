// ====================================================
// 여행경비 (trip_hj) — Google Apps Script 백엔드
// 역할: Firestore 데이터를 Google Sheets RAW_TRAVEL 시트에 텍스트 백업
// 인증: Firebase ID 토큰 검증 (identitytoolkit accounts:lookup)
// ====================================================

const RAW_TRAVEL = 'RAW_TRAVEL';
const FIREBASE_API_KEY = 'AIzaSyD_yoo89cFXvXVY0PbpXk6_0I6LRRj5L20'; // trip-hj 웹 API 키 (공개값)
const ALLOWED_EMAILS = ['hj@ledger.com', 'jeong@ledger.com'];

// ────────────────────────────────────────────────
// 최초 1회 설정 — GAS 편집기에서 직접 실행
// ────────────────────────────────────────────────

function setupSpreadsheetId() {
  // 아래 값을 실제 Google 스프레드시트 ID로 교체 후 실행
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', 'YOUR_SPREADSHEET_ID');
  Logger.log('SPREADSHEET_ID 저장 완료');
}

// 새 OAuth 권한(외부 요청) 승인용 — GAS 편집기에서 1회 실행하고 권한 허용
function authorizeOnce() {
  const res = UrlFetchApp.fetch('https://www.google.com', { muteHttpExceptions: true });
  Logger.log('외부 요청 권한 OK: ' + res.getResponseCode());
  Logger.log('SPREADSHEET_ID: ' + (getSpreadsheetId() ? '설정됨' : '미설정'));
}

// ────────────────────────────────────────────────
// 내부 유틸
// ────────────────────────────────────────────────

function getSpreadsheetId() {
  return PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '';
}

function verifyFirebaseToken(idToken) {
  if (!idToken || typeof idToken !== 'string') return false;
  try {
    const res = UrlFetchApp.fetch(
      'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_API_KEY,
      {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({ idToken: idToken }),
        muteHttpExceptions: true
      }
    );
    if (res.getResponseCode() !== 200) return false;
    const data = JSON.parse(res.getContentText());
    const email = data.users && data.users[0] && data.users[0].email;
    return ALLOWED_EMAILS.indexOf(email) !== -1;
  } catch (err) {
    return false;
  }
}

function getOrCreateSheet(name) {
  const ss = SpreadsheetApp.openById(getSpreadsheetId());
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(['날짜', '여행명', '구분', '카테고리', '세부항목', '현지금액', '원화금액', '결제자', '기록시각', 'docId']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function sanitize(s, maxLen) {
  if (typeof s !== 'string') return '';
  return s.trim().slice(0, maxLen || 100);
}

// ────────────────────────────────────────────────
// POST 진입점 (index_travel.html에서 Content-Type: text/plain 으로 호출)
// ────────────────────────────────────────────────

function doPost(e) {
  let payload;
  try { payload = JSON.parse(e.postData.contents); }
  catch (err) { return jsonResponse({ success: false, error: '요청 파싱 실패' }); }

  if (!verifyFirebaseToken(payload.token)) {
    return jsonResponse({ success: false, error: '인증 실패' });
  }

  const action = payload.action || '';
  const data   = payload.data   || {};

  try {
    if (action === 'addExchange')    return jsonResponse(addExchange(data));
    if (action === 'addTripExpense') return jsonResponse(addTripExpense(data));
    return jsonResponse({ success: false, error: '알 수 없는 액션: ' + action });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

function doGet() {
  return ContentService.createTextOutput('trip_hj GAS 백엔드 — POST 전용');
}

// ────────────────────────────────────────────────
// 환전 내역 백업
// data: { tripTitle, date, amountLocal, amountKRW, payer, docId }
// ────────────────────────────────────────────────

function addExchange(data) {
  const sheet = getOrCreateSheet(RAW_TRAVEL);

  const date        = sanitize(data.date || '', 10);
  const tripTitle   = sanitize(data.tripTitle || '', 40);
  const amountLocal = parseFloat(data.amountLocal) || 0;
  const amountKRW   = parseInt(data.amountKRW, 10) || 0;
  const payer       = sanitize(data.payer || '', 10);
  const docId       = sanitize(data.docId || '', 100);

  sheet.appendRow([
    date, tripTitle, '환전', '-', '-',
    amountLocal, amountKRW, payer,
    new Date().toISOString(), docId
  ]);

  return { success: true };
}

// ────────────────────────────────────────────────
// 지출 내역 백업
// data: { tripTitle, date, category, detail, amountLocal, amountKRW, payer, docId }
// ────────────────────────────────────────────────

function addTripExpense(data) {
  const sheet = getOrCreateSheet(RAW_TRAVEL);

  const date        = sanitize(data.date     || '', 10);
  const tripTitle   = sanitize(data.tripTitle|| '', 40);
  const category    = sanitize(data.category || '', 10);
  const detail      = sanitize(data.detail   || '', 50);
  const amountLocal = parseFloat(data.amountLocal) || 0;
  const amountKRW   = parseInt(data.amountKRW, 10) || 0;
  const payer       = sanitize(data.payer    || '', 10);
  const docId       = sanitize(data.docId    || '', 100);

  sheet.appendRow([
    date, tripTitle, '지출', category, detail,
    amountLocal, amountKRW, payer,
    new Date().toISOString(), docId
  ]);

  return { success: true };
}
