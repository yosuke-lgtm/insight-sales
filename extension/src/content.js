console.log('AI Sales OS Content Script Loaded');

function extractPageInfo() {
  return {
    url: window.location.href,
    title: document.title,
    domain: window.location.hostname,
    metaDescription: document.querySelector('meta[name="description"]')?.content || ''
  };
}

// Listen for messages from sidepanel or background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getPageInfo') {
    sendResponse(extractPageInfo());
  }
});
