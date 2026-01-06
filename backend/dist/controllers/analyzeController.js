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
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeInboundLead = exports.analyzeCompany = void 0;
const corporateService_1 = require("../services/corporateService");
const edinetService_1 = require("../services/edinetService");
const newsService_1 = require("../services/newsService");
const geminiService_1 = require("../services/geminiService");
const scrapingService_1 = require("../services/scrapingService");
const catrService_1 = require("../services/catrService");
const industryClassification_1 = require("../data/industryClassification");
const corporateService = new corporateService_1.CorporateService();
const edinetService = new edinetService_1.EdinetService();
const newsService = new newsService_1.NewsService();
const geminiService = new geminiService_1.GeminiService();
const scrapingService = new scrapingService_1.ScrapingService();
const catrService = new catrService_1.CatrService();
const analyzeCompany = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { companyName, domain, inquiryBody, businessSegment, pageUrl, additionalUrl } = req.body;
        if (!companyName && !domain) {
            return res.status(400).json({ error: 'Company name or domain is required' });
        }
        console.log(`Analyzing: ${companyName} (${domain})`);
        // 1. Identify Company
        const profile = yield corporateService.searchCompany(companyName || domain);
        if (!profile) {
            return res.status(404).json({ error: 'Company not found' });
        }
        // Determine URL for scraping
        let targetUrl = '';
        if (pageUrl && typeof pageUrl === 'string' && (pageUrl.startsWith('http://') || pageUrl.startsWith('https://'))) {
            targetUrl = pageUrl;
        }
        else if (domain) {
            targetUrl = `https://${domain}`;
        }
        // 2. Scrape website first (needed for industry detection)
        const scrapedData = targetUrl
            ? yield scrapingService.fetchPageContent(targetUrl)
            : { title: '', description: '', bodyText: '', recruitLinks: [], techStack: { cms: [], crm: [], ma: [], analytics: [], ec: [], js: [] }, companyInfo: { revenue: '', capital: '', employees: '', founded: '', fiscalYearEnd: '' } };
        // 3. AI-based industry detection (using gemini-2.0-flash-lite)
        // 2段構成: Gemini → キーワードフォールバック
        let quickAnalysis = {
            industry: 'その他サービス業',
            industryCode: '99',
            industryNewsQuery: '"ビジネス" AND ("動向" OR "トレンド")',
            pestleQueries: {
                regulation: '"規制" AND ("動向" OR "改正")',
                clientMarket: '"市場" AND ("動向" OR "トレンド")',
                technology: '"DX" AND ("導入" OR "動向")',
                industry: '"ビジネス" AND ("動向" OR "トレンド")'
            },
            businessType: 'Both',
            estimatedScale: '中小企業',
            mainProducts: [],
            clientIndustries: []
        };
        if (scrapedData.bodyText) {
            // Step 1: Geminiで業種判定 + PESTLE用クエリ生成
            console.log('Step 1: Running AI-based industry detection with PESTLE queries...');
            quickAnalysis = yield geminiService.detectIndustryAndQuickAnalysis(profile.name, scrapedData);
            // Step 2: Geminiが汎用結果を返した場合、キーワードマッチングでフォールバック
            const isGenericResult = quickAnalysis.industry === 'その他サービス業' ||
                quickAnalysis.industryCode === '99' ||
                !quickAnalysis.industry;
            if (isGenericResult) {
                console.log('Step 2: Gemini returned generic result, trying keyword fallback...');
                const keywordResult = (0, industryClassification_1.detectIndustryByKeywords)(scrapedData.bodyText + ' ' + scrapedData.title);
                if (keywordResult) {
                    console.log(`Keyword fallback matched: ${keywordResult.subCategoryName}`);
                    quickAnalysis.industry = keywordResult.subCategoryName;
                    quickAnalysis.industryCode = keywordResult.subCategoryCode;
                    quickAnalysis.industryNewsQuery = keywordResult.newsQuery;
                }
            }
            profile.industryName = quickAnalysis.industry;
        }
        if (!profile.industryName) {
            profile.industryName = 'サービス業';
        }
        // 4. Parallel Fetching (financial data + PESTLE news + Additional URL scraping)
        console.log(`Industry: ${quickAnalysis.industry}`);
        console.log('PESTLE Queries:', quickAnalysis.pestleQueries);
        const [edinetFinancials, catrFinancials, pestleNews, additionalUrlData] = yield Promise.all([
            profile.corporateNumber ? edinetService.getFinancials(profile.corporateNumber) : [],
            catrService.getFinancials(profile.name),
            newsService.getPestleNews(quickAnalysis.pestleQueries),
            additionalUrl ? scrapingService.fetchPageContent(additionalUrl) : Promise.resolve(null)
        ]);
        // Merge Financials: Prefer EDINET if available, else Catr
        const financials = edinetFinancials.length > 0 ? edinetFinancials : catrFinancials;
        // Company news: API first, then supplement with site scraping
        let companyNews = yield newsService.getCompanyNews(profile.name);
        if (companyNews.length === 0 && targetUrl) {
            console.log('News API returned 0 results for company, trying site scraping...');
            companyNews = yield scrapingService.fetchCompanyNews(targetUrl);
        }
        // 全業界ニュースを統合（PESTLE 3カテゴリ）
        const allIndustryNews = [
            ...pestleNews.regulation,
            ...pestleNews.clientMarket,
            ...pestleNews.industry
        ];
        // 3. AI Analysis with Gemini
        const aiAnalysis = yield geminiService.generateStrategyCarte(profile, financials, companyNews, allIndustryNews, scrapedData, inquiryBody, businessSegment, additionalUrlData // Pass scraped additional info (can be null)
        );
        // 4. Construct Full Result
        console.log('News Debug:', {
            companyNews: companyNews.length,
            regulation: pestleNews.regulation.length,
            clientMarket: pestleNews.clientMarket.length,
            industry: pestleNews.industry.length
        });
        const result = {
            company: profile,
            financials,
            news: {
                company: companyNews,
                industry: allIndustryNews,
                // PESTLE categories for detailed display
                pestle: {
                    regulation: pestleNews.regulation,
                    clientMarket: pestleNews.clientMarket,
                    industry: pestleNews.industry
                }
            },
            quickAnalysis: {
                industryCode: quickAnalysis.industryCode,
                businessType: quickAnalysis.businessType,
                estimatedScale: quickAnalysis.estimatedScale,
                mainProducts: quickAnalysis.mainProducts
            },
            strategy: {
                summary: aiAnalysis.summary,
                industrySummary: aiAnalysis.industrySummary,
                industryData: aiAnalysis.industryData,
                techStackAnalysis: aiAnalysis.techStackAnalysis,
                pestle: aiAnalysis.pestle,
                fiveForces: aiAnalysis.fiveForces,
                threeC: aiAnalysis.threeC,
                stp: aiAnalysis.stp,
                marketing: aiAnalysis.marketing,
                businessModel: aiAnalysis.businessModel,
                financialHealth: aiAnalysis.financialHealth,
                swot: aiAnalysis.swot,
                estimatedChallenges: aiAnalysis.estimatedChallenges,
                recruitment: aiAnalysis.recruitment,
                sevenS: aiAnalysis.sevenS,
                businessSummary: aiAnalysis.businessSummary,
                valueChain: aiAnalysis.valueChain,
                salesStrategy: aiAnalysis.salesStrategy,
                callTalk: aiAnalysis.callTalk,
                formDraft: aiAnalysis.formDraft,
                score: aiAnalysis.score
            }
        };
        res.json(result);
    }
    catch (error) {
        console.error('Analysis Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
exports.analyzeCompany = analyzeCompany;
/**
 * GA4からの流入通知用: リード分析エンドポイント
 * リード企業を分析し、LP流入文脈と統合して仮説を返す
 */
const analyzeInboundLead = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { companyName, email, lpTitle, lpUrl, inflowType } = req.body;
        console.log(`Analyzing Inbound Lead: ${companyName || email} via ${lpTitle}`);
        // 1. Identify Company (Prospect)
        let searchKey = companyName;
        if (!searchKey && email) {
            const match = email.match(/@(.+)$/);
            if (match && !['gmail.com', 'yahoo.co.jp'].includes(match[1])) {
                searchKey = match[1]; // Domain
            }
        }
        if (!searchKey) {
            // Cannot identify company to analyze
            return res.json({
                pestle_factors: [],
                hypothesis: '法人・ドメインが特定できないため、詳細分析をスキップしました。',
                sales_hook: ''
            });
        }
        const profile = yield corporateService.searchCompany(searchKey);
        let targetUrl = '';
        if (profile && profile.url) {
            targetUrl = profile.url;
        }
        else if (searchKey && searchKey.includes('.')) {
            targetUrl = `https://${searchKey}`; // pure domain fallback
        }
        // 2. Scrape Prospect Company Site
        // (Only fetch basic content for speed, skipping recursive recursion if possible in future)
        const scrapedData = targetUrl
            ? yield scrapingService.fetchPageContent(targetUrl)
            : { title: companyName || '', description: '', bodyText: '', recruitLinks: [], techStack: { cms: [], crm: [], ma: [], analytics: [], ec: [], js: [] }, companyInfo: { revenue: '', capital: '', employees: '', founded: '', fiscalYearEnd: '' } };
        // 3. Analyze with Gemini
        const result = yield geminiService.analyzeInboundLeadContext(companyName || (profile === null || profile === void 0 ? void 0 : profile.name) || '不明な企業', scrapedData, // { title, description, bodyText } compatible
        lpTitle || '不明なページ', lpUrl || '', inflowType || 'アクセス');
        res.json(result);
    }
    catch (error) {
        console.error('Inbound Analysis Error:', error);
        // Return safe default so GAS doesn't crash
        res.json({
            pestle_factors: [],
            hypothesis: '分析中にエラーが発生しました。',
            sales_hook: ''
        });
    }
});
exports.analyzeInboundLead = analyzeInboundLead;
