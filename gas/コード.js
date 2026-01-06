/**
 * AI Sales OS - Gmail Inbound Trigger (v3)
 * 
 * このスクリプトをGoogleスプレッドシートの「拡張機能 > Apps Script」にコピペしてください。
 * 
 * 機能:
 * 1. 指定された件名・送信者の未読メールを検索
 * 2. 「相互リンク」が含まれるメールは除外
 * 3. 本文から顧客情報を詳細に抽出
 * 4. Backend APIへ転送 & スプレッドシート保存
 * 
 * v3変更点:
 * - 検索クエリを拡張（Zenken株式会社からの通知にも対応）
 * - 資料ダウンロード系の件名パターンを追加
 * - URL、広告予算、施策導入タイミングなどの追加フィールドに対応
 */

// 設定
const CONFIG = {
  // 検索クエリ
  // システム通知コード（Z-WP, Z-CIN, Z-KIN, Z-PIN）を含むメールのみを厳格に取得
  // 宛先(to)を指定するとメーリングリスト経由などが漏れるため削除
  SEARCH_QUERY: 'subject:("Z-WP" OR "Z-CIN" OR "Z-KIN" OR "Z-PIN" OR "問い合わせフォームに到達しました" OR "問合せフォームに到達しました" OR "問い合わせフォームに訪問しました" OR "問合せフォームに訪問しました" OR "【キャククル】Zenkenメディア制作事例ページの訪問がありました" OR "Zenkenメディア制作事例ページの訪問がありました" OR "PM資料をDLしたユーザーが繰り返し事例コンテンツを閲覧しました" OR "「ポジショニングメディア問い合わせページ」への訪問がありました" OR "【キャククル】ブランディングメディアフォームページへの訪問がありました" OR "「ポジショニングメディアフォーム」の訪問がありました" OR "「ポジショニングメディア資料DLフォーム」の訪問がありました" OR "ポジショニングメディア資料DLフォームに訪問しました")',
  
  // 除外キーワード（配列で複数対応）
  // 本文に含まれる場合スキップ
  EXCLUDE_KEYWORDS: ['相互リンク', 'テストメール', '配信停止', 'unsubscribe', '購読解除', '発行元'],

  // 件名除外キーワード
  // ContractS CLMなどの業務連絡やメルマガ、Backlog通知を除外
  EXCLUDE_SUBJECT_KEYWORDS: ['ご案内', 'プレゼント', '記念', 'キャンペーン', 'お知らせ', 'News', 'メルマガ', 'ContractS CLM', '承認', '差戻し', 'タスク', 'Backlog', 'デザイン変更', 'イメージ図'],

  // 送信者除外キーワード（新規追加）
  // Fromアドレスや送信者名に含まれる場合スキップ
  EXCLUDE_SENDERS: ['backlog.jp', 'notifications', 'no-reply@google.com'],

  // BackendのURL (ngrokなどでローカルを公開するか、Cloud RunのURL)
  BACKEND_URL: 'https://YOUR_BACKEND_URL/api/inbound', 
  
  // Chat通知用Webhook URL (Google Chat)
  // 設定しない場合は空文字にしておくとスキップされます
  CHAT_WEBHOOK_URL: 'https://chat.googleapis.com/v1/spaces/AAAAbHdHtJM/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=rdOOEKBC3ozmSeF_6xaq2Ijp8Dc6e6oKxtTBUuHGcIo',
  CHAT_WEBHOOK_URL_CUCKOOL: 'https://chat.googleapis.com/v1/spaces/AAAAHfehQ6E/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=rROdhxhVs33LUrnu6RZSavuR2LzTaqxrKMRKcV51yjA', // キャククル向け
  CHAT_WEBHOOK_URL_OTHERS: 'https://chat.googleapis.com/v1/spaces/AAAAtRoVKB0/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=5axOt2wu2vzHicxUo1e476Mpioj8OhIfu2I8pHlFbTk', // それ以外
  
  // 処理済みラベル名
  PROCESSED_LABEL: 'AI_SALES_OS_PROCESSED',

  // GA4プロパティID (数値の文字列)
  GA4_PROPERTY_ID: '350946143',

  // アラートメール通知先（平日10時に未対応分を送信）
  ALERT_EMAILS: [''],
  ALERT_CHAT_WEBHOOK_URLS: [
    'https://chat.googleapis.com/v1/spaces/AAAAHfehQ6E/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=rROdhxhVs33LUrnu6RZSavuR2LzTaqxrKMRKcV51yjA',
    'https://chat.googleapis.com/v1/spaces/AAAAtRoVKB0/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=5axOt2wu2vzHicxUo1e476Mpioj8OhIfu2I8pHlFbTk'
  ],
  SALES_SHEET_NAME: '営業用',
  ALERT_STATUS_KEYWORDS: ['未着手', '不通', 'ファーストメール送付済'],
  LEADS_SHEET_NAME: 'リード内容',
  GA4_SYNC_INTERVAL_MINUTES: 1440,

  // BigQuery settings (GA4 Export)
  BQ_PROJECT_ID: 'kyakukuru',
  BQ_DATASET_ID: 'analytics_350946143',
  BQ_TABLE_SUFFIX: '', // 空なら当日(スクリプトのタイムゾーン)を使用
  BQ_USE_INTRADAY: true
};

const SALES_HEADERS = [
  'lead_id', 'message_id', '受信日時', '種別', '法人名', '氏名', 'Email', '電話番号',
  '役職', '業種', '従業員数', '売上', 'URL', '広告予算', '施策タイミング', 'メール本文',
  '訪問ページ', '対応者', '対応日', '対応ステータス', 'hubspot URL', 'ネクストアクション', 'ネクストアクション期日',
  'GA_Source', 'GA_Medium', 'GA_Campaign', 'GA_LandingPage', 'GA_PageTitle',
  'Inferred_Factors', 'Inferred_Hypothesis', 'GA_PagePath1', 'GA_PagePath2', 'GA_PagePath3',
  'GA_PagePath4', 'GA_PagePath5', 'GA_PagePath6', 'GA_PagePath7', 'GA_PagePath8',
  'GA_PagePath9', 'GA_PagePath10'
];

// ... (setupTrigger, processInbox, etc.)

/**
 * GA4のデータを取得し、スプレッドシートの既存リードと突き合わせて
 * 流入経路情報（LP, Source, Mediumなど）を補完する関数
 * トリガーで1時間おき、または1日1回実行することを推奨
 */
function syncGa4Data() {
  const lookbackDays = 3;
  console.log('Fetching BigQuery events...');
  const bqEvents = fetchBigQueryConversionEvents(lookbackDays);
  console.log(`BigQuery Events Fetched: ${bqEvents.length}`);
  syncGaDataWithEvents_(bqEvents, {
    forceOverwrite: true,
    sendChat: false,
    runInference: true
  });
}

function syncGa4RealtimeData() {
  console.log('Fetching GA4 events (Realtime API)...');
  const gaEvents = fetchGa4RealtimeConversionEvents();
  console.log(`GA4 Realtime Events Fetched: ${gaEvents.length}`);
  syncGaDataWithEvents_(gaEvents, {
    forceOverwrite: false,
    sendChat: false,
    runInference: false
  });
}

