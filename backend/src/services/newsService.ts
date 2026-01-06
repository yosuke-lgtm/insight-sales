import axios from 'axios';
import { NewsItem } from '../models/types';

export class NewsService {
  private gnewsApiKey: string;
  private newsapiKey: string;
  private gnewsUrl = 'https://gnews.io/api/v4/search';
  private newsapiUrl = 'https://newsapi.org/v2/everything';
  // GNewsがレートリミットになった際のバックオフ（ミリ秒で保持）
  private gnewsBackoffUntil = 0;

  constructor() {
    this.gnewsApiKey = process.env.GNEWS_API_KEY || '';
    this.newsapiKey = process.env.NEWSAPI_KEY || '';
  }

  /**
   * 企業ニュース取得（GNews + PR Times + Google News 並列）
   * ブランド名と正式名称の両方で検索
   */
  async getCompanyNews(companyName: string): Promise<NewsItem[]> {
    console.log(`Fetching company news for: ${companyName}`);
    
    // 企業名からブランド名を抽出（ALSOKなど）
    const brandName = this.extractBrandName(companyName);
    const searchNames = brandName ? [companyName, brandName] : [companyName];
    
    // 全ソースを並列実行
    const allResults: NewsItem[] = [];
    
    for (const name of searchNames) {
      const normalizedQuery = this.normalizeCompanyQuery(name);
      const [gnewsResults, prtimesResults, googleResults] = await Promise.all([
        this.fetchFromGNews(normalizedQuery, false),
        this.fetchFromPRTimesRSS(normalizedQuery),
        this.fetchFromGoogleNewsRSS(normalizedQuery)
      ]);
      allResults.push(...prtimesResults, ...googleResults, ...gnewsResults);
    }
    
    // 古いニュースをフィルタ（1年以内のみ）
    let filteredResults = this.filterRecentNews(allResults);
    
    // 重複除去
    const seen = new Set<string>();
    const results = filteredResults.filter(item => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });
    
