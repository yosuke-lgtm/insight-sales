# コンバージョン時刻・メール時刻の付き合わせ（フォーム非改修方針）要件定義

## 目的
- フォーム改修なし（hiddenキー追加なし）で、メール通知時刻とGA4上のコンバージョン時刻を近傍マッチさせ、流入経路と合算して分析可能にする。

## スコープ
- 対象: フォーム送信 → Gmail通知 → Apps Script取り込み（`gas/Code.js`） → シート保存 → GA4 Data API/拡張機能でCVログ取得 → 時刻＋補助情報で突合 → 集計/可視化（シート/Looker Studio）。
- 非対象: 1200フォームの改修、CRM連携、広告配信管理、個人情報の外部送信。

## 収集・保持データ
- メール側（既存＋確認必須）
  - `受信日時`（Gmail Dateヘッダー, JST 換算で保持）
  - `件名`（資料名・サービス名など）
  - `本文`（必要なら冒頭300字）
  - `message_id`/`lead_id`（既存）
  - 任意: 本文にURLや資料名が含まれる場合は抽出して保持（突合精度向上）
- GA4側（CVイベントのみ抽出）
  - `dateHourMinute` もしくは `eventTimestamp`
  - `sessionDefaultChannelGroup`
  - `sessionSourceMedium`
  - `sessionCampaignName`
  - `landingPagePlusQueryString`（資料ページURLなら最優先で取得）
  - `pageReferrer`
  - `deviceCategory`
  - （拡張）`sessionId` を含め、同一セッションの `page_view` 履歴を取得して CV 直前までのページを `GA_PagePath1〜10` に保存できるようにする
  - 指標: `conversions`
  - フィルタ: `eventName` = CVイベント名（例 `form_submit`） ※複数イベントを inListFilter で OR 指定可

## シート構成案
- シートA（メール取込）: 既存列に加え、抽出できる場合は「資料URL/資料名」列を追加。タイムゾーンは JST。
- シートB（GA4CV）: GA4 API/拡張機能で取得したCVログを格納。上記ディメンション＋指標。`sessionId` を含めると、別途 `page_view` を引いて履歴を保存できる。
- シートC（突合ビュー）: シートAを主とし、シートBを時刻・資料URL/名でJOINした結果を表示。
- シートAの拡張カラム例: `GA_Source`, `GA_Medium`, `GA_Campaign`, `GA_LandingPage`, `GA_PagePath1〜10`（CV直前のページを時系列で格納するために最大10件分を想定）

## 突合ロジック
- 主軸: `受信日時` と GA4 `dateHourMinute`（または `eventTimestamp`）の時間差が最小のCVを採用。
- 許容範囲: 初期は ±5分でマッチ。実測し遅延が大きい場合は±10分まで拡大。
- 補助条件（誤マッチ低減のため順に適用）
  1. 資料URL/資料名が一致するものだけに絞り込み（あれば最優先）。
  2. 同一ランディングページ（`landingPagePlusQueryString`）に限定。
  3. 同一デバイス種別で絞る。
  4. 残った候補から時間差が最小の1件を採用。
- 近傍マッチ式（例）
  - `=INDEX(SORT(FILTER(GA4CV!A:F, GA4CV!E:E=資料URL), ABS(GA4CV!A:A-受信日時), TRUE), 1)`  
  - URLがない場合は時間差のみで最小値を取る。

## 実装タスク
- Apps Script (`gas/Code.js`)
  - 受信日時を JST としてシート保存（現状保持済みの値を再確認）。
  - 本文から資料URL/資料名を拾える場合はカラム追加。
  - GA4突合用カラムの追加: `GA_Source`, `GA_Medium`, `GA_Campaign`, `GA_LandingPage`, `GA_PagePath1〜10`（履歴を格納する場合）
- GA4取得
  - Data API の高度なサービスを有効化し、別関数でCVログを `GA4CV` シートへ出力（サンプルはREADME/このファイル参照）。
  - 必要に応じて `sessionId` をCV取得に含め、同一セッションの `page_view` を追加で取得し、CV直前までのページを `GA_PagePath1〜10` に時系列で格納。
  - もしくは公式シート拡張機能で同等のディメンション・フィルタを設定。
- 突合
  - シート関数（FILTER+SORT+INDEX）で最小時間差のCVを参照。
  - テンプレート行を用意し、QUERY/ARRAYFORMULA で全行に適用。

## 運用
- メール取込トリガー: 5〜10分間隔。
- GA4取得: 1時間〜1日間隔（APIクォータと相談）。  
- タイムゾーン: GA4プロパティ・スプレッドシートともに JST。メールDateもJSTに換算して保存。
- ログ: スキップ理由、抽出結果、突合結果のヒット/未ヒット件数を記録（Apps Scriptログ or シート列）。

## 精度とリスク
- フォームを触らないため、完全一致のキー（client_id/gclid）がなく、短時間に複数CVが発生した場合は誤マッチリスクが残る。
- メール通知遅延が大きい場合は時間差が広がる。実測して許容幅を調整。
- 広告ブロッカーなどでGAヒットが記録されないCVは突合不可。

## 今後の拡張（任意）
- 改修可能なフォームだけでも hiddenキー（`client_id`/`session_id`/`gclid`）を部分的に導入し、突合精度を底上げ。
- ランディングページURLを本文に必ず含める運用を追加。