function syncGaDataWithEvents_(events, options) {
  const sheet = getLeadsSheet();
  if (!sheet) return;
  // ヘッダー更新（GA4用カラム追加）
  checkAndUpdateHeaders(sheet);
  const salesSheet = getSalesSheet();
  const salesHeaders = salesSheet ? ensureSalesHeaders_(salesSheet) : null;
  const salesMessageIdIdx = salesHeaders ? salesHeaders.indexOf('message_id') : -1;
  const salesRowByMessageId = salesSheet && salesMessageIdIdx >= 0
    ? buildRowIndexByMessageId_(salesSheet, salesMessageIdIdx)
    : {};

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;

  // 全データ取得
  // データ量が増えたら範囲を絞る処理が必要
  const dataRange = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn());
  const data = dataRange.getValues();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  // カラムインデックスの特定
  const idx = {
    leadId: headers.indexOf('lead_id'),
    date: headers.indexOf('受信日時'),
    needLevel: headers.indexOf('ニーズ顕在度'),
    subject: headers.indexOf('件名'),
    email: headers.indexOf('Email'),
    docType: headers.indexOf('資料種別'),
    company: headers.indexOf('法人名'), // 追加
    name: headers.indexOf('氏名'), // 追加
    phone: headers.indexOf('電話番号'), // 追加
    timing: headers.indexOf('施策タイミング'), // 追加
    gaSource: headers.indexOf('GA_Source'),
    gaMedium: headers.indexOf('GA_Medium'),
    gaCampaign: headers.indexOf('GA_Campaign'),
    gaLp: headers.indexOf('GA_LandingPage'),
    gaPageTitle: headers.indexOf('GA_PageTitle'), // 追加
    inferredFactors: headers.indexOf('Inferred_Factors'), // 追加
    inferredHypothesis: headers.indexOf('Inferred_Hypothesis'), // 追加
    gaPath1: headers.indexOf('GA_PagePath1'),
    gaPath2: headers.indexOf('GA_PagePath2'),
    gaPath3: headers.indexOf('GA_PagePath3'),
    gaPath4: headers.indexOf('GA_PagePath4'),
    gaPath5: headers.indexOf('GA_PagePath5'),
    gaPath6: headers.indexOf('GA_PagePath6'),
    gaPath7: headers.indexOf('GA_PagePath7'),
    gaPath8: headers.indexOf('GA_PagePath8'),
    gaPath9: headers.indexOf('GA_PagePath9'),
    gaPath10: headers.indexOf('GA_PagePath10')
  };

  // 比較用の基準日時（3日前）
  const thresholdDate = new Date();
  thresholdDate.setDate(thresholdDate.getDate() - 3);
  const forceOverwrite = options && options.forceOverwrite;
  const sendChat = options && options.sendChat;
  const runInference = options && options.runInference;

  // 各リードに対してマッチングを行う
  let matchCount = 0;
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    
    // 既にGA4データが入っている場合はスキップ (再通知を防ぐため)
    if (!forceOverwrite && idx.gaLp >= 0 && row[idx.gaLp]) continue;

    const emailDate = new Date(row[idx.date]);
    
    // 日時チェック: 3日より古いデータはスキップ
    if (emailDate < thresholdDate) {
      continue;
    }

    // docTypeを件名から再判定（既存データの補正のため）
    const subject = row[idx.subject]; // 件名カラムが必要
    const docType = extractDocumentType(subject, ''); 
    
    const targetEventNames = mapDocumentTypeToEventName(docType);

    if (!targetEventNames || targetEventNames.length === 0) {
      continue;
    }

    // 最も近いイベントを探す（デバッグ用ロジック）
    let bestMatch = null;
    let minDiffMinutes = Infinity;

    events.forEach(event => {
      if (!targetEventNames.includes(event.eventName)) return;
      
      const timeDiff = Math.abs(event.timestamp.getTime() - emailDate.getTime());
      const diffMinutes = timeDiff / (1000 * 60);
      
      if (diffMinutes < minDiffMinutes) {
        minDiffMinutes = diffMinutes;
        bestMatch = event;
      }
    });

    if (bestMatch) {
      // 判定基準: 90分以内（さらに拡大）
      if (minDiffMinutes <= 90) {
        matchCount++;
        const rowNum = i + 2;
        
        // 推察ロジック実行 (Backend API Call)
        const inference = runInference
          ? inferUserContextViaBackend(
              row[idx.company],
              row[idx.email],
              bestMatch.pageTitle,
              bestMatch.landingPath,
              docType
            )
          : { factors: [], hypothesis: '', sales_hook: '' };

        // 経路情報を書き込み
        if (idx.gaSource >= 0) sheet.getRange(rowNum, idx.gaSource + 1).setValue(bestMatch.source);
        if (idx.gaMedium >= 0) sheet.getRange(rowNum, idx.gaMedium + 1).setValue(bestMatch.medium);
        if (idx.gaCampaign >= 0) sheet.getRange(rowNum, idx.gaCampaign + 1).setValue(bestMatch.campaign);
        if (idx.gaLp >= 0) sheet.getRange(rowNum, idx.gaLp + 1).setValue(bestMatch.landingPath);
        
        // 新規追加カラムへの書き込み
        if (idx.gaPageTitle >= 0) sheet.getRange(rowNum, idx.gaPageTitle + 1).setValue(bestMatch.pageTitle || '');
        if (idx.inferredFactors >= 0) sheet.getRange(rowNum, idx.inferredFactors + 1).setValue(inference.factors.join(', '));
        if (idx.inferredHypothesis >= 0) sheet.getRange(rowNum, idx.inferredHypothesis + 1).setValue(inference.hypothesis);

        // セッション内のページ履歴を格納（取れない場合はCVページのみ）
        const paths = bestMatch.paths && bestMatch.paths.length > 0
          ? dedupeAdjacent(bestMatch.paths)
          : [bestMatch.pagePath || bestMatch.landingPath || ''];
        const pathCols = [
          idx.gaPath1, idx.gaPath2, idx.gaPath3, idx.gaPath4, idx.gaPath5,
          idx.gaPath6, idx.gaPath7, idx.gaPath8, idx.gaPath9, idx.gaPath10
        ];
        pathCols.forEach((colIdx, pi) => {
          if (colIdx >= 0) {
            sheet.getRange(rowNum, colIdx + 1).setValue(paths[pi] || '');
          }
        });
        sheet.getRange(rowNum, idx.docType + 1).setValue(docType); 

        if (salesSheet && salesHeaders) {
          const messageId = row[1];
          const salesRowNum = salesRowByMessageId[messageId];
          if (salesRowNum) {
            updateSalesGaFields_(
              salesSheet,
              salesHeaders,
              salesRowNum,
              {
                source: bestMatch.source,
                medium: bestMatch.medium,
                campaign: bestMatch.campaign,
                landingPath: bestMatch.landingPath,
                pageTitle: bestMatch.pageTitle,
                paths: paths
              }
            );
          }
        }
        
        console.log(`  >>> MATCH UPDATED! Row ${rowNum}`);

        // Chat通知 (Enriched)
        const notificationData = {
          company: idx.company >= 0 ? row[idx.company] : '',
          name: idx.name >= 0 ? row[idx.name] : '',
          email: idx.email >= 0 ? row[idx.email] : '',
          phone: idx.phone >= 0 ? row[idx.phone] : '',
          timing: idx.timing >= 0 ? row[idx.timing] : '',
          subject: subject,
          documentType: docType,
          // GA4 info
          pageTitle: bestMatch.pageTitle,
          landingPage: bestMatch.landingPath || bestMatch.pagePath || '',
          hypothesis: inference.hypothesis,
          factors: inference.factors,
          sales_hook: inference.sales_hook, // 追加
          sheetUrl: sheet.getParent().getUrl(),
          sheetId: sheet.getSheetId(),
          rowNum: rowNum
        };
        if (sendChat) {
          sendToChat(notificationData);
        }
      }
    }
  }
  console.log(`Sync Complete. Total Matches Updated: ${matchCount}`);
}

/**
 * Backend APIを通じてUser Contextを推察する
 * @return {Object} { factors, hypothesis, sales_hook }
 */
function inferUserContextViaBackend(companyName, email, lpTitle, lpUrl, docType) {
  // Backend URL生成 (例: /api/inbound -> /api/analyze-inbound-lead)
  const apiUrl = CONFIG.BACKEND_URL.replace('/api/inbound', '/api/analyze-inbound-lead');
  
  const payload = {
    companyName: companyName,
    email: email,
    lpTitle: lpTitle,
    lpUrl: lpUrl,
    inflowType: docType
  };

  try {
    const options = {
      'method': 'post',
      'contentType': 'application/json',
      'payload': JSON.stringify(payload),
      'muteHttpExceptions': true
    };
    
    console.log('Calling Analysis API:', apiUrl);
    const response = UrlFetchApp.fetch(apiUrl, options);
    const json = JSON.parse(response.getContentText());
    
    if (response.getResponseCode() !== 200) {
      console.warn('Backend Analysis Error:', json);
      // Fallback to basic hypothesis
      return {
        factors: [],
        hypothesis: `(分析エラー) LP: ${lpTitle}`,
        sales_hook: ''
      };
    }
    
    return {
      factors: json.pestle_factors || [],
      hypothesis: json.hypothesis || '分析不可',
      sales_hook: json.sales_hook || ''
    };

  } catch (e) {
    console.error('API Call Exception:', e);
    return {
      factors: [],
      hypothesis: `(通信エラー) LP: ${lpTitle}`,
      sales_hook: ''
    };
  }
}

/**
 * GA4からコンバージョンイベントを取得するヘルパー関数
 */
function fetchGa4ConversionEvents(daysAgo) {
  // GA4 Data API は使用しない（BigQuery連携に切り替え済み）
  console.log('GA4 Data API is disabled. Use BigQuery export instead.');
  return [];

  const propertyId = `properties/${CONFIG.GA4_PROPERTY_ID}`;
  const eventNames = [
    // GA4カスタムCVイベント名（環境に合わせて変更）
    'positioningmedia_inquiry',
    'positioningmedia_dl',
    'branding_media_dl',
    'inquiry',
    'clt_thanks'
  ];

  try {
    const res = AnalyticsData.Properties.runReport(
      {
        dateRanges: [{ startDate: `${daysAgo}daysAgo`, endDate: 'today' }],
        dimensions: [
          { name: 'dateHourMinute' },
          { name: 'eventName' },
          { name: 'landingPagePlusQueryString' },
          { name: 'pagePathPlusQueryString' },
          { name: 'sessionSource' },
          { name: 'sessionMedium' },
          { name: 'sessionCampaignName' },
          { name: 'pageTitle' }, // ページタイトルを追加
          { name: 'userPseudoId' }
        ],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: {
          filter: {
            fieldName: 'eventName',
            inListFilter: {
              values: eventNames,
              caseSensitive: true
            }
          }
        }
      },
      propertyId
    );

    if (!res.rows) {
      console.log('GA4 API Response: No rows returned');
      return [];
    }

    return res.rows.map(row => {
      const dims = row.dimensionValues;
      const dhm = dims[0].value; // YYYYMMDDHHmm
      const year = parseInt(dhm.substring(0, 4));
      const month = parseInt(dhm.substring(4, 6)) - 1;
      const day = parseInt(dhm.substring(6, 8));
      const hour = parseInt(dhm.substring(8, 10));
      const minute = parseInt(dhm.substring(10, 12));
      
      return {
        timestamp: new Date(year, month, day, hour, minute),
        eventName: dims[1].value,
        landingPage: dims[2].value,
        pagePath: dims[3].value,
        source: dims[4].value,
        medium: dims[5].value,
        campaign: dims[6].value,
        pageTitle: dims[7].value, // pageTitleを追加
        userPseudoId: dims[8].value
      };
    });

  } catch (e) {
    console.error('GA4 Fetch API Error:', e);
    return [];
  }
}

/**
 * GA4 Realtime API (速報用): セッション識別子なしの簡易イベント取得
 */