    console.log(`Company news total: ${results.length} items (before filter: ${allResults.length})`);
    return results.slice(0, 10);

  }

  /**
   * ニュース検索用に企業名を正規化
   * - 「｜」などの説明区切りを除去
   * - クエリ演算子/記号を除去（GNewsのsyntax error対策）
   * - 長さを制限
   */
  private normalizeCompanyQuery(rawName: string): string {
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
  private extractBrandName(companyName: string): string | null {
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
      if (match) return match[0];
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
  private async fetchFromPRTimesRSS(companyName: string): Promise<NewsItem[]> {
    try {
      // 「株式会社」を除去してシンプルな企業名で検索
      const simpleName = companyName
        .replace(/株式会社|有限会社|合同会社/g, '')
        .trim();

      // PR Timesのcompany_name RSSは「企業名検索」用途のみ。
      // PESTLEなどの一般クエリや記号混じりは404になりやすいのでスキップ。
      const looksLikeGenericQuery =
        /["'()]/.test(simpleName) ||
        /\b(AND|OR|NOT)\b/i.test(simpleName) ||
        simpleName.includes(' ') ||
        simpleName.length > 40;
      if (looksLikeGenericQuery) {
        return [];
      }
      
      const encodedName = encodeURIComponent(simpleName);
      const url = `https://prtimes.jp/main/action.php?run=rss&company_name=${encodedName}`;
      console.log(`PR Times RSS Query: ${simpleName}`);
      
      const response = await axios.get(url, {
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
      
      const items: NewsItem[] = [];
      const xml = response.data;
      const ct = response.headers['content-type']?.toLowerCase() || '';
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
    } catch (error: any) {
      const status = error.response?.status;
      if (status === 404) {
        console.warn('PR Times RSS not found for query:', companyName);
      } else {
        console.error('PR Times RSS Error:', status ? `${status} ${error.message}` : error.message);
      }
      return [];
    }
  }


  async getPestleNews(queries: {
    regulation: string;
    clientMarket: string;
    technology: string;
    industry: string;
  }): Promise<{
    regulation: NewsItem[];
    clientMarket: NewsItem[];
    industry: NewsItem[];
  }> {
    console.log('Fetching PESTLE news with queries:', queries);
    
    // API呼び出し数を抑えるため、重要な2つ + industryの3カテゴリに絞る
    const [regulationNews, clientMarketNews, industryNews] = await Promise.all([
      this.fetchIndustryNews(queries.regulation),
      this.fetchIndustryNews(queries.clientMarket),
      this.fetchIndustryNews(queries.industry)
    ]);

    return {
      regulation: regulationNews,
      clientMarket: clientMarketNews,
      industry: industryNews
    };
  }

  /**
   * 従来の業界ニュース取得（後方互換）
   */
  async getIndustryNews(industryQuery: string): Promise<NewsItem[]> {
    return this.fetchIndustryNews(industryQuery);
  }

  async getIndustryTrendNews(industryQuery: string): Promise<NewsItem[]> {
    return [];  // PESTLE統合済み
  }


  /**
   * 業界ニュース専用
   * Note: GNews + Google News RSS + PR Times を並列実行
   */
  private async fetchIndustryNews(query: string): Promise<NewsItem[]> {
    // GNews, Google News RSS, PR Times を並列実行
    const [gnewsResults, googleRssResults, prtimesResults] = await Promise.all([
      this.fetchFromGNews(query, false),
      this.fetchFromGoogleNewsRSS(query),
      this.fetchFromPRTimesRSS(query)
    ]);
    
    // 結果をマージ
    let results = [...prtimesResults, ...googleRssResults, ...gnewsResults];
    
    // 両方空の場合のみ NewsAPI を試す
    if (results.length === 0) {
      console.log('All sources returned empty, trying NewsAPI...');
      results = await this.fetchFromNewsAPI(query);
    }
    
    // 古いニュースをフィルタ（2024年以降のみ）
    results = this.filterRecentNews(results);
    
    // URLベースで重複除去
    const seen = new Set<string>();
    results = results.filter(item => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });
    
    return results.slice(0, 5); // 最大5件
  }

  /**
   * 古いニュースをフィルタ（1年以内のニュースのみ）
   */
  private filterRecentNews(items: NewsItem[]): NewsItem[] {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    
    return items.filter(item => {
      if (!item.publishedAt) return true; // 日付がない場合は含める
      
      try {
        const pubDate = new Date(item.publishedAt);
        return pubDate >= oneYearAgo;
      } catch {
        return true; // パースできない場合は含める
      }
    });
  }

  /**
   * Google News RSS - 無料・日本語対応良好
   */
  private async fetchFromGoogleNewsRSS(query: string): Promise<NewsItem[]> {
    try {
      const encodedQuery = encodeURIComponent(query);
      const url = `https://news.google.com/rss/search?q=${encodedQuery}&hl=ja&gl=JP&ceid=JP:ja`;
      console.log(`Google News RSS Query: ${query}`);
      
      const response = await axios.get(url, {
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
      const items: NewsItem[] = [];
      const xml = response.data;
      const ct = response.headers['content-type']?.toLowerCase() || '';
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
    } catch (error: any) {
      const status = error.response?.status;
      console.error('Google News RSS Error:', status ? `${status} ${error.message}` : error.message);
      return [];
    }
  }

  /**
   * XMLタグから値を抽出するヘルパー
   */
  private extractXmlTag(xml: string, tagName: string): string {
    const regex = new RegExp(`<${tagName}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tagName}>|<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`);
    const match = xml.match(regex);
    return match ? (match[1] || match[2] || '').trim() : '';
  }

  /**
   * HTMLエンティティをデコード
   */
  private decodeHtmlEntities(text: string): string {
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
  private async fetchFromGNews(query: string, titleOnly: boolean = false): Promise<NewsItem[]> {
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
      
      const params: any = {
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
      
      const response = await axios.get(this.gnewsUrl, {
        params,
        timeout: 10000
      });

      if (!response.data.articles || response.data.articles.length === 0) {
        return [];
      }

      return response.data.articles.map((article: any) => ({
        title: article.title,
        url: article.url,
        publishedAt: article.publishedAt,
        source: article.source.name,
        summary: article.description
      }));
    } catch (error: any) {
      const msg = error.response?.data || error.message || '';
      console.error('GNews Error:', msg);

      // レートリミット系の文言が含まれる場合は一定時間バックオフ
      const isRateLimit =
        error?.response?.status === 429 ||
        /too many requests|rate limit|quota|429/i.test(msg);

      if (isRateLimit) {
        const backoffMs = 60_000; // 60秒はGNewsを呼ばずRSSのみ
        this.gnewsBackoffUntil = Date.now() + backoffMs;
        console.warn(`GNews rate-limited. Fallback to RSS only for ${backoffMs / 1000}s.`);
      }

      return [];
    }
  }

  private async fetchFromNewsAPI(query: string): Promise<NewsItem[]> {
    if (!this.newsapiKey) {
      console.warn('NewsAPI Key is missing.');
      return [];
    }

    try {
      console.log(`NewsAPI Query: ${query}`);
      const response = await axios.get(this.newsapiUrl, {
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

      return response.data.articles.map((article: any) => ({
        title: article.title,
        url: article.url,
        publishedAt: article.publishedAt,
        source: article.source?.name || 'Unknown',
        summary: article.description
      }));
    } catch (error: any) {
      console.error('NewsAPI Error:', error.response?.data || error.message);
      return [];
    }
  }
}
