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
    sheet.appendRow(['날짜', '여행명', '구분', '카테고리', '세부항목', '현지금액', '원화금액', '결제자', '기록시각', 'docId', '통화']);
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
    if (action === 'smartSyncTravel') return jsonResponse(smartSyncTravel(payload));
    return jsonResponse({ success: false, error: '알 수 없는 액션: ' + action });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  const action = p.action || '';
  if (action === 'getAllTravelRows') {
    if (!verifyFirebaseToken(p.token)) return jsonResponse({ success: false, error: '인증 실패' });
    return jsonResponse(getAllTravelRows());
  }
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
  const currency    = sanitize(data.currency || '', 10);
  const amountLocal = parseFloat(data.amountLocal) || 0;
  const amountKRW   = parseInt(data.amountKRW, 10) || 0;
  const payer       = sanitize(data.payer || '', 10);
  const docId       = sanitize(data.docId || '', 100);

  sheet.appendRow([
    date, tripTitle, '환전', '-', '-',
    amountLocal, amountKRW, payer,
    new Date().toISOString(), docId, currency
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
  const currency    = sanitize(data.currency || '', 10);
  const category    = sanitize(data.category || '', 10);
  const detail      = sanitize(data.detail   || '', 50);
  const amountLocal = parseFloat(data.amountLocal) || 0;
  const amountKRW   = parseInt(data.amountKRW, 10) || 0;
  const payer       = sanitize(data.payer    || '', 10);
  const docId       = sanitize(data.docId    || '', 100);

  sheet.appendRow([
    date, tripTitle, '지출', category, detail,
    amountLocal, amountKRW, payer,
    new Date().toISOString(), docId, currency
  ]);

  return { success: true };
}

// ────────────────────────────────────────────────
// 스마트 동기화 — 시트 전체 조회 (진단용, 캐시 없음)
// RAW_TRAVEL 11열: 날짜 여행명 구분 카테고리 세부항목 현지금액 원화금액 결제자 기록시각 docId 통화
// ────────────────────────────────────────────────

function getAllTravelRows() {
  try {
    const sheet = getOrCreateSheet(RAW_TRAVEL);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: true, data: [] };

    const values = sheet.getRange(2, 1, lastRow - 1, 11).getValues();
    const data = [];
    values.forEach(function(row) {
      const dateVal = row[0];
      if (!dateVal) return;
      const dateStr = typeof dateVal === 'string' ? dateVal
        : Utilities.formatDate(new Date(dateVal), 'Asia/Seoul', 'yyyy-MM-dd');
      data.push({
        date:        dateStr,
        tripTitle:   String(row[1] || ''),
        type:        String(row[2] || ''),
        category:    String(row[3] || ''),
        detail:      String(row[4] || ''),
        amountLocal: Number(row[5]) || 0,
        amountKRW:   Number(row[6]) || 0,
        payer:       String(row[7] || ''),
        createdAt:   String(row[8] || ''),
        docId:       String(row[9] || ''),
        currency:    String(row[10] || '')
      });
    });
    return { success: true, data: data };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ────────────────────────────────────────────────
// 스마트 동기화 — Firestore 기준으로 시트를 일괄 추가/수정/삭제
// payload: { toAdd:[{docId,type,date,tripTitle,category,detail,amountLocal,amountKRW,payer,currency,createdAt}],
//            toUpdate:[{docId,data:{…}}], toDelete:[{docId}], deleteOrphans:bool }
// 시트(백업)만 변경 — Firestore는 건드리지 않음
// ────────────────────────────────────────────────

function smartSyncTravel(payload) {
  try {
    const sheet = getOrCreateSheet(RAW_TRAVEL);
    const toAdd = payload.toAdd || [];
    const toUpdate = payload.toUpdate || [];
    const toDelete = payload.toDelete || [];
    let added = 0, updated = 0, deleted = 0;

    // docId(J=10열) → 행 번호 맵 + docId 없는 행(구버전 잔재) 수집
    const idMap = {};
    const orphanRows = [];
    const lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      const ids = sheet.getRange(2, 10, lastRow - 1, 1).getValues();
      for (let i = 0; i < ids.length; i++) {
        if (ids[i][0]) idMap[String(ids[i][0])] = i + 2;
        else orphanRows.push(i + 2);
      }
    }

    // 수정 (행 번호 유지 단계에서 먼저). A~H 8열 + K열(통화). I기록시각·J docId 보존
    toUpdate.forEach(function(u) {
      const row = idMap[String(u.docId)];
      if (!row || !u.data) return;
      const d = u.data;
      const isEx = String(d.type) === '환전';
      sheet.getRange(row, 1, 1, 8).setValues([[
        sanitize(String(d.date || ''), 10),
        sanitize(String(d.tripTitle || ''), 40),
        isEx ? '환전' : '지출',
        isEx ? '-' : sanitize(String(d.category || ''), 10),
        isEx ? '-' : sanitize(String(d.detail || ''), 50),
        parseFloat(d.amountLocal) || 0,
        parseInt(d.amountKRW, 10) || 0,
        sanitize(String(d.payer || ''), 10)
      ]]);
      sheet.getRange(row, 11).setValue(sanitize(String(d.currency || ''), 10));
      updated++;
    });

    // 삭제 (아래 행부터 — 행 밀림 방지). deleteOrphans면 docId 없는 행도 삭제(대응 데이터는 toAdd가 다시 추가)
    let delRows = toDelete
      .map(function(t) { return idMap[String(t.docId)]; })
      .filter(function(r) { return r; });
    if (payload.deleteOrphans) delRows = delRows.concat(orphanRows);
    delRows.sort(function(a, b) { return b - a; });
    delRows.forEach(function(r) { sheet.deleteRow(r); deleted++; });

    // 추가 (11열 — addExchange/addTripExpense와 동일 포맷)
    toAdd.forEach(function(item) {
      const isEx = String(item.type) === '환전';
      sheet.appendRow([
        sanitize(String(item.date || ''), 10),
        sanitize(String(item.tripTitle || ''), 40),
        isEx ? '환전' : '지출',
        isEx ? '-' : sanitize(String(item.category || ''), 10),
        isEx ? '-' : sanitize(String(item.detail || ''), 50),
        parseFloat(item.amountLocal) || 0,
        parseInt(item.amountKRW, 10) || 0,
        sanitize(String(item.payer || ''), 10),
        String(item.createdAt || new Date().toISOString()),
        sanitize(String(item.docId || ''), 100),
        sanitize(String(item.currency || ''), 10)
      ]);
      added++;
    });

    return { success: true, added: added, updated: updated, deleted: deleted };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