function fetchGa4RealtimeConversionEvents() {
  const propertyId = `properties/${CONFIG.GA4_PROPERTY_ID}`;
  const eventNames = [
    'positioningmedia_inquiry',
    'positioningmedia_dl',
    'branding_media_dl',
    'inquiry',
    'clt_thanks'
  ];

  try {
    const dimensionCandidates = [
      ['minutesAgo', 'eventName', 'pagePath', 'pageLocation', 'sessionSource', 'sessionMedium', 'sessionCampaignName'],
      ['minutesAgo', 'eventName', 'pagePath', 'sessionSource', 'sessionMedium', 'sessionCampaignName'],
      ['minutesAgo', 'eventName', 'pageLocation', 'sessionSource', 'sessionMedium', 'sessionCampaignName'],
      ['minutesAgo', 'eventName', 'pagePath', 'pageLocation'],
      ['minutesAgo', 'eventName', 'pagePath'],
      ['minutesAgo', 'eventName']
    ];

    let res = null;
    let usedDimensions = null;
    for (const dims of dimensionCandidates) {
      try {
        res = AnalyticsData.Properties.runRealtimeReport(
          {
            dimensions: dims.map(name => ({ name: name })),
            metrics: [{ name: 'eventCount' }],
            dimensionFilter: {
              filter: {
                fieldName: 'eventName',
                inListFilter: {
                  values: eventNames,
                  caseSensitive: true
                }
              }
            }
          },
          propertyId
        );
        usedDimensions = dims;
        break;
      } catch (e) {
        console.warn(`Realtime API fallback (dimensions): ${dims.join(', ')}`, e);
      }
    }

    if (!res || !res.rows || !usedDimensions) return [];

    return res.rows.map(row => {
      const values = row.dimensionValues || [];
      const dimMap = {};
      usedDimensions.forEach((name, idx) => {
        dimMap[name] = values[idx] ? values[idx].value : '';
      });

      const minutesAgo = parseInt(dimMap.minutesAgo || '0', 10);
      const timestamp = isNaN(minutesAgo)
        ? new Date()
        : new Date(Date.now() - minutesAgo * 60 * 1000);
      const pageLocation = dimMap.pageLocation || '';
      const pagePath = dimMap.pagePath || '';
      const landingPath = pagePath || extractPathFromUrl_(pageLocation);

      return {
        timestamp: timestamp,
        eventName: dimMap.eventName || '',
        landingPath: landingPath,
        pagePath: landingPath,
        source: dimMap.sessionSource || '',
        medium: dimMap.sessionMedium || '',
        campaign: dimMap.sessionCampaignName || '',
        pageTitle: '',
        paths: []
      };
    });
  } catch (e) {
    console.error('GA4 Realtime API Error:', e);
    return [];
  }
}

/**
 * BigQueryからコンバージョンイベントとセッション内経路を取得する
 * BigQuery Advanced Service の有効化が必要
 */
function fetchBigQueryConversionEvents(daysAgo) {
  const projectId = CONFIG.BQ_PROJECT_ID;
  const datasetId = CONFIG.BQ_DATASET_ID;
  const tableSuffix = resolveBqTableSuffix();

  if (!projectId || !datasetId) {
    console.log('BigQuery settings not set. Skipping BQ fetch.');
    return [];
  }

  const eventNames = [
    'positioningmedia_inquiry',
    'positioningmedia_dl',
    'branding_media_dl',
    'inquiry',
    'clt_thanks'
  ];

  const tableRef = `\`${projectId}.${datasetId}.events_*\``;
  const intradayRef = `\`${projectId}.${datasetId}.events_intraday_*\``;
  const suffixFilter = tableSuffix
    ? `_TABLE_SUFFIX = '${tableSuffix}'`
    : `_TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL ${daysAgo} DAY)) AND FORMAT_DATE('%Y%m%d', CURRENT_DATE())`;
  const eventNamesSql = eventNames.map(name => `'${name}'`).join(', ');

  const baseConversions = `
    SELECT
      event_name,
      TIMESTAMP_MICROS(event_timestamp) AS event_ts,
      user_pseudo_id,
      (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS ga_session_id,
      traffic_source.source AS source,
      traffic_source.medium AS medium,
      traffic_source.name AS campaign
    FROM %TABLE%
    WHERE ${suffixFilter}
      AND event_name IN (${eventNamesSql})
  `;
  const basePageviews = `
    SELECT
      TIMESTAMP_MICROS(event_timestamp) AS event_ts,
      user_pseudo_id,
      (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS ga_session_id,
      (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_path') AS page_path,
      (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location') AS page_location,
      (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_title') AS page_title
    FROM %TABLE%
    WHERE ${suffixFilter}
      AND event_name = 'page_view'
  `;
  const buildQuery = (useIntraday) => {
    const conversionsSql = useIntraday
      ? `${baseConversions.replace('%TABLE%', tableRef)} UNION ALL ${baseConversions.replace('%TABLE%', intradayRef)}`
      : baseConversions.replace('%TABLE%', tableRef);
    const pageviewsSql = useIntraday
      ? `${basePageviews.replace('%TABLE%', tableRef)} UNION ALL ${basePageviews.replace('%TABLE%', intradayRef)}`
      : basePageviews.replace('%TABLE%', tableRef);
    return `
      WITH conversions AS (${conversionsSql}),
      pageviews AS (${pageviewsSql})
      SELECT
        c.event_name,
        c.event_ts,
        c.user_pseudo_id,
        c.ga_session_id,
        c.source,
        c.medium,
        c.campaign,
        ARRAY_AGG(COALESCE(p.page_path, REGEXP_EXTRACT(p.page_location, r'https?://[^/]+(/[^?#]*)')) ORDER BY p.event_ts) AS paths,
        (ARRAY_AGG(COALESCE(p.page_path, REGEXP_EXTRACT(p.page_location, r'https?://[^/]+(/[^?#]*)')) ORDER BY p.event_ts))[SAFE_OFFSET(0)] AS landing_path,
        (ARRAY_AGG(p.page_title ORDER BY p.event_ts))[SAFE_OFFSET(0)] AS landing_title
      FROM conversions c
      LEFT JOIN pageviews p
        ON c.user_pseudo_id = p.user_pseudo_id
       AND c.ga_session_id = p.ga_session_id
      GROUP BY event_name, event_ts, user_pseudo_id, ga_session_id, source, medium, campaign
    `;
  };
  const includeIntraday = CONFIG.BQ_USE_INTRADAY;

  try {
    let queryResults = BigQuery.Jobs.query({ query: buildQuery(includeIntraday), useLegacySql: false }, projectId);
    const jobId = queryResults.jobReference.jobId;

    while (!queryResults.jobComplete) {
      Utilities.sleep(1000);
      queryResults = BigQuery.Jobs.getQueryResults(projectId, jobId);
    }

    let rows = queryResults.rows || [];
    let pageToken = queryResults.pageToken;
    while (pageToken) {
      const page = BigQuery.Jobs.getQueryResults(projectId, jobId, { pageToken: pageToken });
      if (page.rows && page.rows.length > 0) rows = rows.concat(page.rows);
      pageToken = page.pageToken;
    }

    return rows.map(row => {
      const f = row.f;
      const eventName = f[0].v || '';
      const eventTs = f[1].v ? new Date(f[1].v) : null;
      const source = f[4].v || '';
      const medium = f[5].v || '';
      const campaign = f[6].v || '';
      const paths = parseBqArray(f[7]);
      const landingPath = f[8].v || '';
      const landingTitle = f[9].v || '';

      return {
        eventName: eventName,
        timestamp: eventTs || new Date(),
        source: source,
        medium: medium,
        campaign: campaign,
        landingPath: landingPath,
        pagePath: landingPath,
        paths: paths,
        pageTitle: landingTitle
      };
    });
  } catch (e) {
    const message = e && e.message ? e.message : '';
    if (includeIntraday && message.includes('events_intraday')) {
      console.warn('BigQuery intraday table not found. Retrying without intraday tables.');
      try {
        let queryResults = BigQuery.Jobs.query({ query: buildQuery(false), useLegacySql: false }, projectId);
        const jobId = queryResults.jobReference.jobId;

        while (!queryResults.jobComplete) {
          Utilities.sleep(1000);
          queryResults = BigQuery.Jobs.getQueryResults(projectId, jobId);
        }

        let rows = queryResults.rows || [];
        let pageToken = queryResults.pageToken;
        while (pageToken) {
          const page = BigQuery.Jobs.getQueryResults(projectId, jobId, { pageToken: pageToken });
          if (page.rows && page.rows.length > 0) rows = rows.concat(page.rows);
          pageToken = page.pageToken;
        }

        return rows.map(row => {
          const f = row.f;
          const eventName = f[0].v || '';
          const eventTs = f[1].v ? new Date(f[1].v) : null;
          const source = f[4].v || '';
          const medium = f[5].v || '';
          const campaign = f[6].v || '';
          const paths = parseBqArray(f[7]);
          const landingPath = f[8].v || '';
          const landingTitle = f[9].v || '';

          return {
            eventName: eventName,
            timestamp: eventTs || new Date(),
            source: source,
            medium: medium,
            campaign: campaign,
            landingPath: landingPath,
            pagePath: landingPath,
            paths: paths,
            pageTitle: landingTitle
          };
        });
      } catch (retryError) {
        console.error('BigQuery Fetch Error (no intraday):', retryError);
        return [];
      }
    }
    console.error('BigQuery Fetch Error:', e);
    return [];
  }
}

function parseBqArray(field) {
  if (!field || !field.v || !Array.isArray(field.v)) return [];
  return field.v.map(item => item.v).filter(v => v !== null && v !== undefined && v !== '');
}

