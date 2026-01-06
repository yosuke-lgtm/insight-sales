# Google Apps Script (GAS) セットアップ手順

このプロジェクトでは、Gmail に来た問い合わせを検知し、スプレッドシートに記録しつつ、Backend の AI システムへ通知するために GAS を使用します。

## 手順

1. **Google スプレッドシートを新規作成**

   - 名前は「AI 営業 OS_DB」などにしてください。

2. **Apps Script エディタを開く**

   - メニューの `拡張機能` > `Apps Script` をクリックします。

3. **コードの貼り付け**

   - エディタが開いたら、元々あるコードを削除し、
   - `gas/Code.js` の内容をすべてコピーして貼り付けてください。

4. **設定の変更**

   - コード上部の `CONFIG` オブジェクトを確認してください。
   - `SEARCH_QUERY`: 実際にテストしたいメールがヒットするように調整してください（例: `from:me subject:テスト` など）。
   - `BACKEND_URL`: **重要**
     - ローカルで開発中は、GAS から `localhost` にアクセスできません。
     - `ngrok` などを使ってローカルサーバーを公開するか、Backend をクラウド（Render/Cloud Run）にデプロイした後の URL を設定します。
     - _とりあえず動かすだけなら、このままでもスプレッドシートへの保存は動作します。_

5. **トリガーの設定**
   - 左側の時計アイコン（トリガー）をクリック。
   - `トリガーを追加` ボタンをクリック。
   - 実行する関数: `processInbox`
   - イベントのソース: `時間主導型`
   - タイプ: `分ベースのタイマー`
   - 間隔: `5分おき` など
   - 保存時に権限承認画面が出るので、許可してください（「安全ではないページ」と出た場合は「詳細」→「安全ではないページに移動」）。

## テスト方法

1. 自分宛てに、設定した検索クエリにヒットするメールを送る。
2. エディタ上で `processInbox` 関数を選択し、「実行」ボタンを押す。
3. スプレッドシートに行が追加されていることを確認する。

## GA4 突合フロー概要

- 関数 `syncGa4Data` が、直近3日分の GA4 カスタムCVイベント（例: `positioningmedia_inquiry`, `positioningmedia_dl`, `branding_media_dl`, `inquiry`, `clt_thanks`）を取得します。
- メール行の「受信日時」と「資料種別」からマッピングされたイベント名候補を作り、±90分で最も近い GA4 イベントを1件突合して、以下カラムを更新します。
  - `GA_Source`, `GA_Medium`, `GA_Campaign`
  - `GA_LandingPage`（セッションのLP）
  - `GA_PagePath1`（CV発火ページ）※現状1件のみ
- `GA_PagePath2〜10` は拡張用で、現在は空のままです。

## 複数ページの回遊履歴を入れたい場合

GA4標準では `sessionId` が取れないため、以下を行う必要があります。

1. **GTM/GA4で session_id などを送る**
   - 全イベントに `session_id`（もしくは `client_id`）を param で付与し、GA4のカスタムディメンション（eventスコープ）に登録する。
2. **Apps ScriptのCV取得で session_id を保持**
   - `fetchGa4ConversionEvents` の dimensions に上記カスタムディメンションを追加し、返却値に含める。
3. **同一 session_id の page_view を取得して書き込み**
   - 別の runReport で `eventName=page_view` を絞り、`session_id` と `pagePathPlusQueryString`, `dateHourMinute` を取得。
   - CV時刻より前のページだけを時系列で並べ、`GA_PagePath1〜10` に古い→新しい順で詰める（末尾がCV直前ページ）。

上記を実装すれば、ランディング→回遊→CVまでの最大10ページをシートに残せます。現行コードは session_id 未送信を想定し、CVページ1件のみを書き込む構成です。
