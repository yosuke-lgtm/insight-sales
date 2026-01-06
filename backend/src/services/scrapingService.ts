import axios from 'axios';
import * as cheerio from 'cheerio';
// pdf-parse v2 exports a PDFParse class (not a direct function).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PDFParse } = require('pdf-parse');
import { GeminiService } from './geminiService';

export class ScrapingService {
  private geminiService: GeminiService | null = null;

  private getGeminiService(): GeminiService | null {
    if (this.geminiService) return this.geminiService;
    const apiKey = process.env.GEMINI_API_KEY || '';
    if (!apiKey) return null;
    this.geminiService = new GeminiService();
    return this.geminiService;
  }

  async fetchPageContent(url: string): Promise<{
    title: string;
    description: string;
    bodyText: string;
    recruitLinks: string[];
    techStack: {
      cms: string[];
      crm: string[];
      ma: string[];
      analytics: string[];
      ec: string[];
      js: string[];
    };
    companyInfo: {
      revenue: string;
      capital: string;
      employees: string;
      founded: string;
      fiscalYearEnd: string;
    };
  }> {
    try {
      console.log(`Scraping: ${url}`);
      
      // Axios request with arraybuffer to handle binary PDF data
      const response = await axios.get(url, {
        timeout: 15000, // Slightly longer timeout for PDFs
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        responseType: 'arraybuffer' // Important for PDF
      });

      const contentType = response.headers['content-type']?.toLowerCase() || '';
      const contentDisposition = response.headers['content-disposition']?.toLowerCase() || '';

      const dataBuffer = Buffer.isBuffer(response.data)
        ? response.data
        : Buffer.from(response.data);

      const headerSig = dataBuffer.subarray(0, 5).toString('utf8');
      const isPdfByHeader = headerSig === '%PDF-';
      const isPdfByContentType = contentType.includes('application/pdf');
      const isPdfByUrl = url.toLowerCase().includes('.pdf');
      const isPdfByDisposition = contentDisposition.includes('.pdf');
      const isPdf = isPdfByContentType || isPdfByUrl || isPdfByDisposition || isPdfByHeader;

      console.log(`Content-Type: ${contentType}`);

      // Default result structure
      const result = {
        title: '',
        description: '',
        bodyText: '',
        recruitLinks: [] as string[],
        techStack: {
          cms: [] as string[],
          crm: [] as string[],
          ma: [] as string[],
          analytics: [] as string[],
          ec: [] as string[],
          js: [] as string[]
        },
        companyInfo: {
          revenue: '',
          capital: '',
          employees: '',
          founded: '',
          fiscalYearEnd: ''
        }
      };

      // Handle PDF
      if (isPdf) {
        console.log('Processing as PDF...');
        try {
          const parser = new PDFParse({ data: dataBuffer });
          const pdfData = await parser.getText();
          
          result.title = `PDF Document: ${url.split('/').pop() || 'Unknown'}`;
          result.description = 'PDF content extracted via AI Sales OS';
          
          // Clean up text
          let text = (pdfData?.text as string) || '';
          text = text.replace(/\s+/g, ' ').trim();

          // If text is empty/too short, try Gemini OCR on first pages.
          const MIN_PDF_TEXT_LENGTH = 200;
          if (text.length < MIN_PDF_TEXT_LENGTH) {
            const gemini = this.getGeminiService();
            if (gemini) {
              try {
                console.log('PDF text is short; trying OCR with Gemini...');
                const shots = await parser.getScreenshot({
                  imageBuffer: true,
                  desiredWidth: 1200,
                  first: 3
                } as any);
                const images = (shots.pages || [])
                  .slice(0, 3)
                  .map((p: any) => Buffer.from(p.data || []))
                  .filter((b: Buffer) => b.length > 0);

                if (images.length > 0) {
                  const ocrText = await gemini.extractTextFromImages(
                    images,
                    `PDF URL: ${url}`
                  );
                  const cleanedOcr = (ocrText || '').replace(/\s+/g, ' ').trim();
                  if (cleanedOcr.length > text.length) {
                    text = cleanedOcr;
                  }
                }
              } catch (ocrErr) {
                console.warn('Gemini OCR failed:', ocrErr);
              }
            }
          }

          if (text.length > 15000) {
            text = text.substring(0, 15000); // Limit context window
          }
          result.bodyText = text;
          
          console.log(`PDF parsed. Text length: ${result.bodyText.length}`);
          return result;

        } catch (pdfError) {
          console.error('PDF parsing error:', pdfError);
          result.bodyText = 'PDFの読み込みに失敗しました。';
          return result;
        }
      }

      // Handle HTML (buffer to string conversion needed)
      const dataString = Buffer.from(response.data).toString('utf-8');
      const $ = cheerio.load(dataString);

      // Remove script, style, and other non-content elements
      $('script').remove();
      $('style').remove();
      $('nav').remove();
      $('footer').remove();
      $('header').remove();

      result.title = $('title').text().trim();
      result.description = $('meta[name="description"]').attr('content') || '';
      
      // Extract body text (limit length to avoid token limits)
      let bodyText = $('body').text().replace(/\s+/g, ' ').trim();
      if (bodyText.length > 10000) {
        bodyText = bodyText.substring(0, 10000);
      }
      result.bodyText = bodyText;

      // Find recruitment related links (also check img alt attributes)
      const recruitLinks: string[] = [];
      $('a').each((_, element) => {
        const href = $(element).attr('href');
        const text = $(element).text().toLowerCase();
        const imgAlt = $(element).find('img').attr('alt')?.toLowerCase() || '';
        
        if (href && (
          text.includes('recruit') || text.includes('採用') || text.includes('career') ||
          imgAlt.includes('recruit') || imgAlt.includes('採用') || imgAlt.includes('career')
        )) {
          try {
            const absoluteUrl = new URL(href, url).href;
            recruitLinks.push(absoluteUrl);
          } catch (e) {
            // Ignore invalid URLs
          }
        }
      });
      result.recruitLinks = Array.from(new Set(recruitLinks));

      // Tech Stack Detection
      const htmlContent = dataString.toLowerCase();
      // ... (Rest of tech stack logic reused but using result object)
      
      // Re-implement tech stack logic briefly for the result object
      const techStack = result.techStack;
      if (htmlContent.includes('wp-content')) techStack.cms.push('WordPress');
      if (htmlContent.includes('shopify')) techStack.cms.push('Shopify');
      if (htmlContent.includes('wix')) techStack.cms.push('Wix');
      if (htmlContent.includes('studio.design')) techStack.cms.push('Studio');

      if (htmlContent.includes('hubspot')) techStack.crm.push('HubSpot');
      if (htmlContent.includes('salesforce') || htmlContent.includes('pardot')) techStack.crm.push('Salesforce/Pardot');
      if (htmlContent.includes('marketo')) techStack.ma.push('Marketo');
      if (htmlContent.includes('kintone')) techStack.crm.push('Kintone');
      if (htmlContent.includes('sansan')) techStack.crm.push('Sansan');

      if (htmlContent.includes('gtag') || htmlContent.includes('google-analytics')) techStack.analytics.push('GA4');
      if (htmlContent.includes('gtm.js')) techStack.analytics.push('GTM');
      if (htmlContent.includes('hotjar')) techStack.analytics.push('Hotjar');
      if (htmlContent.includes('clarity')) techStack.analytics.push('Microsoft Clarity');

      if (htmlContent.includes('react')) techStack.js.push('React');
      if (htmlContent.includes('vue')) techStack.js.push('Vue.js');
      if (htmlContent.includes('jquery')) techStack.js.push('jQuery');
      if (htmlContent.includes('next.js') || htmlContent.includes('__next')) techStack.js.push('Next.js');
      if (htmlContent.includes('nuxt')) techStack.js.push('Nuxt.js');

      // Company Info Extraction
      const companyInfo = await this.extractCompanyInfo($, url, dataString);
      result.companyInfo = companyInfo;

      return result;

    } catch (error) {
      console.error(`Scraping Error (${url}):`, error);
      return {
        title: '',
        description: '',
        bodyText: '',
        recruitLinks: [],
        techStack: { cms: [], crm: [], ma: [], analytics: [], ec: [], js: [] },
        companyInfo: { revenue: '', capital: '', employees: '', founded: '', fiscalYearEnd: '' }
      };
    }
  }