function extractPathFromUrl_(url) {
  if (!url) return '';
  const match = url.match(/^https?:\/\/[^/]+(\/[^?#]*)/i);
  return match ? match[1] : '';
}

/**
 * GA4からセッション内のページビュー経路を取得する
 */
function fetchGa4PageViewsForUserIds(userIds, daysAgo) {
  // GA4 Data API は使用しない（BigQuery連携に切り替え済み）
  console.log('GA4 Data API is disabled. Use BigQuery export instead.');
  return {};

  if (!userIds || userIds.length === 0) return {};

  const propertyId = `properties/${CONFIG.GA4_PROPERTY_ID}`;
  const maxUserIds = 200; // inListFilterの上限対策
  const limitedUserIds = userIds.slice(0, maxUserIds);

  try {
    const res = AnalyticsData.Properties.runReport(
      {
        dateRanges: [{ startDate: `${daysAgo}daysAgo`, endDate: 'today' }],
        dimensions: [
          { name: 'userPseudoId' },
          { name: 'dateHourMinute' },
          { name: 'pagePathPlusQueryString' }
        ],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: {
          andGroup: {
            expressions: [
              {
                filter: {
                  fieldName: 'eventName',
                  stringFilter: { value: 'page_view', matchType: 'EXACT' }
                }
              },
              {
                filter: {
                  fieldName: 'userPseudoId',
                  inListFilter: {
                    values: limitedUserIds,
                    caseSensitive: true
                  }
                }
              }
            ]
          }
        }
      },
      propertyId
    );

    if (!res.rows) return {};

    const byUser = {};
    res.rows.forEach(row => {
      const dims = row.dimensionValues;
      const userId = dims[0].value;
      const dhm = dims[1].value;
      const path = dims[2].value;

      const year = parseInt(dhm.substring(0, 4));
      const month = parseInt(dhm.substring(4, 6)) - 1;
      const day = parseInt(dhm.substring(6, 8));
      const hour = parseInt(dhm.substring(8, 10));
      const minute = parseInt(dhm.substring(10, 12));
      const ts = new Date(year, month, day, hour, minute);

      if (!byUser[userId]) byUser[userId] = [];
      byUser[userId].push({ ts: ts, path: path });
    });

    const orderedPathsByUser = {};
    Object.keys(byUser).forEach(userId => {
      const items = byUser[userId]
        .sort((a, b) => a.ts.getTime() - b.ts.getTime())
        .map(i => i.path)
        .filter(p => p);

      orderedPathsByUser[userId] = items;
    });

    return orderedPathsByUser;
  } catch (e) {
    console.error('GA4 Fetch PageViews Error:', e);
    return {};
  }
}

function dedupeAdjacent(items) {
  const deduped = [];
  items.forEach(item => {
    if (deduped[deduped.length - 1] !== item) deduped.push(item);
  });
  return deduped;
}

/**
 * 資料種別文字列をGA4イベント名に変換
 */
function mapDocumentTypeToEventName(docType) {
  const targets = [];

  // ポジショニングメディア (Z-WPも同義として扱う)
  if (docType.includes('ポジショニングメディア') || docType.includes('Z-WP')) {
    if (docType.includes('資料DL')) targets.push('positioningmedia_dl');
    if (docType.includes('お問い合わせ') || docType.includes('問い合わせ')) targets.push('positioningmedia_inquiry');
  }

  // ブランディングメディア
  if (docType.includes('ブランディングメディア')) {
    if (docType.includes('資料DL')) targets.push('branding_media_dl');
    if (docType.includes('お問い合わせ') || docType.includes('問い合わせ')) targets.push('inquiry');
  }

  // キャククル（Z-CIN/Z-KIN）系: 問い合わせ/掲載/資料DLをキャククル系CVに寄せる
  if (docType.includes('キャククル')) {
    if (
      docType.includes('資料DL') ||
      docType.includes('掲載') ||
      docType.includes('お問い合わせ') ||
      docType.includes('問い合わせ')
    ) {
      targets.push('clt_thanks'); // 代表のCVイベント
      targets.push('inquiry');    // フォールバック
    }
  }

  // 一般的な問い合わせ（サービス不明でも拾う）
  if (docType.includes('お問い合わせ') || docType.includes('問い合わせ')) {
    targets.push('inquiry');
  }

  if (targets.length === 0) return null;
  return Array.from(new Set(targets));
}

/**
 * 件名から資料種別を抽出
 */
function extractDocumentType(subject, body) {
  const combined = [subject, body].filter(Boolean).join('\n');
  if (!combined) {
    // console.warn('extractDocumentType: subject is empty or undefined');
    return '不明';
  }

  if (combined.includes('【キャククル】Zenkenメディア制作事例ページの訪問がありました')) {
    return 'メディア制作事例閲覧';
  }
  if (combined.includes('PM資料をDLしたユーザーが繰り返し事例コンテンツを閲覧しました')) {
    return '事例記事再閲覧';
  }
  if (combined.includes('「ポジショニングメディア問い合わせページ」への訪問がありました')) {
    return 'ポジショニングメディア｜問い合わせページ訪問';
  }
  if (combined.includes('【キャククル】ブランディングメディアフォームページへの訪問がありました')) {
    return 'キャククル｜ブランディングメディアフォーム訪問';
  }
  if (combined.includes('「ポジショニングメディアフォーム」の訪問がありました')) {
    return 'ポジショニングメディア｜フォーム訪問';
  }
  if (combined.includes('「ポジショニングメディア資料DLフォーム」の訪問がありました')) {
    return 'ポジショニングメディア｜資料DLフォーム訪問';
  }

  let service = '';
  // Z-WP: ポジショニングメディア, Z-CIN/Z-KIN: キャククル
  if (combined.includes('ポジショニングメディア') || combined.includes('Z-WP')) {
    service = 'ポジショニングメディア';
  } else if (combined.includes('ブランディングメディア')) {
    service = 'ブランディングメディア';
  } else if (combined.includes('キャククル') || combined.includes('Z-CIN') || combined.includes('Z-KIN')) {
    service = 'キャククル';
  }

  let type = '';
  if (combined.includes('お問い合わせ') || combined.includes('問い合わせ') || combined.includes('問合せ') || combined.includes('コンタクト')) {
    type = 'お問い合わせ';
  } else if (combined.includes('掲載')) {
    type = '掲載依頼';
  } else if (combined.includes('ダウンロード') || combined.includes('資料')) {
    type = '資料DL';
  }

  if (service === 'キャククル' && type === '資料DL' && combined.includes('リード獲得サービス紹介資料')) {
    return 'キャククル掲載';
  }

  if (service && type) {
    return `${service}（${type}）`;
  } else if (service) {
    return `${service}（その他）`;
  } else if (type) {
    return type;
  } else {
    // サービス不明だがタイプはわかる場合
    // 例: 資料DLのみ
    return type;
  }
}

/**
 * 件名からニーズ顕在度を判定（Z-WPかつ特定文言で高）
 */
function classifyNeedLevel(subject) {
  if (!subject) return 'ニーズ低';
  const hasInquiry = subject.includes('お問い合わせ') || subject.includes('問い合わせ') || subject.includes('問合せ');
  if (hasInquiry) return 'ニーズ高';
  const hasZWp = subject.includes('Z-WP');
  const highKeywords = ['ポジショニングメディア', 'ブランディングメディア', 'キャククル', '掲載'];
  const hasHigh = highKeywords.some(k => subject.includes(k));
  return hasZWp && hasHigh ? 'ニーズ高' : 'ニーズ低';
}

/**
 * 件名から担当者を判定
 */
function determineAssignee(subject) {
  if (!subject) return '室野井・村松';
  if (
    subject.includes('問い合わせフォームに到達しました') ||
    subject.includes('問合せフォームに到達しました') ||
    subject.includes('問い合わせフォームに訪問しました') ||
    subject.includes('問合せフォームに訪問しました')
  ) {
    return '園部・室野井・村松';
  }
  if (
    subject.includes('【キャククル】Zenkenメディア制作事例ページの訪問がありました') ||
    subject.includes('PM資料をDLしたユーザーが繰り返し事例コンテンツを閲覧しました') ||
    subject.includes('「ポジショニングメディア問い合わせページ」への訪問がありました') ||
    subject.includes('【キャククル】ブランディングメディアフォームページへの訪問がありました') ||
    subject.includes('「ポジショニングメディアフォーム」の訪問がありました') ||
    subject.includes('「ポジショニングメディア資料DLフォーム」の訪問がありました')
  ) {
    return '室野井・村松';
  }
  if (subject.includes('SEO') || subject.includes('コンテンツ')) {
    return '石黒（SEO）';
  }
  if (subject.includes('【Z-CIN：問い合わせ】キャククル経緯でお問い合わせがありました【Zenken株式会社】')) {
    return '園部・室野井・村松';
  }
  return subject.includes('キャククル') ? '園部（キャククル想定）' : '室野井・村松';
}

/**
 * 件名から送信先Chat Webhookを決定
 */
function resolveChatWebhookUrl(subject) {
  if (
    subject &&
    (
      subject.includes('【キャククル】Zenkenメディア制作事例ページの訪問がありました') ||
      subject.includes('PM資料をDLしたユーザーが繰り返し事例コンテンツを閲覧しました') ||
      subject.includes('「ポジショニングメディア問い合わせページ」への訪問がありました') ||
      subject.includes('【キャククル】ブランディングメディアフォームページへの訪問がありました') ||
      subject.includes('「ポジショニングメディアフォーム」の訪問がありました') ||
      subject.includes('「ポジショニングメディア資料DLフォーム」の訪問がありました')
    )
  ) {
    return CONFIG.CHAT_WEBHOOK_URL_OTHERS;
  }
  if (subject && subject.includes('【Z-CIN：問い合わせ】キャククル経緯でお問い合わせがありました【Zenken株式会社】')) {
    return CONFIG.CHAT_WEBHOOK_URL_OTHERS;
  }
  if (subject && subject.includes('キャククル') && CONFIG.CHAT_WEBHOOK_URL_CUCKOOL) {
    return CONFIG.CHAT_WEBHOOK_URL_CUCKOOL;
  }
  if (CONFIG.CHAT_WEBHOOK_URL_OTHERS) {
    return CONFIG.CHAT_WEBHOOK_URL_OTHERS;
  }
  return CONFIG.CHAT_WEBHOOK_URL;
}

function getSalesSheet() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SALES_SHEET_NAME);
  if (!sheet) {
    console.log(`Sales sheet not found: ${CONFIG.SALES_SHEET_NAME}`);
    return null;
  }
  return sheet;
}

function getLeadsSheet() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.LEADS_SHEET_NAME);
  if (!sheet) {
    console.log(`Leads sheet not found: ${CONFIG.LEADS_SHEET_NAME}`);
    return null;
  }
  return sheet;
}

