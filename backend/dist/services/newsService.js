"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NewsService = void 0;
const axios_1 = __importDefault(require("axios"));
class NewsService {
    constructor() {
        this.gnewsUrl = 'https://gnews.io/api/v4/search';
        this.newsapiUrl = 'https://newsapi.org/v2/everything';
        // GNewsがレートリミットになった際のバックオフ（ミリ秒で保持）
        this.gnewsBackoffUntil = 0;
        this.gnewsApiKey = process.env.GNEWS_API_KEY || '';
        this.newsapiKey = process.env.NEWSAPI_KEY || '';
    }
    /**
     * 企業ニュース取得（GNews + PR Times + Google News 並列）
     * ブランド名と正式名称の両方で検索
     */
    getCompanyNews(companyName) {
        return __awaiter(this, void 0, void 0, function* () {
            console.log(`Fetching company news for: ${companyName}`);
            // 企業名からブランド名を抽出（ALSOKなど）
            const brandName = this.extractBrandName(companyName);
            const searchNames = brandName ? [companyName, brandName] : [companyName];
            // 全ソースを並列実行
            const allResults = [];
            for (const name of searchNames) {
                const normalizedQuery = this.normalizeCompanyQuery(name);
                const [gnewsResults, prtimesResults, googleResults] = yield Promise.all([
                    this.fetchFromGNews(normalizedQuery, false),
                    this.fetchFromPRTimesRSS(normalizedQuery),
                    this.fetchFromGoogleNewsRSS(normalizedQuery)
                ]);
                allResults.push(...prtimesResults, ...googleResults, ...gnewsResults);
            }
            // 古いニュースをフィルタ（1年以内のみ）
            let filteredResults = this.filterRecentNews(allResults);
            // 重複除去
            const seen = new Set();
            const results = filteredResults.filter(item => {
                if (seen.has(item.url))
                    return false;
                seen.add(item.url);
                return true;
            });
            console.log(`Company news total: ${results.length} items (before filter: ${allResults.length})`);
            return results.slice(0, 10);
        });
    }
    /**
     * ニュース検索用に企業名を正規化
     * - 「｜」などの説明区切りを除去
     * - クエリ演算子/記号を除去（GNewsのsyntax error対策）
     * - 長さを制限
     */
    normalizeCompanyQuery(rawName) {
        let name = rawName
            .replace(/株式会社|有限会社|合同会社/g, '')
            .trim();
        // 企業名 + サービス説明のようなパターンを分離
        name = name.split(/[｜|｜\-–—:：]/)[0].trim();
        // GNews/Google News用に危険な記号や演算子を除去
        name = name
            .replace(/["'()<>]/g, ' ')
            .replace(/\b(AND|OR|NOT)\b/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (name.length > 30) {
            name = name.slice(0, 30).trim();
        }
        return name || rawName;
    }
    /**
     * 企業名からブランド名を抽出（例: 綜合警備保障 → ALSOK）
     */
    extractBrandName(companyName) {
        // 一般的なパターン: カタカナ/英語ブランド名が含まれている場合
        const brandPatterns = [
            /ALSOK/i,
            /セコム/,
            /ソフトバンク/,
            /トヨタ/,
            /ホンダ/,
            /ソニー/,
            /パナソニック/,
            /日立/,
            /NEC/i,
            /NTT/i,
        ];
        for (const pattern of brandPatterns) {
            const match = companyName.match(pattern);
            if (match)
                return match[0];
        }
        // 「株式会社」を除いた部分がブランド名の可能性
        const simpleName = companyName
            .replace(/株式会社|有限会社|合同会社/g, '')
            .trim();
        // 簡略名が元の名前と違う場合は返す
        if (simpleName !== companyName && simpleName.length > 2) {
            return simpleName;
        }
        return null;
    }
    /**
     * PR Times RSS - 企業プレスリリース専用
     */
    fetchFromPRTimesRSS(companyName) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            try {
                // 「株式会社」を除去してシンプルな企業名で検索
                const simpleName = companyName
                    .replace(/株式会社|有限会社|合同会社/g, '')
                    .trim();
                // PR Timesのcompany_name RSSは「企業名検索」用途のみ。
                // PESTLEなどの一般クエリや記号混じりは404になりやすいのでスキップ。
                const looksLikeGenericQuery = /["'()]/.test(simpleName) ||
                    /\b(AND|OR|NOT)\b/i.test(simpleName) ||
                    simpleName.includes(' ') ||
                    simpleName.length > 40;
                if (looksLikeGenericQuery) {
                    return [];
                }
                const encodedName = encodeURIComponent(simpleName);
                const url = `https://prtimes.jp/main/action.php?run=rss&company_name=${encodedName}`;
                console.log(`PR Times RSS Query: ${simpleName}`);
                const response = yield axios_1.default.get(url, {
                    timeout: 10000,
                    responseType: 'text',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.7',
                        'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
                        'Referer': 'https://prtimes.jp/'
                    },
                    validateStatus: (status) => status >= 200 && status < 400
                });
                const items = [];
                const xml = response.data;
                const ct = ((_a = response.headers['content-type']) === null || _a === void 0 ? void 0 : _a.toLowerCase()) || '';
                if (!ct.includes('xml') && !xml.includes('<rss')) {
                    console.warn(`PR Times RSS unexpected content-type: ${ct}`);
                    return [];
                }
                // <item>タグを抽出
                const itemMatches = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
                for (const itemXml of itemMatches.slice(0, 5)) {
                    const title = this.extractXmlTag(itemXml, 'title');
                    const link = this.extractXmlTag(itemXml, 'link');
                    const pubDate = this.extractXmlTag(itemXml, 'pubDate');
                    if (title && link) {
                        items.push({
                            title: this.decodeHtmlEntities(title),
                            url: link,
                            publishedAt: pubDate || '',
                            source: 'PR Times',
                            summary: ''
                        });
                    }
                }
                console.log(`PR Times RSS returned ${items.length} items`);
                return items;
            }
            catch (error) {
                const status = (_b = error.response) === null || _b === void 0 ? void 0 : _b.status;
                if (status === 404) {
                    console.warn('PR Times RSS not found for query:', companyName);
                }
                else {
                    console.error('PR Times RSS Error:', status ? `${status} ${error.message}` : error.message);
                }
                return [];
            }
        });
    }
    getPestleNews(queries) {
        return __awaiter(this, void 0, void 0, function* () {
            console.log('Fetching PESTLE news with queries:', queries);
            // API呼び出し数を抑えるため、重要な2つ + industryの3カテゴリに絞る
            const [regulationNews, clientMarketNews, industryNews] = yield Promise.all([
                this.fetchIndustryNews(queries.regulation),
                this.fetchIndustryNews(queries.clientMarket),
                this.fetchIndustryNews(queries.industry)
            ]);
            return {
                regulation: regulationNews,
                clientMarket: clientMarketNews,
                industry: industryNews
            };
        });
    }
    /**
     * 従来の業界ニュース取得（後方互換）
     */
    getIndustryNews(industryQuery) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.fetchIndustryNews(industryQuery);
        });
    }
    getIndustryTrendNews(industryQuery) {
        return __awaiter(this, void 0, void 0, function* () {
            return []; // PESTLE統合済み
        });
    }
    /**
     * 業界ニュース専用
     * Note: GNews + Google News RSS + PR Times を並列実行
     */
    fetchIndustryNews(query) {
        return __awaiter(this, void 0, void 0, function* () {
            // GNews, Google News RSS, PR Times を並列実行
            const [gnewsResults, googleRssResults, prtimesResults] = yield Promise.all([
                this.fetchFromGNews(query, false),
                this.fetchFromGoogleNewsRSS(query),
                this.fetchFromPRTimesRSS(query)
            ]);
            // 結果をマージ
            let results = [...prtimesResults, ...googleRssResults, ...gnewsResults];
            // 両方空の場合のみ NewsAPI を試す
            if (results.length === 0) {
                console.log('All sources returned empty, trying NewsAPI...');
                results = yield this.fetchFromNewsAPI(query);
            }
            // 古いニュースをフィルタ（2024年以降のみ）
            results = this.filterRecentNews(results);
            // URLベースで重複除去
            const seen = new Set();
            results = results.filter(item => {
                if (seen.has(item.url))
                    return false;
                seen.add(item.url);
                return true;
            });
            return results.slice(0, 5); // 最大5件
        });
    }
    /**
     * 古いニュースをフィルタ（1年以内のニュースのみ）
     */
    filterRecentNews(items) {
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        return items.filter(item => {
            if (!item.publishedAt)
                return true; // 日付がない場合は含める
            try {
                const pubDate = new Date(item.publishedAt);
                return pubDate >= oneYearAgo;
            }
            catch (_a) {
                return true; // パースできない場合は含める
            }
        });
    }
    /**
     * Google News RSS - 無料・日本語対応良好
     */
    fetchFromGoogleNewsRSS(query) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            try {
                const encodedQuery = encodeURIComponent(query);
                const url = `https://news.google.com/rss/search?q=${encodedQuery}&hl=ja&gl=JP&ceid=JP:ja`;
                console.log(`Google News RSS Query: ${query}`);
                const response = yield axios_1.default.get(url, {
                    timeout: 10000,
                    responseType: 'text',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.7',
                        'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
                        'Referer': 'https://news.google.com/'
                    },
                    validateStatus: (status) => status >= 200 && status < 400
                });
                // XMLをパース（簡易的なパース）
                const items = [];
                const xml = response.data;
                const ct = ((_a = response.headers['content-type']) === null || _a === void 0 ? void 0 : _a.toLowerCase()) || '';
                if (!ct.includes('xml') && !xml.includes('<rss')) {
                    console.warn(`Google News RSS unexpected content-type: ${ct}`);
                    return [];
                }
                // <item>タグを抽出
                const itemMatches = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
                for (const itemXml of itemMatches.slice(0, 5)) {
                    const title = this.extractXmlTag(itemXml, 'title');
                    const link = this.extractXmlTag(itemXml, 'link');
                    const pubDate = this.extractXmlTag(itemXml, 'pubDate');
                    const source = this.extractXmlTag(itemXml, 'source');
                    if (title && link) {
                        items.push({
                            title: this.decodeHtmlEntities(title),
                            url: link,
                            publishedAt: pubDate || '',
                            source: source || 'Google News',
                            summary: ''
                        });
                    }
                }
                console.log(`Google News RSS returned ${items.length} items`);
                return items;
            }
            catch (error) {
                const status = (_b = error.response) === null || _b === void 0 ? void 0 : _b.status;
                console.error('Google News RSS Error:', status ? `${status} ${error.message}` : error.message);
                return [];
            }
        });
    }
    /**
     * XMLタグから値を抽出するヘルパー
     */
    extractXmlTag(xml, tagName) {
        const regex = new RegExp(`<${tagName}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tagName}>|<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`);
        const match = xml.match(regex);
        return match ? (match[1] || match[2] || '').trim() : '';
    }
    /**
     * HTMLエンティティをデコード
     */
    decodeHtmlEntities(text) {
        return text
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");
    }
    /**
     * GNews API呼び出し
     * @param query 検索クエリ
     * @param titleOnly trueの場合、タイトルのみを検索対象にする（ノイズ削減）
     */
    fetchFromGNews(query_1) {
        return __awaiter(this, arguments, void 0, function* (query, titleOnly = false) {
            var _a, _b;
            if (!this.gnewsApiKey) {
                console.warn('GNews API Key is missing.');
                return [];
            }
            // バックオフ中はGNewsをスキップしてRSSのみで返す
            const now = Date.now();
            if (now < this.gnewsBackoffUntil) {
                console.warn(`GNews is rate-limited. Skipping until ${new Date(this.gnewsBackoffUntil).toISOString()}`);
                return [];
            }
            try {
                console.log(`GNews Query: ${query} (in=${titleOnly ? 'title' : 'default'})`);
                const params = {
                    q: query,
                    token: this.gnewsApiKey,
                    lang: 'ja',
                    country: 'jp',
                    max: 5,
                    sortby: 'publishedAt'
                };
                // タイトル検索を有効にしてノイズを削減
                if (titleOnly) {
                    params.in = 'title';
                }
                const response = yield axios_1.default.get(this.gnewsUrl, {
                    params,
                    timeout: 10000
                });
                if (!response.data.articles || response.data.articles.length === 0) {
                    return [];
                }
                return response.data.articles.map((article) => ({
                    title: article.title,
                    url: article.url,
                    publishedAt: article.publishedAt,
                    source: article.source.name,
                    summary: article.description
                }));
            }
            catch (error) {
                const msg = ((_a = error.response) === null || _a === void 0 ? void 0 : _a.data) || error.message || '';
                console.error('GNews Error:', msg);
                // レートリミット系の文言が含まれる場合は一定時間バックオフ
                const isRateLimit = ((_b = error === null || error === void 0 ? void 0 : error.response) === null || _b === void 0 ? void 0 : _b.status) === 429 ||
                    /too many requests|rate limit|quota|429/i.test(msg);
                if (isRateLimit) {
                    const backoffMs = 60000; // 60秒はGNewsを呼ばずRSSのみ
                    this.gnewsBackoffUntil = Date.now() + backoffMs;
                    console.warn(`GNews rate-limited. Fallback to RSS only for ${backoffMs / 1000}s.`);
                }
                return [];
            }
        });
    }
    fetchFromNewsAPI(query) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            if (!this.newsapiKey) {
                console.warn('NewsAPI Key is missing.');
                return [];
            }
            try {
                console.log(`NewsAPI Query: ${query}`);
                const response = yield axios_1.default.get(this.newsapiUrl, {
                    params: {
                        q: query,
                        apiKey: this.newsapiKey,
                        language: 'jp',
                        sortBy: 'publishedAt',
                        pageSize: 5
                    },
                    timeout: 10000
                });
                if (!response.data.articles || response.data.articles.length === 0) {
                    return [];
                }
                return response.data.articles.map((article) => {
                    var _a;
                    return ({
                        title: article.title,
                        url: article.url,
                        publishedAt: article.publishedAt,
                        source: ((_a = article.source) === null || _a === void 0 ? void 0 : _a.name) || 'Unknown',
                        summary: article.description
                    });
                });
            }
            catch (error) {
                console.error('NewsAPI Error:', ((_a = error.response) === null || _a === void 0 ? void 0 : _a.data) || error.message);
                return [];
            }
        });
    }
}
exports.NewsService = NewsService;
