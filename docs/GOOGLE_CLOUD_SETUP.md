# Google Cloud サービス設定ガイド

このドキュメントでは、AI 営業 OS で使用する Google Cloud サービスの設定方法を説明します。

---

## 1. Firestore (データベース)

### なぜ必要？

- 分析結果を JSON 形式で保存（機械学習用）
- 高速な読み書きとリアルタイム同期

### 設定手順

1. [Firebase Console](https://console.firebase.google.com/) にアクセス
2. 「プロジェクトを追加」→ プロジェクト名（例: `insight-sales`）を入力
3. 「Firestore Database」→「データベースを作成」
4. 「本番モード」または「テストモード」を選択（開発中はテストモードで OK）
5. リージョン: `asia-northeast1` (東京)

### 認証情報の取得

1. 「プロジェクトの設定」→「サービス アカウント」
2. 「新しい秘密鍵を生成」→ JSON ファイルがダウンロードされる
3. ダウンロードしたファイルを `backend/serviceAccountKey.json` として保存
4. `.env` に以下を追加:
   ```
   GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json
   ```

---

## 2. Google Sheets API

### なぜ必要？

- 営業チームが閲覧・編集できる「リード台帳」
- GAS からの書き込みはすでに動作中

### Backend から Sheets に書き込む場合

1. [Google Cloud Console](https://console.cloud.google.com/) にアクセス
2. 「API とサービス」→「ライブラリ」→「Google Sheets API」を有効化
3. 上記の Firebase サービスアカウントに、対象スプレッドシートの編集権限を付与

### スプレッドシート ID の取得

- URL: `https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit`
- `.env` に追加:
  ```
  SPREADSHEET_ID=your_spreadsheet_id_here
  ```

---

## 3. GA4 Data API (行動分析)

### なぜ必要？

- リード（メール問い合わせ者）のサイト内行動を復元
- 「どのページを見たか」「何回訪問したか」を分析

### 設定手順

1. [Google Cloud Console](https://console.cloud.google.com/)
2. 「API とサービス」→「ライブラリ」→「Google Analytics Data API」を有効化
3. Firebase のサービスアカウントに、GA4 プロパティの閲覧権限を付与:
   - GA4 管理画面 → 「プロパティ」→「アクセス管理」
   - サービスアカウントのメールアドレス（`xxx@xxx.iam.gserviceaccount.com`）を追加
   - 役割: 「閲覧者」

### GA4 プロパティ ID の取得

- GA4 管理画面 → 「プロパティ設定」→ プロパティ ID（例: `123456789`）
- `.env` に追加:
  ```
  GA4_PROPERTY_ID=123456789
  ```

---

## 優先順位

| サービス     | 優先度             | 理由                                         |
| ------------ | ------------------ | -------------------------------------------- |
| Firestore    | 低（後で OK）      | 現時点では Sheets で代用可能                 |
| Sheets API   | 中（GAS で代用中） | Backend から Sheets に直接書きたい場合に必要 |
| GA4 Data API | 高                 | リードの行動分析はこの OS の核心機能         |

---

## 次のステップ

1. **最優先**: GA4 Data API を有効化し、サービスアカウントに権限を付与
2. プロパティ ID を `.env` に設定
3. 私に「GA4 設定完了」と伝えていただければ、GA4 解析ロジックを実装します