function ensureSalesHeaders_(sheet) {
  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) {
    sheet.appendRow(SALES_HEADERS);
    return SALES_HEADERS;
  }
  let headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const hubspotIdx = headers.indexOf('hubspot URL');
  const statusIdx = headers.indexOf('対応ステータス');
  if (hubspotIdx === -1) {
    if (statusIdx !== -1) {
      sheet.insertColumnsAfter(statusIdx + 1, 1);
      sheet.getRange(1, statusIdx + 2).setValue('hubspot URL');
      headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    } else {
      const nextActionIdx = headers.indexOf('ネクストアクション');
      if (nextActionIdx !== -1) {
        sheet.insertColumnsBefore(nextActionIdx + 1, 1);
        sheet.getRange(1, nextActionIdx + 1).setValue('hubspot URL');
        headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      }
    }
  }
  return headers;
}

function getSalesHeaderIndex_(headers, name) {
  const idx = headers.indexOf(name);
  return idx >= 0 ? idx : -1;
}

function appendToSalesSheet_(sheet, headers, payload) {
  const row = new Array(headers.length).fill('');
  const setVal = (name, value) => {
    const idx = getSalesHeaderIndex_(headers, name);
    if (idx >= 0) row[idx] = value;
  };

  setVal('lead_id', payload.leadId);
  setVal('message_id', payload.messageId);
  setVal('受信日時', payload.date);
  setVal('種別', payload.docType);
  setVal('法人名', payload.company);
  setVal('氏名', payload.name);
  setVal('Email', payload.email);
  setVal('電話番号', payload.phone);
  setVal('役職', payload.position);
  setVal('業種', payload.industry);
  setVal('従業員数', payload.employees);
  setVal('売上', payload.revenue);
  setVal('URL', payload.url);
  setVal('広告予算', payload.adBudget);
  setVal('施策タイミング', payload.timing);
  setVal('メール本文', payload.body);
  setVal('訪問ページ', '');
  setVal('対応者', payload.assignee);

  sheet.appendRow(row);
}

function buildRowIndexByMessageId_(sheet, messageIdIdx) {
  const data = sheet.getDataRange().getValues();
  const map = {};
  if (data.length <= 1) return map;
  for (let i = 1; i < data.length; i++) {
    const messageId = data[i][messageIdIdx];
    if (messageId) {
      map[messageId] = i + 1;
    }
  }
  return map;
}

function updateSalesGaFields_(sheet, headers, rowNum, payload) {
  const setVal = (name, value) => {
    const idx = getSalesHeaderIndex_(headers, name);
    if (idx >= 0) sheet.getRange(rowNum, idx + 1).setValue(value);
  };

  setVal('GA_Source', payload.source || '');
  setVal('GA_Medium', payload.medium || '');
  setVal('GA_Campaign', payload.campaign || '');
  setVal('GA_LandingPage', payload.landingPath || '');
  setVal('GA_PageTitle', payload.pageTitle || '');
  setVal('訪問ページ', payload.landingPath || '');

  const pathCols = [
    'GA_PagePath1', 'GA_PagePath2', 'GA_PagePath3', 'GA_PagePath4', 'GA_PagePath5',
    'GA_PagePath6', 'GA_PagePath7', 'GA_PagePath8', 'GA_PagePath9', 'GA_PagePath10'
  ];
  pathCols.forEach((name, i) => {
    if (payload.paths && payload.paths.length > 0) {
      setVal(name, payload.paths[i] || '');
    }
  });
}

function getHeaderIndex(headers, name, fallbackIndex) {
  const idx = headers.indexOf(name);
  if (idx >= 0) return idx;
  if (typeof fallbackIndex === 'number') return fallbackIndex;
  return -1;
}

function ensureSalesAssigneeValidation(sheet) {
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['室野井', '村松', '園部'], true)
    .setAllowInvalid(true)
    .build();
  const maxRows = sheet.getMaxRows();
  if (maxRows < 2) return;
  sheet.getRange(2, 18, maxRows - 1, 1).setDataValidation(rule);
}

function ensureSalesAlertColumn(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (headers.indexOf('アラート送信済') === -1) {
    const lastCol = sheet.getLastColumn() + 1;
    sheet.insertColumnAfter(sheet.getLastColumn());
    sheet.getRange(1, lastCol).setValue('アラート送信済');
  }
}

function normalizeDate(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function resolveAlertChatWebhooks() {
  const configured = (CONFIG.ALERT_CHAT_WEBHOOK_URLS || []).filter(url => url);
  if (configured.length > 0) return configured;
  const fallback = CONFIG.CHAT_WEBHOOK_URL_OTHERS || CONFIG.CHAT_WEBHOOK_URL;
  return fallback ? [fallback] : [];
}

function resolveBqTableSuffix() {
  if (CONFIG.BQ_TABLE_SUFFIX) return CONFIG.BQ_TABLE_SUFFIX;
  const tz = Session.getScriptTimeZone();
  return Utilities.formatDate(new Date(), tz, 'yyyyMMdd');
}

/**
 * フォーム由来のスパム/重複問い合わせを判定する
 */
function isLikelyFormSpam(body) {
  if (!body) return false;
  const requiredMarkers = [
    'お名前:', 'メールアドレス:', '法人名:', '業種:', '役職:',
    '従業員数:', '売上:', 'TEL:', '詳しい内容（任意）:'
  ];
  const hasAllMarkers = requiredMarkers.every(m => body.includes(m));
  if (!hasAllMarkers) return false;
  // 同一フォーム項目が複数回出現する場合は自動入力/重複の可能性が高い
  const nameCount = (body.match(/お名前:/g) || []).length;
  const emailCount = (body.match(/メールアドレス:/g) || []).length;
  return nameCount >= 2 || emailCount >= 2;
}

/**
 * スプレッドシートのヘッダーを確認し、必要なカラムがなければ追加する
 */
function checkAndUpdateHeaders(sheet) {
  const gaColumns = [
    'GA_Source', 'GA_Medium', 'GA_Campaign',
    'GA_LandingPage', 'GA_PageTitle',
    'Inferred_Factors', 'Inferred_Hypothesis',
    'GA_PagePath1', 'GA_PagePath2', 'GA_PagePath3', 'GA_PagePath4', 'GA_PagePath5',
    'GA_PagePath6', 'GA_PagePath7', 'GA_PagePath8', 'GA_PagePath9', 'GA_PagePath10'
  ];
  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) {
    sheet.appendRow([
      'lead_id', 'message_id', 
      '受信日時', 'ニーズ顕在度', '件名', '担当者', '法人名', '氏名', 'Email', '電話番号', 
      '役職', '業種', '従業員数', '売上', 'URL', '広告予算', 
      '施策タイミング', 'Web集客の相談をする', '資料種別', '資料URL', '本文', '詳しい内容', 'ステータス', 'アラート送信済',
      ...gaColumns
    ]);
    return;
  }

  // 現在の全ヘッダー取得
  let headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  // 1. ID列の確認と追加
  if (headers[0] !== 'lead_id') {
    console.log('Updating Headers: Inserting lead_id and message_id columns');
    sheet.insertColumnsBefore(1, 2); // 先頭に2列挿入
    sheet.getRange(1, 1, 1, 2).setValues([['lead_id', 'message_id']]);
    // ヘッダーが変わったので再取得
    headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  }

  // 1.5 ニーズ顕在度の確認と追加（件名の左に挿入）
  const subjectIdx = headers.indexOf('件名');
  const needIdx = headers.indexOf('ニーズ顕在度');
  if (subjectIdx !== -1 && needIdx === -1) {
    console.log('Updating Headers: Inserting ニーズ顕在度 column before 件名');
    sheet.insertColumnsBefore(subjectIdx + 1, 1);
    sheet.getRange(1, subjectIdx + 1).setValue('ニーズ顕在度');
    headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  }

  // 1.6 担当者列の確認と追加（件名の右に挿入）
  const assigneeIdx = headers.indexOf('担当者');
  const subjectIdxAfter = headers.indexOf('件名');
  if (subjectIdxAfter !== -1 && assigneeIdx === -1) {
    console.log('Updating Headers: Inserting 担当者 column after 件名');
    sheet.insertColumnsAfter(subjectIdxAfter + 1, 1);
    sheet.getRange(1, subjectIdxAfter + 2).setValue('担当者');
    headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  }

  // 2. 資料URL列の確認と追加
  const bodyIndex = headers.indexOf('本文');
  const docUrlIndex = headers.indexOf('資料URL');

  if (bodyIndex !== -1 && docUrlIndex === -1) {
    console.log('Updating Headers: Inserting 資料URL column');
    // "本文"カラムの前に挿入 (bodyIndexは0始まり、insertColumnsBeforeは1始まりなので +1)
    sheet.insertColumnsBefore(bodyIndex + 1, 1);
    sheet.getRange(1, bodyIndex + 1).setValue('資料URL');
    // ヘッダー更新
    headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  }

  // 2.2 Web集客の相談をする列の確認と追加（施策タイミングの右に挿入）
  const timingIdx = headers.indexOf('施策タイミング');
  const webConsultIdx = headers.indexOf('Web集客の相談をする');
  if (timingIdx !== -1 && webConsultIdx === -1) {
    console.log('Updating Headers: Inserting Web集客の相談をする column after 施策タイミング');
    sheet.insertColumnsAfter(timingIdx + 1, 1);
    sheet.getRange(1, timingIdx + 2).setValue('Web集客の相談をする');
    headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  }

  // 2.5 アラート送信済列の確認と追加（ステータスの右に挿入）
  const statusIdx = headers.indexOf('ステータス');
  const alertIdx = headers.indexOf('アラート送信済');
  if (statusIdx !== -1 && alertIdx === -1) {
    console.log('Updating Headers: Inserting アラート送信済 column after ステータス');
    sheet.insertColumnsAfter(statusIdx + 1, 1);
    sheet.getRange(1, statusIdx + 2).setValue('アラート送信済');
    headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  }

  // 2.6 詳しい内容列の確認と追加（本文の右に挿入）
  const detailIdx = headers.indexOf('詳しい内容');
  const bodyIdx = headers.indexOf('本文');
  if (bodyIdx !== -1 && detailIdx === -1) {
    console.log('Updating Headers: Inserting 詳しい内容 column after 本文');
    sheet.insertColumnsAfter(bodyIdx + 1, 1);
    sheet.getRange(1, bodyIdx + 2).setValue('詳しい内容');
    headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  }
  
  // 3. GA4カラムの追加 (存在しなければ末尾に追加)
  // まだ存在しないカラムだけをフィルタリング
  const missingCols = gaColumns.filter(col => headers.indexOf(col) === -1);
  
  if (missingCols.length > 0) {
    console.log(`Adding missing GA4 columns: ${missingCols.join(', ')}`);
    // 末尾に追加
    const startCol = sheet.getLastColumn() + 1;
    sheet.getRange(1, startCol, 1, missingCols.length).setValues([missingCols]);
  }
}


