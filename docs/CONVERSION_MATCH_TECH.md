# コンバージョン時刻・メール時刻付き合わせ 技術定義書（フォーム非改修前提）

## 1. 前提とゴール
- 1200フォームを改修せず、メール通知の受信時刻を CV 時刻の代理キーとして GA4 の CV ログと近傍マッチさせる。
- `gas/Code.js` の既存フロー（Gmail → 抽出 → シート保存 → Backend 送信）を維持しつつ、突合用のデータ項目とGA4取得処理を補完する。

## 2. 対象ファイル・シート
- Apps Script: `gas/Code.js`
- スプレッドシート:
  - メール取込シート（アクティブシート; 既存ヘッダー + 追加カラム）
  - GA4 CV ログシート（例: `GA4CV`）
  - 突合ビューシート（任意）

## 3. 収集するデータ
- メール側（`processEmails`で保存）
  - 受信日時: `message.getDate()` を JST 換算で保持（シートのタイムゾーンを JST に設定）
  - 件名, 本文（冒頭300文字）, message_id, lead_id（既存）
  - 追加候補: 本文から抽出できる「資料URL/資料名」フィールド（パターンがあれば正規表現で抽出）
- GA4側（CVイベントのみ）
  - ディメンション: `dateHourMinute`, `eventName`, `landingPagePlusQueryString`, `pagePathPlusQueryString`, `sessionSource`, `sessionMedium`, `sessionCampaignName`
  - 指標: `eventCount`
  - フィルタ: `eventName` ∈ カスタムCVイベント名（例: `positioningmedia_inquiry`, `positioningmedia_dl`, `branding_media_dl`, `inquiry`, `clt_thanks`）
  - 備考: 現状は「CVが発火したページ」のみ取得。ページ遡りは未実装（拡張案は下記）。

## 4. 突合ロジック（シート関数想定）
- 基本: 受信日時と GA4 の CV 時刻の差分が最小の行を採用。
- 初期許容: ±5分（遅延が大きい場合は±10分まで拡大）。
- 補助条件で絞り込み（優先順）
  1) 資料URL/資料名が一致（あれば）
  2) `landingPagePlusQueryString` が一致
  3) `deviceCategory` が一致
  → 残った候補を時間差最小で1件選択。
- 数式例（URLがある場合）  
  `=INDEX(SORT(FILTER(GA4CV!A:F, GA4CV!E:E=資料URL), ABS(GA4CV!A:A-受信日時), TRUE), 1)`
- URLがない場合は時間差のみで最小を取る。

## 5. Apps Script 変更方針（`gas/Code.js`）
- 受信日時: 現状の `sheet.appendRow` で保持している `date` を JST 前提で扱う（スプレッドシート側のタイムゾーンを JST に設定）。
- 追加抽出（任意）: 本文から資料URL/資料名を拾える場合、`extractInfo` に新フィールドを追加し、ヘッダーと `appendRow` を拡張。
- ログ: 処理件数、スキップ件数、重複件数を `console.log` で出力（デバッグ用）。
- 既読化/ラベル付け: 現状維持。
- GA4経路拡張（任意・今後の拡張）: sessionId をレポートに含め、CVと同一 sessionId の `page_view` を `eventTimestamp` 昇順で取得し、CV直前からさかのぼって最大10件を `GA_PagePath1〜10` に書く。履歴を取りたい場合は `page_view` 用の runReport を追加で実行。
  - 現状の `GA_PagePath1〜10` は、`PagePath1` に CV 発火ページを格納し、`2〜10` は空（履歴未取得）。セッション履歴を入れたい場合は上記 sessionId 連携を実装する。
- イベント名マッピング（例）
  - ポジショニングメディア資料DL → `positioningmedia_dl`
  - ブランディングメディア資料DL → `branding_media_dl`
  - キャククル（Z-CIN/Z-KIN）問い合わせ/掲載/資料DL → `clt_thanks` または `inquiry` など、環境で設定しているキャククル系CVイベントのリストに寄せる
  - 一般問い合わせ → `inquiry`
  - これらを Apps Script の `mapDocumentTypeToEventName` で複数候補リストとして返し、最も近い時刻のイベントを採用する。

## 6. GA4 CV 取得（Apps Script 高度なサービス利用案）
```js
function fetchGa4CvEvents() {
  const propertyId = 'properties/XXXXXXXX'; // GA4プロパティID
  const res = AnalyticsData.Properties.runReport(
    {
      dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
      dimensions: [
        { name: 'dateHourMinute' },
        { name: 'eventName' },
        { name: 'landingPagePlusQueryString' },
        { name: 'pagePathPlusQueryString' },
        { name: 'sessionSource' },
        { name: 'sessionMedium' },
        { name: 'sessionCampaignName' }
      ],
      metrics: [{ name: 'eventCount' }],
      dimensionFilter: {
        filter: {
          fieldName: 'eventName',
          inListFilter: {
            values: ['positioningmedia_inquiry', 'positioningmedia_dl', 'branding_media_dl', 'inquiry', 'clt_thanks'], // 環境に合わせて変更
            caseSensitive: true
          }
        }
      }
    },
    propertyId
  );
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('GA4CV') || ss.insertSheet('GA4CV');
  sheet.clearContents();
  const header = res.dimensionHeaders.map(h => h.name).concat(res.metricHeaders.map(m => m.name));
  const rows = (res.rows || []).map(r => r.dimensionValues.map(v => v.value).concat(r.metricValues.map(m => m.value)));
  if (rows.length) sheet.getRange(1, 1, rows.length + 1, header.length).setValues([header, ...rows]);
}
```
- 高度なサービスで「Google Analytics Data API」を有効化すること。
- タイムゾーン: GA4 プロパティを JST に設定。
- 履歴ページを取得したい場合: 上記CV取得に `sessionId` を追加し、取得した sessionId を使って別途 `eventName = page_view` で runReport。dimensions: `eventTimestamp`, `pagePathPlusQueryString`, `sessionId`、orderBys: `eventTimestamp` ASC。戻り値を時系列で整列し、CV直前のページから最大10件をシートの `GA_PagePath1〜10` に入れる。

## 7. 運用設計
- トリガー: メール取込は 5〜10分間隔の時間主導トリガー。GA4取得は 1時間〜1日間隔。
- シートタイムゾーン: JST に統一。
- 許容時間幅: 運用開始後に実測し、±5分→±10分など調整。
- 監視: 近傍マッチのヒット率を定期的に確認。短時間に CV が集中する資料ページは誤マッチリスクが高いので別途確認する。

## 8. リスクと対策
- 同一資料で短時間に複数CVがある場合の誤マッチ → URL/資料名・デバイスで絞り込み、時間差が同値なら手動確認。
- メール通知遅延 → 許容時間幅を実測で調整。
- GAヒット欠損（広告ブロッカー等） → 突合不可。件数を別途カウント。
- 精度向上の余地: 改修可能なフォームだけでも hiddenキー（`client_id`/`gclid` 等）を部分導入し、完全一致を混在運用する。