  private async extractCompanyInfo(
    $: cheerio.CheerioAPI, 
    baseUrl: string, 
    currentHtml: string
  ): Promise<{
    revenue: string;
    capital: string;
    employees: string;
    founded: string;
    fiscalYearEnd: string;
  }> {
    const info = {
      revenue: '',
      capital: '',
      employees: '',
      founded: '',
      fiscalYearEnd: ''
    };

    // Try to extract from current page first
    this.parseCompanyInfoFromHtml($, info);

    const baseUrlObj = new URL(baseUrl);
    
    // Comprehensive list of company info paths used by Japanese corporate sites
    const companyPaths = [
      // Standard paths
      '/company', '/about', '/corporate', '/about-us', '/company-info',
      '/company/', '/about/', '/corporate/', '/about-us/', '/company-info/',
      // Profile pages
      '/corporate/profile.html', '/corporate/outline.html', '/company/profile.html',
      '/about/company.html', '/company/about.html', '/corporate/company.html',
      '/company/index.html', '/corporate/index.html', '/about/index.html',
      '/company/profile', '/corporate/profile', '/about/profile',
      // Japanese patterns
      '/kaisya', '/gaiyou', '/kigyou', '/jigyou',
      '/company/gaiyou', '/corporate/gaiyou',
      // IR / Financials
      '/ir', '/ir/', '/investor', '/investors',
      '/ir/library', '/ir/financial', '/kessan',
      // Recruitment (often contains employee count)
      '/recruit', '/recruit/', '/recruitment', '/careers', '/jobs', '/saiyo',
      '/recruit/index.html', '/careers/index.html', '/saiyo/index.html',
      // Misc
      '/overview', '/company-overview', '/about-company'
    ];

    // Try sitemap.xml first to discover relevant pages
    if (!info.revenue && !info.capital && !info.employees) {
      try {
        console.log('Trying sitemap.xml...');
        const sitemapUrls = [`${baseUrlObj.origin}/sitemap.xml`, `${baseUrlObj.origin}/sitemap_index.xml`];
        
        for (const sitemapUrl of sitemapUrls) {
          try {
            const sitemapResp = await axios.get(sitemapUrl, { timeout: 5000 });
            const $sitemap = cheerio.load(sitemapResp.data, { xmlMode: true });
            
            // Find URLs containing company/profile/about/corporate/recruit keywords
            const relevantUrls: string[] = [];
            $sitemap('loc').each((_, el) => {
              const locUrl = $sitemap(el).text();
              if (locUrl && (
                locUrl.includes('profile') || locUrl.includes('company') || 
                locUrl.includes('corporate') || locUrl.includes('about') ||
                locUrl.includes('gaiyou') || locUrl.includes('kaisya') ||
                locUrl.includes('recruit') || locUrl.includes('career') || locUrl.includes('saiyo')
              )) {
                relevantUrls.push(locUrl);
              }
            });
            
            console.log(`Sitemap found ${relevantUrls.length} relevant URLs`);
            
            // Fetch and parse relevant pages
            for (const pageUrl of relevantUrls.slice(0, 5)) {
              try {
                console.log(`Trying from sitemap: ${pageUrl}`);
                const resp = await axios.get(pageUrl, {
                  timeout: 5000,
                  headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
                });
                const $page = cheerio.load(resp.data);
                this.parseCompanyInfoFromHtml($page, info);
                
                if (info.revenue || info.capital || info.employees) {
                  console.log(`Found company info from sitemap: ${pageUrl}`);
                  break;
                }
              } catch (e) { /* Ignore */ }
            }
            
            if (info.revenue || info.capital || info.employees) break;
          } catch (e) { /* sitemap not found */ }
        }
      } catch (e) { /* Ignore sitemap errors */ }
    }

    // Fallback: Try direct paths
    if (!info.revenue && !info.capital && !info.employees) {
      console.log('Trying direct company paths...');
      for (const path of companyPaths) {
        try {
          const companyUrl = `${baseUrlObj.origin}${path}`;
          console.log(`Trying: ${companyUrl}`);
          
          const resp = await axios.get(companyUrl, {
            timeout: 5000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
          });
          
          const $company = cheerio.load(resp.data);
          this.parseCompanyInfoFromHtml($company, info);
          
          if (info.revenue || info.capital || info.employees) {
            console.log(`Found company info at: ${companyUrl}`);
            break;
          }
        } catch (e) {
          // Ignore errors, continue to next path
        }
      }
    }

    // Still no info? Try root domain if current domain seems to be a subdomain
    if (!info.revenue && !info.capital) {
      const urlObj = new URL(baseUrl);
      const parts = urlObj.hostname.split('.');
      const companyPaths = [
        '/company', '/about', '/corporate', '/about-us', '/company-info',
        '/company/', '/about/', '/corporate/', '/about-us/', '/company-info/',
        '/corporate/profile.html', '/corporate/outline.html', '/company/profile.html',
        '/about/company.html', '/company/about.html', '/corporate/company.html',
        '/company/index.html', '/corporate/index.html', '/about/index.html'
      ];
      
      // Simple heuristic: if we have enough parts, try removing the first one (subdomain)
      let shouldTryRoot = false;
      let rootHostname = '';

      if (parts.length >= 4) {
        // e.g. sub.example.co.jp -> example.co.jp
        shouldTryRoot = true;
        rootHostname = parts.slice(1).join('.');
      } else if (parts.length === 3) {
        // e.g. sub.example.com -> example.com (but exclude example.co.jp)
        const sld = parts[parts.length - 2];
        if (sld !== 'co' && sld !== 'ne' && sld !== 'ac' && sld !== 'go' && sld !== 'or') {
           shouldTryRoot = true;
           rootHostname = parts.slice(1).join('.');
        }
      }

      if (shouldTryRoot && rootHostname) {
         console.log(`Checking root domain: ${rootHostname}`);
         for (const path of companyPaths) {
          try {
            const companyUrl = `${urlObj.protocol}//${rootHostname}${path}`;
            console.log(`Trying root company page: ${companyUrl}`);
            
            const resp = await axios.get(companyUrl, {
              timeout: 5000,
              headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
              }
            });
            
            const $company = cheerio.load(resp.data);
            this.parseCompanyInfoFromHtml($company, info);
            
            if (info.revenue || info.capital) {
              console.log(`Found company info at root domain: ${companyUrl}`);
              break;
            }
          } catch (e) {
            // Ignore
          }
        }
      }
    }