/**
 * トリガーを設定する関数
 * これを1回実行すると、processInboxが15分ごとに実行されるようになります
 */
function setupTrigger() {
  const functionName = 'processInbox';
  
  // 既存のトリガーを削除（重複防止）
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === functionName) {
      ScriptApp.deleteTrigger(trigger);
    }
  }

  // 新しいトリガーを作成（15分ごと）
  ScriptApp.newTrigger(functionName)
    .timeBased()
    .everyMinutes(15)
    .create();
    
  console.log('Trigger setup complete: processInbox (every 15 mins)');
}

// 通常実行用: 直近2日間の未読メールのみを対象にする（古い未読メールの誤取得防止）
function processInbox() {
  // CONFIG.SEARCH_QUERY に期間制限を追加して実行
  const query = `${CONFIG.SEARCH_QUERY} newer_than:2d`;
  processEmails(query);
}

// バックフィル用: 過去1ヶ月分のデータを取得する関数（手動実行用）
function processBackfillMonth() {
  // "newer_than:30d" で過去30日分を検索（未読・既読問わず）
  const query = `newer_than:30d ${CONFIG.SEARCH_QUERY}`;
  processEmails(query);
}

// 本日分の再処理用（未読・既読問わず）
function processBackfillToday() {
  const query = `${CONFIG.SEARCH_QUERY} newer_than:1d`;
  processEmails(query);
}

function processEmails(query) {
  const threads = GmailApp.search(query);
  const sheet = getLeadsSheet();
  if (!sheet) return;
  
  // ヘッダーの確認と自動更新（ID列などの追加）
  checkAndUpdateHeaders(sheet);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const statusColIdx = headers.indexOf('ステータス');

  // 既存のMessage-IDを取得して重複チェック用セットを作成
  const existingMessageIds = new Set();
  const data = sheet.getDataRange().getValues();
  // ヘッダー行(index 0)があるので、データはindex 1から
  // message_idはB列(index 1)にあるはず（checkAndUpdateHeadersで保証）
  if (data.length > 1) {
    for (let i = 1; i < data.length; i++) {
      // B列がmessage_id
      existingMessageIds.add(data[i][1]);
    }
  }

  // ラベル取得または作成
  let label = GmailApp.getUserLabelByName(CONFIG.PROCESSED_LABEL);
  if (!label) {
    label = GmailApp.createLabel(CONFIG.PROCESSED_LABEL);
  }

  console.log(`検索クエリ: ${query}`);
  console.log(`検索結果: ${threads.length} スレッド`);

  let processedCount = 0;
  let skippedCount = 0;
  let duplicateCount = 0;

  for (const thread of threads) {
    const messages = thread.getMessages();
    for (const message of messages) {
      const messageId = message.getId(); // Gmail固有のメッセージID

      // 重複チェック: すでにシートにある場合はスキップ
      if (existingMessageIds.has(messageId)) {
        console.log(`Skipped (Duplicate): ${messageId}`);
        duplicateCount++;
        continue;
      }

      // 未読チェックはprocessInboxの場合のみ必要だが、
      // processPastWeekの場合は既読も含めて処理するため、ここでは除外しない
      // ただし、すでに処理済みラベルがついているものはスキップしてもよい
      // 今回はMessage-IDで重複チェックしているのでラベルチェックは補助的

      const body = message.getPlainBody();
      const subject = message.getSubject();
      const date = message.getDate();
      const from = message.getFrom();

      console.log(`処理中: ${subject} from ${from}`);
      // デバッグ用: 本文の先頭500文字を出力してフォーマットを確認
      console.log(`Body Preview: ${body.substring(0, 500)}`);

      let shouldSkip = false;

      // 1. 送信者による除外チェック
      for (const senderKeyword of CONFIG.EXCLUDE_SENDERS) {
        if (from.includes(senderKeyword)) {
          console.log(`Skipped (Sender): Contains ${senderKeyword}`);
          shouldSkip = true;
          break;
        }
      }

      // 2. 件名による除外チェック
      if (!shouldSkip) {
        for (const keyword of CONFIG.EXCLUDE_SUBJECT_KEYWORDS) {
          if (subject.includes(keyword)) {
            console.log(`Skipped (Subject): Contains ${keyword}`);
            shouldSkip = true;
            break;
          }
        }
      }

      // 3. 本文による除外チェック
      if (!shouldSkip) {
        for (const keyword of CONFIG.EXCLUDE_KEYWORDS) {
          if (body.includes(keyword)) {
            console.log(`Skipped (Body): Contains ${keyword}`);
            shouldSkip = true;
            break;
          }
        }
      }

      // 3.5 フォーム由来のスパム/重複問い合わせを除外
      if (!shouldSkip && isLikelyFormSpam(body)) {
        console.log('Skipped (Body): Likely form spam/duplicate inquiry');
        shouldSkip = true;
      }

      if (shouldSkip) {
        // processInbox（未読のみ対象）の場合は既読にするが、
        // 過去分取得の場合はステータス変更しない方が安全かもしれない
        // ここでは一律既読にはせず、スキップのみにする（運用に合わせて変更可）
        skippedCount++;
        continue;
      }

      // 抽出ロジック
      const extracted = extractInfo(body);
      
      // 件名から資料種別を抽出
      const documentType = extractDocumentType(subject, body);
      
      // UUID生成
      const leadId = Utilities.getUuid();
      const assignee = determineAssignee(subject);

      // 1. スプレッドシートに保存（ID列追加）
      sheet.appendRow([
        leadId,
        messageId,
        date,
        classifyNeedLevel(subject),
        subject,
        assignee,
        extracted.company,
        extracted.name,
        extracted.email,
        extracted.phone,
        extracted.position,
        extracted.industry,
        extracted.employees,
        extracted.revenue,
        extracted.url,
        extracted.adBudget,
        extracted.timing,
        extracted.webConsult,
        documentType,
        extracted.documentUrl,
        body,
        extracted.detail,
        'Pending'
      ]);
      processedCount++;

      // 1.1 営業用シートへ同時転記
      const salesSheet = getSalesSheet();
      if (salesSheet) {
        const salesHeaders = ensureSalesHeaders_(salesSheet);
        appendToSalesSheet_(
          salesSheet,
          salesHeaders,
          {
            leadId: leadId,
            messageId: messageId,
            date: date,
            docType: documentType,
            company: extracted.company,
            name: extracted.name,
            email: extracted.email,
            phone: extracted.phone,
            position: extracted.position,
            industry: extracted.industry,
            employees: extracted.employees,
            revenue: extracted.revenue,
            url: extracted.url,
            adBudget: extracted.adBudget,
            timing: extracted.timing,
            body: body,
            assignee: assignee
          }
        );
      }

        // 2. Backendへ送信
        try {
          const payload = {
            lead_id: leadId, // IDも送信
            message_id: messageId,
            timestamp: date,
            subject: subject,
            body: body,
            documentType: documentType,
            assignee: assignee,
            ...extracted,
            sheetUrl: sheet.getParent().getUrl(),
            sheetId: sheet.getSheetId(),
            rowNum: sheet.getLastRow()
          };
          
          sendToBackend(payload);
          // ステータス列に送信結果を反映
          if (statusColIdx >= 0) {
            sheet.getRange(sheet.getLastRow(), statusColIdx + 1).setValue('Sent to Backend');
          }
          
          // 3. Chatへ通知 (Backend送信成功時のみ)
          sendToChat(payload);
          
        } catch (e) {
          console.error('Backend Error', e);
          if (statusColIdx >= 0) {
            sheet.getRange(sheet.getLastRow(), statusColIdx + 1).setValue('Error: ' + e.message);
          }
        }

        // 4. 既読にしてラベル付け
        message.markRead();
        thread.addLabel(label);
        
        // 処理済みIDリストに追加（同一実行内での重複防止）
        existingMessageIds.add(messageId);
      }
    }
 
  console.log(`Processed: ${processedCount}, Skipped: ${skippedCount}, Duplicates: ${duplicateCount}`);
}

