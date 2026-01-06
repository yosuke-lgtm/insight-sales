document.addEventListener('DOMContentLoaded', async () => {
  const analyzeBtn = document.getElementById('analyze-btn');
  const resultDiv = document.getElementById('result');
  const loadingDiv = document.getElementById('loading');
  const contentDiv = document.getElementById('content');
  const pageTitle = document.getElementById('page-title');
  const pageUrl = document.getElementById('page-url');

  // macOS環境で「localhost(= ::1)」と「127.0.0.1」が別プロセスに繋がるケースがあるため、
  // backend の疎通確認が取れている 127.0.0.1 をデフォルトにする。
  const API_BASE_URL = 'http://127.0.0.1:3000';

  // 現在のアクティブなタブIDを保持
  let currentTabId = null;
  let lastFormDraftLong = '';

  function getDisplayHost(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return '';
    try {
      const urlObj = new URL(rawUrl);
      return urlObj.hostname || urlObj.protocol.replace(':', '');
    } catch {
      return rawUrl;
    }
  }

  function escapeHtml(raw) {
    return (raw ?? '').toString().replace(/[&<>"']/g, (ch) => {
      switch (ch) {
        case '&':
          return '&amp;';
        case '<':
          return '&lt;';
        case '>':
          return '&gt;';
        case '"':
          return '&quot;';
        case "'":
          return '&#39;';
        default:
          return ch;
      }
    });
  }

  function renderRichText(raw) {
    const escaped = escapeHtml(raw ?? '');
    const withBold = escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    return withBold.replace(/\n/g, '<br>');
  }

  function renderInlineText(raw) {
    const escaped = escapeHtml(raw ?? '');
    return escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }

  function sanitizeHttpUrl(rawUrl) {
    if (!rawUrl) return null;
    try {
      const urlObj = new URL(rawUrl);
      if (urlObj.protocol === 'http:' || urlObj.protocol === 'https:') return urlObj.href;
      return null;
    } catch {
      return null;
    }
  }

  function formatPublishedAt(raw) {
    if (!raw) return '';
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString().slice(0, 10);
    }
    return raw.toString().slice(0, 20);
  }

  function buildTechStackComment(techStackAnalysis) {
    const raw =
      techStackAnalysis?.hypothesis ||
      techStackAnalysis?.comment ||
      techStackAnalysis?.conclusion ||
      '';
    if (raw && raw.toString().trim()) return raw;

    const tools = Array.isArray(techStackAnalysis?.tools) ? techStackAnalysis.tools.filter(Boolean) : [];
    const missing = Array.isArray(techStackAnalysis?.missing) ? techStackAnalysis.missing.filter(Boolean) : [];

    if (tools.length === 0 && missing.length === 0) return '-';

    const parts = [];
    if (tools.length > 0) parts.push(`推定ツール: ${tools.slice(0, 8).join('、')}`);
    if (missing.length > 0) parts.push(`不足の可能性: ${missing.slice(0, 8).join('、')}`);
    return parts.join('\n');
  }

  function renderNewsList(items, emptyText) {
    const safeItems = Array.isArray(items) ? items.slice(0, 10) : [];
    if (safeItems.length === 0) {
      return `<div class="info-item">${escapeHtml(emptyText)}</div>`;
    }

    return `
      <ul class="news-list">
        ${safeItems
          .map((item) => {
            const title = escapeHtml(item?.title || '（無題）');
            const href = sanitizeHttpUrl(item?.url) || '#';
            const source = escapeHtml(item?.source || '');
            const publishedAt = escapeHtml(formatPublishedAt(item?.publishedAt) || '');
            const meta = [source, publishedAt].filter(Boolean).join(' ・ ');
            const rel = 'noopener noreferrer';
            const target = '_blank';
            const safeHref = escapeHtml(href);
            return `
              <li class="news-item">
                <a class="news-link" href="${safeHref}" target="${target}" rel="${rel}">${title}</a>
                ${meta ? `<div class="news-meta">${meta}</div>` : ''}
              </li>
            `;
          })
          .join('')}
      </ul>
    `;
  }

  async function checkBackendHealth() {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);
    try {
      const res = await fetch(new URL('/health', API_BASE_URL), { signal: controller.signal });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const detail = (text || '').toString().trim().slice(0, 200);
        throw new Error(
          `バックエンドが想定と違う可能性があります。\n` +
            `確認URL: ${API_BASE_URL}/health\n` +
            `結果: ${res.status} ${res.statusText || ''}` +
            (detail ? `\n${detail}` : '')
        );
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // 初期化処理
  await initialize();

  // タブ切り替えイベントの監視
  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    await updateCurrentTab(activeInfo.tabId);
  });

  // タブ更新イベントの監視（URL変更など）
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (tabId === currentTabId && changeInfo.status === 'complete') {
      await updateCurrentTab(tabId);
    }
  });

  async function initialize() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      await updateCurrentTab(tab.id);
    }
  }

  async function updateCurrentTab(tabId) {
    currentTabId = tabId;
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab) {
        pageTitle.textContent = tab.title || '';
        pageUrl.textContent = getDisplayHost(tab.url);
        
        // 保存された状態を読み込む
        const storageKey = `analysis_${tabId}`;
        const result = await chrome.storage.local.get(storageKey);
        const savedData = result[storageKey];

        if (savedData) {
          // 保存データがあれば表示
          renderResult(savedData);
          resultDiv.style.display = 'block';
          loadingDiv.style.display = 'none';
        } else {
          // データがなければ初期状態（またはクリア）
          contentDiv.innerHTML = '';
          resultDiv.style.display = 'none';
          loadingDiv.style.display = 'none';
        }
      }
    } catch (e) {
      console.error('Tab update error:', e);
    }
  }

  analyzeBtn.addEventListener('click', async () => {
    // UI状態更新
    analyzeBtn.disabled = true;
    loadingDiv.style.display = 'block';
    resultDiv.style.display = 'none';
    contentDiv.innerHTML = '';

    try {
      // 現在のタブから情報を取得
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      console.log('Active tab:', tab); // デバッグ用ログ
      
      if (!tab) {
        throw new Error('アクティブなタブが見つかりません。');
      }

      // コンテンツスクリプトにメッセージ送信（ページ情報取得）
      let pageData = { title: tab.title, url: tab.url };
      
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'getPageInfo' });
        if (response) {
          pageData = { ...pageData, ...response };
        }
      } catch (e) {
        console.warn('Content script not ready or not injectable', e);
      }

      // URLのバリデーション
      if (!pageData.url || (!pageData.url.startsWith('http://') && !pageData.url.startsWith('https://'))) {
        throw new Error(`分析可能なWebページではありません。\n取得したURL: ${pageData.url || 'なし'}\n通常のWebサイト（http/https）を開いてください。`);
      }

      // ドメイン抽出
      const urlObj = new URL(pageData.url);
      const domain = urlObj.hostname;

      // 対象事業を取得
      const businessSegment = document.getElementById('business-segment')?.value?.trim() || '';
      // 追加URLを取得
      const additionalUrl = document.getElementById('additional-url')?.value?.trim() || '';

      await checkBackendHealth();

      // バックエンドAPI呼び出し
      const apiResponse = await fetch(new URL('/api/analyze', API_BASE_URL), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          domain: domain,
          companyName: pageData.title,
          pageUrl: pageData.url, // 現在のタブURL（PDFの場合はこちらを優先）
          businessSegment: businessSegment, // 対象事業（任意）
          additionalUrl: additionalUrl // 追加参考URL（任意）
        })
      });

      if (!apiResponse.ok) {
        let errorDetail = '';
        try {
          const responseText = await apiResponse.text();
          try {
            const responseJson = JSON.parse(responseText);
            errorDetail = responseJson?.message || responseJson?.error || '';
          } catch {
            errorDetail = responseText;
          }
        } catch {
          // ignore
        }
        const safeDetail = (errorDetail || '').toString().trim().slice(0, 300);
        throw new Error(
          `API Error: ${apiResponse.status} ${apiResponse.statusText || ''}` +
            (safeDetail ? `\n${safeDetail}` : '')
        );
      }
      const data = await apiResponse.json();
      
      // 結果を保存（タブIDに紐付け）
      const storageKey = `analysis_${tab.id}`;
      await chrome.storage.local.set({ [storageKey]: data });

      renderResult(data);

    } catch (error) {
      console.error('Analysis failed:', error);
      const rawMessage = error?.message || String(error);
      const isNetworkError =
        error instanceof TypeError ||
        rawMessage.includes('Failed to fetch') ||
        rawMessage.includes('NetworkError');

      const message = isNetworkError
        ? `バックエンドに接続できません。\n${API_BASE_URL}/health が開けるか確認し、backend を起動してください。`
        : rawMessage;

      contentDiv.innerHTML = '';
      const errorEl = document.createElement('div');
      errorEl.className = 'error';
      errorEl.textContent = `エラーが発生しました: ${message}`;
      contentDiv.appendChild(errorEl);
      resultDiv.style.display = 'block';
    } finally {
      loadingDiv.style.display = 'none';
      analyzeBtn.disabled = false;
    }
  });

  document.getElementById('pdf-btn').addEventListener('click', () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('ポップアップがブロックされました。許可してください。');
      return;
    }

    const resultHtml = document.getElementById('content').innerHTML;

    const robustStyles = `
      :root {
        --sidebar-width: 220px;
        --primary-bg: #F3F4F6;
        --card-bg: #FFFFFF;
        --text-main: #111827;
        --text-sub: #6B7280;
        --accent: #2563EB;
        --border: #E5E7EB;
        --success: #10B981;
        --warning: #F59E0B;
        --danger: #EF4444;
      }
      body {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        margin: 0;
        padding: 0;
        background: white;
        color: var(--text-main);
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .report-container { display: block; }
      .sidebar { display: none !important; }
      .main-content { margin: 0 !important; padding: 36px !important; max-width: 100% !important; box-sizing: border-box; }
      h1 { font-size: 20px; margin: 0 0 4px 0; color: #111; }
      h2 {
        font-size: 16px; margin: 20px 0 10px 0;
        border-left: 4px solid var(--accent); padding-left: 10px;
        display: flex; align-items: center; background: #fff; padding: 8px 10px; border-radius: 4px;
        page-break-after: avoid;
      }
      .card {
        background: white; border-radius: 8px; padding: 16px;
        box-shadow: none; border: 1px solid #ccc; margin-bottom: 10px;
        break-inside: avoid;
      }
      .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
      .info-item { font-size: 12px; margin-bottom: 6px; line-height: 1.5; color: #374151; }
      .info-label { font-weight: bold; color: #111; display: block; margin-bottom: 2px; }
      .tag { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; margin-right: 4px; background: #E5E7EB; color: #374151; border: 1px solid #D1D5DB; }
      .text-sm { font-size: 12px; }
      .text-xs { font-size: 10px; color: #666; }
      .bold { font-weight: bold; }

      /* News */
      .news-list { list-style: none; padding: 0; margin: 0; }
      .news-item { padding: 10px 0; border-bottom: 1px solid var(--border); }
      .news-item:last-child { border-bottom: none; }
      .news-link { font-size: 12px; color: var(--accent); text-decoration: none; line-height: 1.4; }
      .news-link:hover { text-decoration: underline; }
      .news-meta { font-size: 10px; color: var(--text-sub); margin-top: 4px; }

      /* Collapsible (print: summary隠して中身を表示) */
      details.collapsible > summary { display: none; }
      details.collapsible { border: 1px solid #ccc; }
      details.collapsible > .collapsible-body { padding: 0; }

      button, .copy-btn, #controls { display: none !important; }
      #action { display: none !important; }
    `;

    printWindow.document.write(`
      <html>
        <head>
          <title>AI戦略分析レポート</title>
          <style>${robustStyles}</style>
        </head>
        <body>
          ${resultHtml}
          <script>
            window.addEventListener('load', () => {
              document.querySelectorAll('details').forEach(d => { d.open = true; });
              setTimeout(() => { window.print(); }, 300);
            });
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  });

  function renderResult(data) {
    const strategy = data.strategy;
    const company = data.company;
    lastFormDraftLong = strategy?.formDraft?.long || '';
    const rt = (v) => renderRichText(v || '-');
    const ri = (v) => renderInlineText(v || '-');

    // --- Template Components ---
    
    // Sidebar for Print/Wide view
    const sidebarHtml = `
      <nav class="sidebar">
        <div style="font-size:18px; font-weight:bold; margin-bottom:20px;">🤖 AI Sales OS</div>
        <div style="font-size:12px; color:#9CA3AF; margin-bottom:10px;">目次</div>
        <a href="#summary" style="display:block; padding:8px; color:#fff; text-decoration:none;">📊 サマリー</a>
        <a href="#financial" style="display:block; padding:8px; color:#fff; text-decoration:none;">💰 財務・ビジネス</a>
        <a href="#tech" style="display:block; padding:8px; color:#fff; text-decoration:none;">🧩 Tech Stack</a>
        <a href="#market" style="display:block; padding:8px; color:#fff; text-decoration:none;">🌍 PESTLE分析</a>
        <a href="#news" style="display:block; padding:8px; color:#fff; text-decoration:none;">📰 ニュース</a>
        <a href="#strategy" style="display:block; padding:8px; color:#fff; text-decoration:none;">⚔️ SWOT分析</a>
        <a href="#action" style="display:block; padding:8px; color:#fff; text-decoration:none;">📞 アクション</a>
      </nav>
    `;

    // Strategy Score & Header
    const scoreColor = strategy.score >= 80 ? 'color: #10B981' : (strategy.score >= 50 ? 'color: #F59E0B' : 'color: #EF4444');
    
    const html = `
      <div class="report-container">
        
        ${sidebarHtml}

        <main class="main-content">
          <!-- Header / Summary -->
          <div class="card" id="summary" style="display:flex; justify-content:space-between; align-items:center;">
            <div>
              <div class="text-xs">企業名 / 分析対象</div>
              <h1>${escapeHtml(company.name || '企業情報')}</h1>
              <div style="margin-top:8px;">
                <span class="tag">${escapeHtml(strategy.businessSummary?.serviceClass || 'サービス')}</span>
              </div>
              <p class="summary" style="margin-top:12px;">${rt(strategy.summary)}</p>
            </div>
            <div style="text-align:center; min-width:80px; margin-left:16px;">
              <div class="text-xs">戦略スコア</div>
              <div style="font-size:32px; font-weight:bold; ${scoreColor}">${strategy.score}</div>
            </div>
          </div>

          <!-- 1. Business & Finance -->
          <section id="financial">
            <h2>💰 財務・ビジネスモデル</h2>
            <div class="grid-2">
              <div class="card">
                <div class="info-label">事業要約</div>
                <div class="info-item">${rt(strategy.businessSummary?.summary)}</div>
                <div style="margin-top:8px;">
                   <div class="info-item"><span class="bold">顧客:</span> ${rt(strategy.businessSummary?.customerSegment)}</div>
                   <div class="info-item"><span class="bold">収益:</span> ${rt(strategy.businessSummary?.revenueModel)}</div>
                </div>
                <div class="info-item" style="background:#F0F9FF; padding:8px; border-radius:4px; margin-top:8px;">
                  <span class="bold">結論:</span> ${rt(strategy.businessSummary?.conclusion)}
                </div>
              </div>
              <div class="card">
                <div class="info-label">財務・投資</div>
                ${renderFinancials(data.financials)}
                <div class="info-item"><span class="bold">予算時期:</span> ${rt(strategy.financialHealth?.budgetCycle)}</div>
                <div class="info-item"><span class="bold">投資余力:</span> ${rt(strategy.financialHealth?.investmentCapacity)}</div>
                <div class="info-item" style="background:#F0F9FF; padding:8px; border-radius:4px; margin-top:8px;">
                  <span class="bold">結論:</span> ${rt(strategy.financialHealth?.conclusion)}
                </div>
              </div>
            </div>
            
            <div class="card">
              <div class="info-label">💡 ビジネスモデル考察</div>
              <div class="grid-2">
                <div>
                   <span class="bold">コスト構造:</span>
                   <div class="info-item">${rt(strategy.businessModel?.costStructure)}</div>
                </div>
                <div>
                   <span class="bold">経済の堀 (Moat):</span>
                   <div class="info-item">${rt(strategy.businessModel?.economicMoat)}</div>
                </div>
              </div>
              <div class="info-item" style="background:#F0F9FF; padding:8px; border-radius:4px; margin-top:8px;">
                <span class="bold">結論:</span> ${rt(strategy.businessModel?.conclusion)}
              </div>
            </div>
          </section>

          <!-- Tech Stack -->
          <section id="tech">
            <h2>🧩 Tech Stack</h2>
            <div class="grid-2">
              <div class="card">
                <div class="info-label">DX成熟度</div>
                <div class="info-item">${rt(strategy.techStackAnalysis?.maturity)}</div>
                <div class="info-label" style="margin-top:10px;">コメント（仮説）</div>
                <div class="info-item">${rt(buildTechStackComment(strategy.techStackAnalysis))}</div>
              </div>
              <div class="card">
                <div class="info-label">推定スタック</div>
                ${
                  (strategy.techStackAnalysis?.tools || []).length > 0
                    ? `<ul style="padding-left:16px; margin:4px 0;" class="text-sm">${(strategy.techStackAnalysis.tools || [])
                        .map((t) => `<li>${ri(t)}</li>`)
                        .join('')}</ul>`
                    : `<div class="info-item">-</div>`
                }
                <div class="info-label" style="margin-top:10px;">不足ツール</div>
                ${
                  (strategy.techStackAnalysis?.missing || []).length > 0
                    ? `<ul style="padding-left:16px; margin:4px 0;" class="text-sm">${(strategy.techStackAnalysis.missing || [])
                        .map((t) => `<li>${ri(t)}</li>`)
                        .join('')}</ul>`
                    : `<div class="info-item">-</div>`
                }
              </div>
            </div>
          </section>

          <!-- 2. PESTLE -->
          <section id="market">
            <h2>🌍 外部環境 (PESTLE)</h2>
            <div class="grid-2">
              <div class="card">
                <div class="info-label">🏛️ Political</div>
                <div class="info-item">${rt(strategy.pestle?.political)}</div>
              </div>
              <div class="card">
                <div class="info-label">📈 Economic</div>
                <div class="info-item">${rt(strategy.pestle?.economic)}</div>
              </div>
              <div class="card">
                <div class="info-label">👥 Social</div>
                <div class="info-item">${rt(strategy.pestle?.social)}</div>
              </div>
              <div class="card">
                <div class="info-label">💻 Technological</div>
                <div class="info-item">${rt(strategy.pestle?.technological)}</div>
              </div>
              <div class="card">
                <div class="info-label">⚖️ Legal</div>
                <div class="info-item">${rt(strategy.pestle?.legal)}</div>
              </div>
              <div class="card">
                <div class="info-label">🌲 Environmental</div>
                <div class="info-item">${rt(strategy.pestle?.environmental)}</div>
              </div>
            </div>
            <div class="card" style="margin-top:-10px;">
              <div class="info-label">🔮 未来予測</div>
              <div class="info-item">${rt(strategy.pestle?.futureOutlook)}</div>
              <div class="info-item" style="background:#F0F9FF; padding:8px; border-radius:4px; margin-top:8px;">
                <span class="bold">結論:</span> ${rt(strategy.pestle?.conclusion)}
              </div>
            </div>
          </section>

          <!-- 3. SWOT -->
          <section id="strategy">
            <h2>⚔️ 戦略SWOT</h2>
            <div class="grid-2">
              <div class="card" style="border-left:4px solid #10B981;">
                <div class="info-label" style="color:#059669">💪 Strengths (強み)</div>
                <ul style="padding-left:16px; margin:4px 0;" class="text-sm">
                  ${(strategy.swot.strengths || []).map(s => `<li>${ri(s)}</li>`).join('')}
                </ul>
              </div>
              <div class="card" style="border-left:4px solid #EF4444;">
                <div class="info-label" style="color:#B91C1C">😿 Weaknesses (弱み)</div>
                 <ul style="padding-left:16px; margin:4px 0;" class="text-sm">
                  ${(strategy.swot.weaknesses || []).map(s => `<li>${ri(s)}</li>`).join('')}
                </ul>
              </div>
              <div class="card" style="border-left:4px solid #F59E0B;">
                <div class="info-label" style="color:#B45309">🌟 Opportunities (機会)</div>
                 <ul style="padding-left:16px; margin:4px 0;" class="text-sm">
                  ${(strategy.swot.opportunities || []).map(s => `<li>${ri(s)}</li>`).join('')}
                </ul>
              </div>
              <div class="card" style="border-left:4px solid #6B7280;">
                <div class="info-label" style="color:#374151">⚡ Threats (脅威)</div>
                 <ul style="padding-left:16px; margin:4px 0;" class="text-sm">
                  ${(strategy.swot.threats || []).map(s => `<li>${ri(s)}</li>`).join('')}
                </ul>
              </div>
            </div>
            <div class="card" style="background:#F9FAFB;">
              <div class="info-label">結論</div>
              <div class="info-item">${rt(strategy.swot?.conclusion)}</div>
            </div>
          </section>

          <!-- News (collapsed by default) -->
          <section id="news">
            <details class="collapsible" id="news-details">
              <summary class="card collapsible-summary">📰 ニュース（クリックで開く）</summary>
              <div class="collapsible-body">
                <div class="grid-2">
                  <div class="card">
                    <div class="info-label">企業ニュース（最大10件）</div>
                    ${renderNewsList(data?.news?.company, '企業ニュースは見つかりませんでした')}
                  </div>
                  <div class="card">
                    <div class="info-label">業界ニュース（最大10件）</div>
                    ${renderNewsList(data?.news?.industry, '業界ニュースは見つかりませんでした')}
                  </div>
                </div>
              </div>
            </details>
          </section>

          <!-- 4. Organization 7S -->
          <section>
             <h2>🏢 組織分析 (7S)</h2>
             <div class="grid-3">
               <div class="card">
                 <div class="info-label">Strategy (戦略)</div>
                 <div class="info-item">${rt(strategy.sevenS?.strategy)}</div>
               </div>
               <div class="card">
                 <div class="info-label">Structure (組織構造)</div>
                 <div class="info-item">${rt(strategy.sevenS?.structure)}</div>
               </div>
               <div class="card">
                 <div class="info-label">Systems (システム)</div>
                 <div class="info-item">${rt(strategy.sevenS?.systems)}</div>
               </div>
               <div class="card">
                 <div class="info-label">Shared Values (価値観)</div>
                 <div class="info-item">${rt(strategy.sevenS?.sharedValues)}</div>
               </div>
               <div class="card">
                 <div class="info-label">Style (社風)</div>
                 <div class="info-item">${rt(strategy.sevenS?.style)}</div>
               </div>
               <div class="card">
                 <div class="info-label">Staff (人材)</div>
                 <div class="info-item">${rt(strategy.sevenS?.staff)}</div>
               </div>
               <div class="card">
                 <div class="info-label">Skills (スキル)</div>
                 <div class="info-item">${rt(strategy.sevenS?.skills)}</div>
               </div>
             </div>
          </section>

          <!-- 5. Action -->
          <section id="action">
            <h2>📞 アクションプラン</h2>
            <div class="card">
                <div class="info-label">トークスクリプト</div>
                <div style="background:#F3F4F6; padding:12px; border-radius:6px; font-size:13px; line-height:1.6; white-space:pre-wrap;">
                  ${rt(strategy.callTalk || '生成されたトークはありません')}
                </div>
            </div>
            
            <div class="card">
               <div class="info-label">フォーム送信文案</div>
                <div style="background:#fff; border:1px solid #ddd; padding:10px; border-radius:4px; font-size:12px; white-space:pre-wrap; min-height:100px;">${rt(strategy.formDraft.long)}</div>
               <button class="copy-btn">文案をコピー</button>
            </div>
          </section>

        </main>
      </div>
    `;

    contentDiv.innerHTML = html;
    resultDiv.style.display = 'block';

    // 目次からニュースへ飛んだときは折りたたみを開く
    const openNews = () => {
      const details = contentDiv.querySelector('#news-details');
      if (details && !details.open) details.open = true;
    };
    contentDiv.querySelectorAll('a[href="#news"]').forEach((a) => {
      a.addEventListener('click', () => {
        openNews();
      });
    });
    if (location.hash === '#news') {
      openNews();
    }

    // Copy Button Handler
    const copyBtn = contentDiv.querySelector('.copy-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(lastFormDraftLong || '');
        copyBtn.textContent = 'コピー完了!';
        setTimeout(() => copyBtn.textContent = '文案をコピー', 2000);
      });
    }
  }

  function renderFinancials(financials) {
    if (!financials || financials.length === 0) return '<div class="info-item">財務データなし</div>';
    const latest = financials[0];
    return `
      <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
        <span class="text-sm">売上高:</span>
        <span class="bold">${latest.revenue ? Number(latest.revenue).toLocaleString() + ' 億円' : '-'}</span>
      </div>
      <div style="display:flex; justify-content:space-between;">
        <span class="text-sm">営業利益:</span>
        <span class="bold">${latest.operatingProfit ? Number(latest.operatingProfit).toLocaleString() + ' 億円' : '-'}</span>
      </div>
    `;
  }
});
