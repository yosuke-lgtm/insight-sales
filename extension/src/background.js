// 拡張機能インストール時・更新時にサイドパネルの挙動を設定
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error(error));
});

// 念のためトップレベルでも実行
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'analyze_site') {
    // Forward to side panel or backend
    console.log('Analysis requested for:', message.url);
  }
});