function extractInfo(body) {
  if (!body) {
    console.warn('extractInfo: body is empty or undefined');
    body = '';
  }

  const normalizedBody = body
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u3000/g, ' ')
    .replace(/[ \t]+/g, ' ');

  console.log('Normalized Body Preview:', normalizedBody.substring(0, 500));

  const labelTokens = [
    'お名前', '氏名', 'ご担当者名', 'Name', '名前',
    'メールアドレス', 'E-mail', 'Email', 'MAIL', 'mail', 'Eメール',
    '法人名', '会社名', '貴社名', '企業名', 'Company', '社名',
    '業種', '業界', 'Industry',
    '役職', '役職1', '役職 1', '役職１', '役職2', '役職 2', '役職２', '職位', '肩書', 'Position', 'Title',
    '従業員数', '社員数', '人数',
    '売上', '売上高', '年商',
    'TEL', '電話番号', '電話', '携帯電話', '携帯', 'Phone', 'Tel', 'tel',
    '貴社サイトのURL', 'URL', 'ホームページ', 'HP', 'サイトURL', 'Webサイト',
    '月毎の広告予算', '広告予算', '予算',
    '施策導入タイミング', '施策検討タイミング', '導入タイミング', '検討時期',
    'Web集客の相談をする', 'Web集客の相談',
    '詳しい内容（任意）', '詳しい内容'
  ];

  const normalizeLabel = (label) => (
    label
      .toString()
      .replace(/[：:]/g, '')
      .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
      .replace(/\s+/g, '')
      .replace(/　/g, '')
      .toLowerCase()
  );

  const trimAtNextLabel = (value) => {
    let earliest = -1;
    labelTokens.forEach(label => {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\s*${escaped}\\s*[:：]`, 'i');
      const idx = value.search(regex);
      if (idx >= 0 && (earliest === -1 || idx < earliest)) {
        earliest = idx;
      }
    });
    return earliest >= 0 ? value.slice(0, earliest).trim() : value.trim();
  };

  const cleanValue = (value) => {
    if (!value) return '';
    const cleaned = value
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/[ \t]+/g, ' ')
      .trim();
    return trimAtNextLabel(cleaned);
  };

  const labelValueMap = {};
  normalizedBody.split('\n').forEach(line => {
    const pairRegex = /([^:：\n]+?)\s*[:：]\s*([^:：\n]+?)(?=(?:\s+[^:：\n]+?\s*[:：])|$)/g;
    let match;
    while ((match = pairRegex.exec(line)) !== null) {
      const rawKey = match[1].trim();
      const rawValue = match[2];
      if (!rawKey || !rawValue) continue;
      const normalizedKey = normalizeLabel(rawKey);
      if (!labelValueMap[normalizedKey]) {
        labelValueMap[normalizedKey] = cleanValue(rawValue);
      }
    }
  });

  const getValueMultiple = (keys) => {
    for (const key of keys) {
      const normalizedKey = normalizeLabel(key);
      if (labelValueMap[normalizedKey]) {
        console.log(`Matched (Map) ${key}: ${labelValueMap[normalizedKey]}`);
        return labelValueMap[normalizedKey];
      }
      const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      const regexInline = new RegExp(`${escapedKey}\\s*[:：]?\\s*(.+?)(?:\\n|$)`, 'im');
      const matchInline = normalizedBody.match(regexInline);
      if (matchInline && matchInline[1].trim() && matchInline[1].trim() !== key) {
        const cleanedInline = cleanValue(matchInline[1]);
        console.log(`Matched (Inline) ${key}: ${cleanedInline}`);
        return cleanedInline;
      }

      const regexNextLine = new RegExp(`${escapedKey}\\s*[:：]?\\s*\\n\\s*(.+?)(?:\\n|$)`, 'im');
      const matchNextLine = normalizedBody.match(regexNextLine);
      if (matchNextLine && matchNextLine[1].trim()) {
        const cleanedNext = cleanValue(matchNextLine[1]);
        console.log(`Matched (NextLine) ${key}: ${cleanedNext}`);
        return cleanedNext;
      }
    }
    return '';
  };

  const sanitizeTestValue = (value) => {
    if (!value) return '';
    return value.includes('テスト') ? '' : value;
  };

  const role1 = getValueMultiple(['役職1', '役職 1', '役職１']);
  const role2 = getValueMultiple(['役職2', '役職 2', '役職２']);
  const combinedRole = [role1, role2].filter(Boolean).join(' / ');

  const result = {
    name: sanitizeTestValue(getValueMultiple(['お名前', '氏名', 'ご担当者名', 'Name', '名前'])),
    email: getValueMultiple(['メールアドレス', 'E-mail', 'Email', 'MAIL', 'mail', 'Eメール']),
    company: sanitizeTestValue(getValueMultiple(['法人名', '会社名', '貴社名', '企業名', 'Company', '社名'])),
    industry: getValueMultiple(['業種', '業界', 'Industry']),
    position: getValueMultiple(['役職', '職位', '肩書', 'Position', 'Title']) || combinedRole,
    employees: getValueMultiple(['従業員数', '社員数', '人数']),
    revenue: getValueMultiple(['売上', '売上高', '年商']),
    phone: getValueMultiple(['TEL', '電話番号', '電話', '携帯電話', '携帯', 'Phone', 'Tel', 'tel']),
    url: getValueMultiple(['貴社サイトのURL', 'URL', 'ホームページ', 'HP', 'サイトURL', 'Webサイト']),
    adBudget: getValueMultiple(['月毎の広告予算', '広告予算', '予算']),
    timing: getValueMultiple(['施策導入タイミング', '施策検討タイミング', '導入タイミング', '検討時期']),
    webConsult: getValueMultiple(['Web集客の相談をする', 'Web集客の相談']),
    detail: getValueMultiple(['詳しい内容（任意）', '詳しい内容']),
    documentUrl: extractDocumentUrl(normalizedBody)
  };

  console.log('Extracted Data:', JSON.stringify(result));
  return result;
}

function sendToChat(data) {
  const webhookUrl = resolveChatWebhookUrl(data.subject);
  if (!webhookUrl || webhookUrl.includes('YOUR_SPACE_ID')) {
    console.log('Chat Webhook URL not set. Skipping notification.');
    return;
  }

  const getSheetRowData = () => {
    if (!data.sheetId || !data.rowNum) return {};
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheets().find(s => s.getSheetId() === data.sheetId);
    if (!sheet) return {};
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const row = sheet.getRange(data.rowNum, 1, 1, sheet.getLastColumn()).getValues()[0];
    const map = {};
    headers.forEach((h, i) => {
      map[h] = row[i];
    });
    return map;
  };

  const rowData = getSheetRowData();
  const normalizeValue = (value) => {
    if (!value) return '';
    return value.toString().replace(/<[^>]*>/g, '').trim();
  };
  const pick = (primary, headerNames) => {
    if (primary) return normalizeValue(primary);
    for (const name of headerNames) {
      if (rowData[name]) return normalizeValue(rowData[name]);
    }
    return '';
  };
  data.name = pick(data.name, ['氏名', 'お名前', 'ご担当者名']);
  data.company = pick(data.company, ['法人名', '会社名', '貴社名', '企業名']);
  data.email = pick(data.email, ['Email', 'メールアドレス']);
  data.phone = pick(data.phone, ['電話番号', 'TEL']);
  data.position = pick(data.position, ['役職']);
  data.industry = pick(data.industry, ['業界', '業種']);
  data.employees = pick(data.employees, ['従業員数']);
  data.revenue = pick(data.revenue, ['売上', '売上高', '年商']);
  data.adBudget = pick(data.adBudget, ['広告予算', '広告予算（月ごと）', '月毎の広告予算']);
  data.timing = pick(data.timing, ['施策導入タイミング', '導入タイミング', '施策タイミング']);
  data.webConsult = pick(data.webConsult, ['Web集客の相談をする']);
  data.detail = pick(data.detail, ['詳しい内容', '詳しい内容（任意）']);

  const truncateText = (text, maxLen) => {
    if (!text) return '';
    const trimmed = text.toString().trim();
    return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen)}...` : trimmed;
  };

  const assigneeDirectory = [
    { name: '室野井一真', id: '110980492970934847135', aliases: ['室野井'] },
    { name: '園部宏樹', id: '101824641850767635776', aliases: ['園部'] },
    { name: '村松千尋', id: '108455277578597920979', aliases: ['村松'] },
    { name: '石黒詩穂', id: '108258357470762123844', aliases: ['石黒'] }
  ];
  const assigneeMentions = [];
  const assigneeNames = [];
  const assigneeText = data.assignee || '';
  assigneeDirectory.forEach(entry => {
    const hit = [entry.name, ...entry.aliases].some(alias => assigneeText.includes(alias));
    if (hit) {
      assigneeMentions.push(`<users/${entry.id}>`);
      assigneeNames.push(entry.name);
    }
  });

  const cardSections = [
    {
      widgets: [
        { keyValue: { topLabel: '件名', content: data.subject || '-' } },
        { keyValue: { topLabel: '氏名', content: data.name || '-' } },
        { keyValue: { topLabel: '会社・法人名', content: data.company || '-' } },
        { keyValue: { topLabel: 'Email', content: data.email || '-' } },
        { keyValue: { topLabel: '電話番号', content: data.phone || '-' } },
        { keyValue: { topLabel: '役職', content: data.position || '-' } },
        { keyValue: { topLabel: '業界', content: data.industry || '-' } },
        { keyValue: { topLabel: '従業員数', content: data.employees || '-' } },
        { keyValue: { topLabel: '売上', content: data.revenue || '-' } },
        { keyValue: { topLabel: '広告予算（月ごと）', content: data.adBudget || '-' } },
        { keyValue: { topLabel: '施策タイミング', content: data.timing || '-' } },
        { keyValue: { topLabel: 'Web集客の相談をする', content: data.webConsult || '-' } },
        { keyValue: { topLabel: '詳しい内容', content: truncateText(data.detail, 400) || '-' } },
        { keyValue: { topLabel: '対応者', content: assigneeNames.length ? assigneeNames.join(' / ') : (data.assignee || '-') } },
        { keyValue: { topLabel: 'LPタイトル', content: data.pageTitle || '-' } },
        { keyValue: { topLabel: 'LP URL', content: data.landingPage || data.documentUrl || '-' } },
        { keyValue: { topLabel: '推察要因', content: (data.factors || []).join(', ') || '-' } },
        { keyValue: { topLabel: '仮説', content: data.hypothesis || '-' } }
      ]
    }
  ];

  const mentionLine = assigneeMentions.length ? `TO: ${assigneeMentions.join(' ')}` : '';
  const message = {
    text: `*【リード獲得】${data.documentType}*${mentionLine ? `\n${mentionLine}` : ''}`,
    cards: [
      {
        header: {
          title: data.company || '法人名不明',
          subtitle: data.name || '担当者名不明',
          imageUrl: 'https://www.gstatic.com/images/branding/product/2x/sheets_48dp.png'
        },
        sections: cardSections
      }
    ]
  };

  // ボタンは最後のセクションに追加
  const sheetUrl = data.sheetUrl || SpreadsheetApp.getActiveSpreadsheet().getUrl();
  const rowLink = (data.sheetId && data.rowNum)
    ? `${sheetUrl}#gid=${data.sheetId}&range=A${data.rowNum}`
    : sheetUrl;

  cardSections[cardSections.length - 1].widgets.push({
    buttons: [
      {
        textButton: {
          text: 'スプレッドシートを開く',
          onClick: {
            openLink: {
              url: rowLink
            }
          }
        }
      }
    ]
  });

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(message)
  };

  try {
    UrlFetchApp.fetch(webhookUrl, options);
    console.log('Chat notification sent.');
  } catch (e) {
    console.error('Chat Notification Error', e);
  }
}

