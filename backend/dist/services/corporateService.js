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
exports.CorporateService = void 0;
class CorporateService {
    constructor() {
        this.baseUrl = 'https://api.houjin-bangou.nta.go.jp/4/num';
        this.appId = process.env.NATIONAL_TAX_API_KEY || '';
    }
    searchCompany(name) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.appId) {
                console.warn('National Tax Agency AppID is missing. Using dummy data.');
                return this.getDummyData(name);
            }
            try {
                // TODO: Implement actual API call
                // GET /name?id={appId}&name={name}&type=02&mode=1
                return this.getDummyData(name);
            }
            catch (error) {
                console.error('Corporate API Error:', error);
                return null;
            }
        });
    }
    getDummyData(name) {
        return {
            name: name,
            corporateNumber: '1234567890123',
            address: '東京都新宿区西新宿...',
            industryCode: '',
            industryName: '', // Will be detected from website
            listingStatus: 'Unknown'
        };
    }
    /**
     * Webサイトの内容から業種を推定
     */
    detectIndustryFromContent(bodyText, title) {
        const text = `${title} ${bodyText}`.toLowerCase();
        // 業種キーワードマッピング（優先度順）
        // 各業種にニュース検索用のクエリも定義
        const industryKeywords = [
            // BtoC サービス
            { industry: '美容・エステ', keywords: ['眉毛', 'サロン', 'エステ', '美容', 'ネイル', 'まつげ', '脱毛', 'スパ', '美容室', 'ヘアサロン'], newsQuery: '美容サロン業界' },
            { industry: '飲食店', keywords: ['レストラン', '飲食', 'カフェ', '居酒屋', 'ラーメン', '寿司', '焼肉', 'グルメ', '料理', 'フード'], newsQuery: '飲食業界' },
            { industry: 'フィットネス・スポーツ', keywords: ['ジム', 'フィットネス', 'ヨガ', 'スポーツ', 'トレーニング', 'パーソナル'], newsQuery: 'フィットネス業界' },
            { industry: '旅行・ホテル', keywords: ['旅行', 'ホテル', '宿泊', '観光', 'ツアー', 'トラベル'], newsQuery: '観光業界' },
            { industry: '小売・EC', keywords: ['ショップ', '通販', 'ec', 'ストア', '販売', '小売', 'eコマース'], newsQuery: '小売業界' },
            // BtoB サービス
            { industry: 'ITサービス・SaaS', keywords: ['システム', 'ソフトウェア', 'アプリ', 'web', 'it', 'saas', 'dx', 'クラウド'], newsQuery: 'IT業界 DX' },
            { industry: 'コンサルティング', keywords: ['コンサルティング', 'コンサル', 'アドバイザリー', '経営顧問', '戦略', '士業'], newsQuery: 'コンサルティング業界' },
            { industry: '人材サービス', keywords: ['人材', '採用', '派遣', '転職', 'hr', '紹介', 'リクルート'], newsQuery: '人材業界' },
            { industry: '広告・マーケティング', keywords: ['広告', 'マーケティング', 'pr', 'メディア', '代理店', 'プロモーション'], newsQuery: '広告業界' },
            // 不動産・建設
            { industry: '不動産', keywords: ['不動産', 'マンション', '賃貸', '物件', '住宅', 'リフォーム', '分譲'], newsQuery: '不動産業界' },
            { industry: '建設・工事', keywords: ['建設', '建築', '施工', '工事', 'リノベ', 'ゼネコン', '土木'], newsQuery: '建設業界' },
            // 製造
            { industry: '製造業', keywords: ['製造', '工場', '生産', 'ものづくり', '機械', 'メーカー', '部品'], newsQuery: '製造業界' },
            { industry: '食品メーカー', keywords: ['食品', '飲料', '菓子', '調味料', '加工'], newsQuery: '食品業界' },
            // 医療・福祉
            { industry: '医療・クリニック', keywords: ['医療', '病院', 'クリニック', '歯科', '眼科', '診療'], newsQuery: '医療業界' },
            { industry: '介護・福祉', keywords: ['介護', '福祉', '老人ホーム', 'デイサービス', '訪問'], newsQuery: '介護業界' },
            { industry: '製薬・ヘルスケア', keywords: ['製薬', '医薬品', 'ヘルスケア', '健康', 'サプリ'], newsQuery: 'ヘルスケア業界' },
            // 教育
            { industry: '教育・スクール', keywords: ['教育', '学校', 'スクール', '塾', '研修', 'セミナー', '学習', '英会話'], newsQuery: '教育業界' },
            // 金融・保険
            { industry: '金融', keywords: ['銀行', '証券', '金融', 'ファイナンス', '融資', '資産運用'], newsQuery: '金融業界' },
            { industry: '保険', keywords: ['保険', '生命保険', '損害保険', '共済'], newsQuery: '保険業界' },
            // インフラ・物流
            { industry: '物流・運送', keywords: ['物流', '運送', '配送', '倉庫', 'ロジスティクス', '宅配'], newsQuery: '物流業界' },
            { industry: 'エネルギー', keywords: ['電力', 'ガス', 'エネルギー', '発電', '再エネ'], newsQuery: 'エネルギー業界' },
            // セキュリティ
            { industry: '警備・セキュリティ', keywords: ['警備', 'セキュリティ', '防犯', '監視', 'ガード', '交通誘導'], newsQuery: 'セキュリティ業界' },
        ];
        for (const { industry, keywords } of industryKeywords) {
            for (const keyword of keywords) {
                if (text.includes(keyword)) {
                    console.log(`Detected industry: ${industry} (matched: ${keyword})`);
                    return industry;
                }
            }
        }
        return 'サービス業'; // デフォルト
    }
    /**
     * 業種からニュース検索クエリを取得
     */
    getNewsQueryForIndustry(industryName) {
        const industryNewsMap = {
            '美容・エステ': '美容サロン業界',
            '飲食店': '飲食業界',
            'フィットネス・スポーツ': 'フィットネス業界',
            '旅行・ホテル': '観光業界',
            '小売・EC': '小売業界',
            'ITサービス・SaaS': 'IT業界 DX',
            'コンサルティング': 'コンサルティング業界',
            '人材サービス': '人材業界',
            '広告・マーケティング': '広告業界',
            '不動産': '不動産業界',
            '建設・工事': '建設業界',
            '製造業': '製造業界',
            '食品メーカー': '食品業界',
            '医療・クリニック': '医療業界',
            '介護・福祉': '介護業界',
            '製薬・ヘルスケア': 'ヘルスケア業界',
            '教育・スクール': '教育業界',
            '金融': '金融業界',
            '保険': '保険業界',
            '物流・運送': '物流業界',
            'エネルギー': 'エネルギー業界',
            '警備・セキュリティ': 'セキュリティ業界',
            'サービス業': 'ビジネストレンド',
        };
        return industryNewsMap[industryName] || `${industryName}業界`;
    }
}
exports.CorporateService = CorporateService;