    return info;
  }

  private parseCompanyInfoFromHtml(
    $: cheerio.CheerioAPI, 
    info: { revenue: string; capital: string; employees: string; founded: string; fiscalYearEnd: string }
  ): void {
    // Look for tables or structured data containing company info
    // Common patterns: <th>売上高</th><td>XXX億円</td>
    // or <dt>資本金</dt><dd>XXX万円</dd>
    
    const textContent = $('body').text();
    
    // Revenue (売上高, 売上, 年商)
    const revenuePatterns = [
      /売上高[：:\s]*([0-9,]+(?:\.[0-9]+)?(?:億|万|千万)?円?)/,
      /売上[：:\s]*([0-9,]+(?:\.[0-9]+)?(?:億|万|千万)?円?)/,
      /年商[：:\s]*([0-9,]+(?:\.[0-9]+)?(?:億|万|千万)?円?)/
    ];
    
    for (const pattern of revenuePatterns) {
      const match = textContent.match(pattern);
      if (match && !info.revenue) {
        info.revenue = match[1];
        break;
      }
    }

    // Capital (資本金)
    const capitalMatch = textContent.match(/資本金[：:\s]*([0-9,]+(?:\.[0-9]+)?(?:億|万|千万)?円?)/);
    if (capitalMatch && !info.capital) {
      info.capital = capitalMatch[1];
    }

    // Employees (従業員数, 社員数) - Use [\s\S]*? to handle newlines between label and value
    const employeesPatterns = [
      /従業員数?[\s\S]*?([0-9,]+)\s*(?:名|人)/,
      /社員数[\s\S]*?([0-9,]+)\s*(?:名|人)/
    ];
    
    for (const pattern of employeesPatterns) {
      const match = textContent.match(pattern);
      if (match && !info.employees) {
        info.employees = match[1] + '名';
        break;
      }
    }

    // Founded (設立, 創業)
    const foundedPatterns = [
      /設立[：:\s]*([0-9]{4}年[0-9]{1,2}月?(?:[0-9]{1,2}日)?)/,
      /創業[：:\s]*([0-9]{4}年[0-9]{1,2}月?(?:[0-9]{1,2}日)?)/,
      /設立[：:\s]*([0-9]{4})/
    ];
    
    for (const pattern of foundedPatterns) {
      const match = textContent.match(pattern);
      if (match && !info.founded) {
        info.founded = match[1];
        break;
      }
    }

    // Fiscal Year End (決算)
    const fiscalPatterns = [
      /決算(?:期|月)?[：:\s]*([0-9]{1,2}月)/,
      /([0-9]{1,2}月)決算/
    ];
    
    for (const pattern of fiscalPatterns) {
      const match = textContent.match(pattern);
      if (match && !info.fiscalYearEnd) {
        info.fiscalYearEnd = match[1];
        break;
      }
    }
  }

  /**
   * 企業サイトのお知らせ・ニュース・IRページをスクレイピング
   */
  async fetchCompanyNews(baseUrl: string): Promise<{
    title: string;
    url: string;
    publishedAt: string;
    source: string;
  }[]> {
    const newsItems: { title: string; url: string; publishedAt: string; source: string }[] = [];
    
    try {
      const baseUrlObj = new URL(baseUrl);
      
      // IR/ニュースページのパス（優先度順）
      const newsPaths = [
        '/ir', '/ir/news', '/ir/topics', '/ir/info',  // IR優先（上場企業用）
        '/news', '/news/release', '/newsrelease', 
        '/press', '/pressrelease', '/press-release',
        '/info', '/topics', '/information',
        '/corporate/news', '/company/news',
        '/oshirase', '/whatsnew'
      ];
      
      for (const path of newsPaths) {
        if (newsItems.length >= 5) break; // 5件取得したら終了
        
        try {
          const newsUrl = `${baseUrlObj.origin}${path}`;
          console.log(`Trying news/IR page: ${newsUrl}`);
          
          const resp = await axios.get(newsUrl, {
            timeout: 5000,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
            }
          });
          
          if (resp.status === 200) {
            const $ = cheerio.load(resp.data);
            const pageTitle = $('title').text().toLowerCase();
            const pageText = $('body').text().toLowerCase();
            
            // ニュース/IRページかチェック
            const isNewsPage = pageTitle.includes('news') || pageTitle.includes('お知らせ') || 
                pageTitle.includes('新着') || pageTitle.includes('ir') || pageTitle.includes('投資家') ||
                pageTitle.includes('プレス') || pageTitle.includes('リリース') ||
                pageText.includes('ニュース') || pageText.includes('プレスリリース');
            
            if (isNewsPage) {
              this.parseNewsFromPage($, baseUrlObj.origin, newsItems);
              
              if (newsItems.length > 0) {
                console.log(`Found ${newsItems.length} news items at ${newsUrl}`);
                break;
              }
            }
          }
        } catch (e) {
          // Ignore errors, continue to next path
        }
      }
    } catch (error) {
      console.error('Error fetching company news:', error);
    }
    
    return newsItems.slice(0, 5);
  }

  private parseNewsFromPage(
    $: cheerio.CheerioAPI, 
    baseOrigin: string,
    newsItems: { title: string; url: string; publishedAt: string; source: string }[]
  ): void {
    // ナビゲーションリンクを除外するキーワード
    const navigationKeywords = [
      'サイトマップ', 'english', 'トップ', 'ホーム', 'top', 'home',
      'お問い合わせ', 'contact', 'アクセス', 'access', 'プライバシー',
      'privacy', '会社概要', 'about', '採用', 'recruit', 'career',
      'ログイン', 'login', '検索', 'search', 'menu', 'メニュー',
      'お近くの', 'english', '日本語', 'japanese', 'language',
      'faq', 'よくある質問', 'お客様', 'customer', 'サービス一覧'
    ];
    
    // ニュース記事を判定する関数
    const isValidNewsItem = (title: string, url: string): boolean => {
      const lowerTitle = title.toLowerCase();
      
      // タイトルが短すぎるか長すぎる
      if (title.length < 10 || title.length > 200) return false;
      
      // ナビゲーションリンクを除外
      for (const keyword of navigationKeywords) {
        if (lowerTitle === keyword || lowerTitle.includes(keyword)) {
          return false;
        }
      }
      
      // URLがニュース/プレス/IR関連でない
      const newsUrlPatterns = ['/news', '/press', '/ir', '/release', '/info', '/topics'];
      const hasNewsUrl = newsUrlPatterns.some(p => url.includes(p));
      
      // 日付が含まれているか（ニュース記事の特徴）
      const hasDate = /\d{4}[年./-]\d{1,2}[月./-]\d{1,2}/.test(title) || 
                      /202[0-9]/.test(title);
      
      return hasNewsUrl || hasDate || title.length > 20;
    };
    
    // ニュースリストのセレクター（優先度順）
    const newsSelectors = [
      '.news-list li', '.newsList li', '.news li', '.news-item',
      '.press-list li', '.pressrelease li', '.ir-list li',
      'dl.news dt', 'table.news tr', '.topic-list li',
      'article', '.post', '.entry'
    ];
    
    for (const selector of newsSelectors) {
      $(selector).each((i, element) => {
        if (newsItems.length >= 10) return false;
        
        const $el = $(element);
        let title = '';
        let url = '';
        let date = '';
        
        // リンクを探す
        const $link = $el.find('a').first();
        if ($link.length > 0) {
          title = $link.text().trim();
          const href = $link.attr('href');
          if (href) {
            try {
              url = new URL(href, baseOrigin).href;
            } catch (e) {
              url = href;
            }
          }
        } else if ($el.is('a')) {
          title = $el.text().trim();
          const href = $el.attr('href');
          if (href) {
            try {
              url = new URL(href, baseOrigin).href;
            } catch (e) {
              url = href;
            }
          }
        }
        
        // 日付を探す
        const dateText = $el.text();
        const dateMatch = dateText.match(/(\d{4}[年./-]\d{1,2}[月./-]\d{1,2}日?)/);
        if (dateMatch) {
          date = dateMatch[1];
        }
        
        // 有効なニュースアイテムかチェック
        if (title && url && isValidNewsItem(title, url)) {
          if (!newsItems.some(n => n.title === title)) {
            newsItems.push({
              title,
              url,
              publishedAt: date,
              source: '公式サイト'
            });
          }
        }
      });
      
      if (newsItems.length > 0) break;
    }
  }
}