/**
 * 平日10時/18時の未対応アラートを設定する
 */
function setupAlertTrigger() {
  const functionName = 'sendPendingAlert';
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === functionName) {
      ScriptApp.deleteTrigger(trigger);
    }
  }

  ScriptApp.newTrigger(functionName)
    .timeBased()
    .everyDays(1)
    .atHour(10)
    .nearMinute(0)
    .create();
  ScriptApp.newTrigger(functionName)
    .timeBased()
    .everyDays(1)
    .atHour(18)
    .nearMinute(0)
    .create();
  console.log('Alert trigger setup complete: sendPendingAlert (weekdays 10:00, 18:00)');
}

/**
 * 未対応のリードがあれば平日10時/18時にチャットで通知する
 */
function sendPendingAlert() {
  const today = new Date();
  const day = today.getDay();
  if (day === 0 || day === 6) return; // 土日スキップ

  const isAssigneeValid = (assigneeText) => {
    if (!assigneeText) return false;
    const normalized = assigneeText.trim();
    const exactAllowed = ['園部', '室野井', '村松', '石黒'];
    return exactAllowed.includes(normalized);
  };

  const sheet = getSalesSheet();
  if (!sheet) return;

  ensureSalesAssigneeValidation(sheet);
  ensureSalesAlertColumn(sheet);

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idx = {
    date: getHeaderIndex(headers, '受信日時', 2),
    subject: getHeaderIndex(headers, '件名', -1),
    assignee: getHeaderIndex(headers, '対応者', 17), // R列
    responseDate: getHeaderIndex(headers, '対応日', 18),
    status: getHeaderIndex(headers, '対応ステータス', 19), // T列
    nextAction: getHeaderIndex(headers, 'ネクストアクション', 20),
    nextActionDate: getHeaderIndex(headers, 'ネクストアクション期日', 21),
    company: getHeaderIndex(headers, '法人名', 4),
    name: getHeaderIndex(headers, '氏名', 5),
    email: getHeaderIndex(headers, 'Email', 6),
    alert: getHeaderIndex(headers, 'アラート送信済', -1)
  };

  if (idx.date < 0) return;

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;

  const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const pendingRows = [];
  const alertRowIndexes = [];

  data.forEach((row, i) => {
    const rowDate = new Date(row[idx.date]);
    const responseDate = row[idx.responseDate];
    const status = (row[idx.status] || '').toString().trim();
    const assignee = (row[idx.assignee] || '').toString().trim();
    const nextActionDate = normalizeDate(row[idx.nextActionDate]);
    const alertSent = idx.alert >= 0 ? row[idx.alert] : '';

    if (rowDate >= startOfToday) return;
    if (alertSent) return;

    const hasResponseDate = responseDate && responseDate.toString().trim() !== '';
    const hasStatus = status !== '';
    const hasAssignee = assignee !== '';
    const validAssignee = isAssigneeValid(assignee);
    const reasons = [];

    if (!hasStatus && (!hasAssignee || !validAssignee)) {
      reasons.push(!hasAssignee ? '対応者・対応ステータス未入力' : '対応者が未確定');
    } else {
      return;
    }

    if (reasons.length === 0) return;

    pendingRows.push({
      date: rowDate,
      subject: row[idx.subject],
      assignee: assignee,
      company: row[idx.company],
      name: row[idx.name],
      email: row[idx.email],
      nextAction: row[idx.nextAction],
      nextActionDate: nextActionDate,
      reasons: reasons
    });
    alertRowIndexes.push(i + 2);
  });

  if (pendingRows.length === 0) return;

  const lines = pendingRows.map(r => {
    const dateStr = Utilities.formatDate(r.date, Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm');
    const nextActionDateStr = r.nextActionDate instanceof Date
      ? Utilities.formatDate(r.nextActionDate, Session.getScriptTimeZone(), 'yyyy/MM/dd')
      : '-';
    const reasonStr = r.reasons.join(' / ');
    return `- ${dateStr} / ${r.assignee || '-'} / ${r.company || '-'} / ${r.name || '-'} / ${r.email || '-'} / ${r.subject || '-'} / ${nextActionDateStr} / ${reasonStr}`;
  });

  const sheetUrl = SpreadsheetApp.getActiveSpreadsheet().getUrl();
  const mentionLine = 'TO: <users/110980492970934847135> <users/101824641850767635776> <users/108455277578597920979>';

  const alertWebhooks = resolveAlertChatWebhooks();
  if (alertWebhooks.length > 0) {
    const text = `【未対応アラート】未対応リード${pendingRows.length}件\n${mentionLine}\nそのリードへの確認をお願いします。\n\n` + lines.join('\n') + `\n\n${sheetUrl}`;
    alertWebhooks.forEach(url => {
      try {
        UrlFetchApp.fetch(url, {
          method: 'post',
          contentType: 'application/json',
          payload: JSON.stringify({ text: text })
        });
      } catch (e) {
        console.error('Alert Chat Notification Error', e);
      }
    });
  }

  if (idx.alert >= 0) {
    alertRowIndexes.forEach(rowNum => {
      sheet.getRange(rowNum, idx.alert + 1).setValue('送信済');
    });
  }
}


function sendToBackend(data) {
  if (CONFIG.BACKEND_URL.includes('YOUR_BACKEND_URL')) {
    console.log('Backend URL not set. Skipping POST.');
    return;
  }

  const options = {
    'method': 'post',
    'contentType': 'application/json',
    'payload': JSON.stringify(data)
  };
  
  UrlFetchApp.fetch(CONFIG.BACKEND_URL, options);
}

/**
 * 本文から資料URL候補を抽出
 * 最初に見つかった http/https のURLを返す
 */
/**
 * 本文から資料URL候補を抽出
 * 最初に見つかった http/https のURLを返す
 */
function extractDocumentUrl(normalizedBody) {
  // 正規表現リテラル内のエスケープを修正
  const urlMatch = normalizedBody.match(/https?:\/\/[^\s]+/i);
  return urlMatch ? urlMatch[0] : '';
}

/**
 * GA4のCVイベントをスプレッドシートに取得する（高度なサービス AnalyticsData 必要）
 * GA4プロパティID、イベント名は環境に合わせて変更してください。
 * 注意: この関数を使用するには、Apps Scriptのエディタで「サービス」の「+」から
 * "Google Analytics Data API (AnalyticsData)" を追加する必要があります。
 */
function fetchGa4CvEvents() {
  const propertyId = 'properties/350946143';
  const cvEvents = [
    // GA4カスタムイベント名（コンバージョンONのものを列挙）
    'positioningmedia_inquiry',
    'positioningmedia_dl',
    'branding_media_dl',
    'inquiry',
    'clt_thanks'
  ];

  const res = AnalyticsData.Properties.runReport(
    {
      dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
      dimensions: [
        { name: 'dateHourMinute' },
        { name: 'sessionDefaultChannelGroup' },
        { name: 'sessionSourceMedium' },
        { name: 'sessionCampaignName' },
        { name: 'landingPagePlusQueryString' },
        { name: 'pageReferrer' },
        { name: 'deviceCategory' }
        // Note: pagePathPlusQueryString is not typically used here for simple CV reports but can be added
      ],
      metrics: [{ name: 'conversions' }],
      dimensionFilter: {
        filter: {
          fieldName: 'eventName',
          inListFilter: {
            values: cvEvents,
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

  const header = res.dimensionHeaders.map((h) => h.name).concat(res.metricHeaders.map((m) => m.name));
  const rows =
    (res.rows || []).map((r) =>
      r.dimensionValues.map((v) => v.value).concat(r.metricValues.map((m) => m.value))
    ) || [];

  if (rows.length) {
    sheet.getRange(1, 1, rows.length + 1, header.length).setValues([header, ...rows]);
  } else {
    console.log('No GA4 CV rows returned for the specified period/event.');
  }
}

/**
 * スプレッドシートのヘッダーを確認し、必要なカラムがなければ追加する
 * - lead_id, message_id がない場合は先頭に追加
 * - 資料URL がない場合は本文の前に追加
 */
// 重複定義防止のため、ヘッダー管理は1か所に集約（上部の checkAndUpdateHeaders を使用）
