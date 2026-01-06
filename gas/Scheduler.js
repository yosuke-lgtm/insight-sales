/**
 * Scheduler utilities
 *
 * 目的:
 * - processInbox → syncGa4Data → (完了メッセージをChatへ) の順序を保証する
 * - 時間主導トリガーはこの関数だけに紐づける（順序保証のため）
 *
 * 使い方:
 * 1) Apps Scriptに Code.js とこのファイルを配置
 * 2) 手動で INSTALL_SCHEDULED_TRIGGER() を1回実行（権限付与）
 * 3) 以降は 15分おきに runScheduled_() が動く
 */

function runScheduled_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) return;

  try {
    const startedAt = new Date();

    // 転記先シートの存在を保証
    const leadsSheet = getLeadsSheet_();

    // 1) Gmail取り込み（15分おき）
    processInbox();

    // 1.5) GA4速報同期（15分おき）
    syncGa4RealtimeData();

    // 2) GA4同期（重いのでデフォルトは1時間おき。毎回回したければ 0 にする）
    const intervalMinutes = Number(CONFIG.GA4_SYNC_INTERVAL_MINUTES || 60);
    const ranGa4 = shouldRunGa4Sync_(intervalMinutes);
    if (ranGa4) {
      syncGa4Data();
      PropertiesService.getScriptProperties().setProperty('LAST_GA4_SYNC_MS', String(Date.now()));
    }

    // 定期実行の完了通知は送らない
  } finally {
    lock.releaseLock();
  }
}

// 手動実行用（転記先シートを保証して processInbox を回す）
function processInboxToLeadsSheet() {
  getLeadsSheet_();
  processInbox();
}

// 手動実行用（転記先シートを保証して syncGa4Data を回す）
function syncGa4DataToLeadsSheet() {
  getLeadsSheet_();
  syncGa4Data();
}

function INSTALL_SCHEDULED_TRIGGER() {
  const handler = 'runScheduled_';

  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === handler || t.getHandlerFunction() === 'processInbox')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger(handler)
    .timeBased()
    .everyMinutes(15)
    .create();
}

function shouldRunGa4Sync_(intervalMinutes) {
  if (!intervalMinutes || intervalMinutes <= 0) return true;
  const props = PropertiesService.getScriptProperties();
  const last = Number(props.getProperty('LAST_GA4_SYNC_MS') || '0');
  return Date.now() - last >= intervalMinutes * 60 * 1000;
}

function postTextToChat_(text) {
  if (!CONFIG.CHAT_WEBHOOK_URL || CONFIG.CHAT_WEBHOOK_URL.includes('YOUR_SPACE_ID')) return;
  UrlFetchApp.fetch(CONFIG.CHAT_WEBHOOK_URL, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ text }),
    muteHttpExceptions: true
  });
}

function formatAsJst_(d) {
  return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
}

function getLeadsSheet_() {
  const sheetName = CONFIG && CONFIG.LEADS_SHEET_NAME ? CONFIG.LEADS_SHEET_NAME : '';
  const sheet = sheetName
    ? SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName)
    : SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  if (!sheet) {
    throw new Error(`Leads sheet not found: ${sheetName}`);
  }
  return sheet;
}
