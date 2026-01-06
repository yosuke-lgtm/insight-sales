"use strict";
/**
 * 日本標準産業分類に基づく業種マッピング
 * 各業種に対してニュース検索用のクエリを定義
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.INDUSTRY_CLASSIFICATIONS = void 0;
exports.detectIndustryByKeywords = detectIndustryByKeywords;
exports.getNewsQueryByIndustryName = getNewsQueryByIndustryName;
exports.getAllSubCategoryNames = getAllSubCategoryNames;
// 主要な業種分類とニュース検索クエリ
exports.INDUSTRY_CLASSIFICATIONS = [
    {
        code: 'A',
        name: '農業，林業',
        subCategories: [
            { code: '01', name: '農業', keywords: ['農業', '農家', '農産物', '野菜', '米', '果樹'], newsQuery: '"農業" AND ("動向" OR "市場" OR "DX")' },
            { code: '02', name: '林業', keywords: ['林業', '木材', '森林'], newsQuery: '"林業" AND ("動向" OR "市場")' },
        ]
    },
    {
        code: 'B',
        name: '漁業',
        subCategories: [
            { code: '03', name: '漁業', keywords: ['漁業', '水産', '漁船', '養殖'], newsQuery: '"水産" AND ("業界" OR "動向")' },
        ]
    },
    {
        code: 'D',
        name: '建設業',
        subCategories: [
            { code: '06', name: '総合工事業', keywords: ['建設', 'ゼネコン', '施工', '工事', '建築'], newsQuery: '"建設" AND ("受注" OR "業界" OR "DX")' },
            { code: '07', name: '職別工事業', keywords: ['設備工事', '電気工事', '管工事', '内装'], newsQuery: '"建設" AND ("設備" OR "工事")' },
            { code: '08', name: '設備工事業', keywords: ['電気設備', '空調', '給排水'], newsQuery: '"設備工事" AND ("業界" OR "動向")' },
        ]
    },
    {
        code: 'E',
        name: '製造業',
        subCategories: [
            { code: '09', name: '食料品製造業', keywords: ['食品メーカー', '食品製造', '飲料', '菓子'], newsQuery: '"食品" AND ("メーカー" OR "業界" OR "製造")' },
            { code: '11', name: '繊維工業', keywords: ['繊維', 'アパレル', '衣料', '縫製'], newsQuery: '"繊維" OR "アパレル" AND ("業界" OR "動向")' },
            { code: '15', name: '印刷業', keywords: ['印刷', '出版'], newsQuery: '"印刷" AND ("業界" OR "動向")' },
            { code: '16', name: '化学工業', keywords: ['化学', '化粧品', '医薬品', '塗料'], newsQuery: '"化学" AND ("業界" OR "動向")' },
            { code: '18', name: 'プラスチック製品製造業', keywords: ['プラスチック', '樹脂'], newsQuery: '"プラスチック" AND ("業界" OR "動向")' },
            { code: '25', name: 'はん用機械器具製造業', keywords: ['機械', '機器', '装置'], newsQuery: '"機械" AND ("製造" OR "業界")' },
            { code: '28', name: '電子部品・デバイス製造業', keywords: ['半導体', '電子部品', 'デバイス'], newsQuery: '"半導体" OR "電子部品" AND ("業界" OR "動向")' },
            { code: '30', name: '情報通信機械器具製造業', keywords: ['通信機器', 'IT機器'], newsQuery: '"IT" AND ("機器" OR "製造")' },
            { code: '31', name: '輸送用機械器具製造業', keywords: ['自動車', '車両', '航空機'], newsQuery: '"自動車" AND ("業界" OR "動向" OR "EV")' },
        ]
    },
    {
        code: 'F',
        name: '電気・ガス・熱供給・水道業',
        subCategories: [
            { code: '33', name: '電気業', keywords: ['電力', '発電', '送電'], newsQuery: '"電力" AND ("業界" OR "動向" OR "再エネ")' },
            { code: '34', name: 'ガス業', keywords: ['ガス', '都市ガス'], newsQuery: '"ガス" AND ("業界" OR "動向")' },
        ]
    },
    {
        code: 'G',
        name: '情報通信業',
        subCategories: [
            { code: '37', name: '通信業', keywords: ['通信', '携帯', 'モバイル', '5G'], newsQuery: '"通信" AND ("業界" OR "動向" OR "5G")' },
            { code: '39', name: '情報サービス業', keywords: ['IT', 'システム', 'ソフトウェア', 'SaaS', 'DX', 'アプリ', 'クラウド'], newsQuery: '"IT" OR "DX" OR "SaaS" AND ("業界" OR "動向")' },
            { code: '40', name: 'インターネット附随サービス業', keywords: ['Web', 'インターネット', 'EC', 'ポータル'], newsQuery: '"インターネット" AND ("サービス" OR "業界")' },
            { code: '41', name: '映像・音声・文字情報制作業', keywords: ['映像', '動画', 'アニメ', '制作'], newsQuery: '"映像" OR "コンテンツ" AND ("制作" OR "業界")' },
        ]
    },
    {
        code: 'H',
        name: '運輸業，郵便業',
        subCategories: [
            { code: '44', name: '道路貨物運送業', keywords: ['物流', '運送', '配送', 'トラック', '宅配'], newsQuery: '"物流" AND ("業界" OR "動向" OR "2024年問題")' },
            { code: '47', name: '倉庫業', keywords: ['倉庫', '物流センター'], newsQuery: '"倉庫" AND ("物流" OR "業界")' },
        ]
    },
    {
        code: 'I',
        name: '卸売業，小売業',
        subCategories: [
            { code: '50', name: '各種商品卸売業', keywords: ['卸売', '商社', '問屋'], newsQuery: '"卸売" AND ("業界" OR "動向")' },
            { code: '56', name: '各種商品小売業', keywords: ['百貨店', 'スーパー', '小売'], newsQuery: '"小売" AND ("業界" OR "動向")' },
            { code: '58', name: '飲食料品小売業', keywords: ['コンビニ', 'スーパー', '食品小売'], newsQuery: '"小売" AND ("食品" OR "コンビニ")' },
            { code: '60', name: 'その他の小売業', keywords: ['ドラッグストア', '家電量販', 'ホームセンター'], newsQuery: '"小売" AND ("ドラッグストア" OR "家電" OR "動向")' },
            { code: '61', name: '無店舗小売業', keywords: ['EC', '通販', 'ネット通販', 'eコマース'], newsQuery: '"EC" OR "通販" AND ("業界" OR "動向")' },
        ]
    },
    {
        code: 'J',
        name: '金融業，保険業',
        subCategories: [
            { code: '62', name: '銀行業', keywords: ['銀行', '金融機関', 'メガバンク'], newsQuery: '"銀行" AND ("業界" OR "動向" OR "DX")' },
            { code: '64', name: '貸金業，クレジットカード業', keywords: ['クレジット', 'カード', 'フィンテック', '決済'], newsQuery: '"フィンテック" OR "決済" AND ("業界" OR "動向")' },
            { code: '65', name: '金融商品取引業', keywords: ['証券', '投資', '資産運用'], newsQuery: '"証券" AND ("業界" OR "動向")' },
            { code: '67', name: '保険業', keywords: ['保険', '生命保険', '損害保険'], newsQuery: '"保険" AND ("業界" OR "動向")' },
        ]
    },
    {
        code: 'K',
        name: '不動産業，物品賃貸業',
        subCategories: [
            { code: '68', name: '不動産取引業', keywords: ['不動産', 'マンション', '住宅', '賃貸', '分譲'], newsQuery: '"不動産" AND ("業界" OR "動向" OR "市場")' },
            { code: '69', name: '不動産賃貸業・管理業', keywords: ['賃貸管理', 'ビル管理', '不動産管理'], newsQuery: '"不動産" AND ("管理" OR "賃貸")' },
            { code: '70', name: '物品賃貸業', keywords: ['リース', 'レンタル'], newsQuery: '"リース" AND ("業界" OR "動向")' },
        ]
    },
    {
        code: 'L',
        name: '学術研究，専門・技術サービス業',
        subCategories: [
            { code: '72', name: '専門サービス業', keywords: ['コンサルティング', 'コンサル', '士業', '税理士', '会計士', '弁護士', '社労士', '行政書士', '司法書士'], newsQuery: '"コンサルティング" OR "士業" AND ("業界" OR "動向")' },
            { code: '73', name: '広告業', keywords: ['広告', '広告代理店', 'マーケティング', 'PR'], newsQuery: '"広告" AND ("業界" OR "動向" OR "デジタル")' },
            { code: '74', name: '技術サービス業', keywords: ['設計', 'エンジニアリング', '測量', '検査'], newsQuery: '"技術サービス" AND ("業界" OR "動向")' },
        ]
    },
    {
        code: 'M',
        name: '宿泊業，飲食サービス業',
        subCategories: [
            { code: '75', name: '宿泊業', keywords: ['ホテル', '旅館', '宿泊', 'リゾート'], newsQuery: '"ホテル" OR "宿泊" AND ("業界" OR "動向" OR "インバウンド")' },
            { code: '76', name: '飲食店', keywords: ['飲食', 'レストラン', 'カフェ', '居酒屋', 'ラーメン', 'ファストフード'], newsQuery: '"飲食" AND ("業界" OR "動向" OR "外食")' },
        ]
    },
    {
        code: 'N',
        name: '生活関連サービス業，娯楽業',
        subCategories: [
            { code: '78', name: '洗濯・理容・美容・浴場業', keywords: ['美容', 'サロン', 'エステ', 'ネイル', '理容', '美容室', 'ヘアサロン', '脱毛'], newsQuery: '"美容" AND ("サロン" OR "業界" OR "動向")' },
            { code: '79', name: 'その他の生活関連サービス業', keywords: ['旅行', '冠婚葬祭', '結婚式', '葬儀'], newsQuery: '"旅行" OR "ブライダル" AND ("業界" OR "動向")' },
            { code: '80', name: '娯楽業', keywords: ['レジャー', 'アミューズメント', 'パチンコ', 'ゲーム', 'フィットネス', 'ジム', 'スポーツ'], newsQuery: '"レジャー" OR "フィットネス" AND ("業界" OR "動向")' },
        ]
    },
    {
        code: 'O',
        name: '教育，学習支援業',
        subCategories: [
            { code: '81', name: '学校教育', keywords: ['学校', '大学', '専門学校'], newsQuery: '"教育" AND ("業界" OR "動向")' },
            { code: '82', name: 'その他の教育，学習支援業', keywords: ['塾', '予備校', '英会話', 'スクール', '教育', '研修', 'eラーニング'], newsQuery: '"教育" OR "塾" AND ("業界" OR "動向")' },
        ]
    },
    {
        code: 'P',
        name: '医療，福祉',
        subCategories: [
            { code: '83', name: '医療業', keywords: ['医療', '病院', 'クリニック', '診療所', '歯科', '眼科'], newsQuery: '"医療" AND ("業界" OR "動向" OR "DX")' },
            { code: '85', name: '社会保険・社会福祉・介護事業', keywords: ['介護', '福祉', '老人ホーム', 'デイサービス', '訪問介護'], newsQuery: '"介護" AND ("業界" OR "動向" OR "人手不足")' },
        ]
    },
    {
        code: 'R',
        name: 'サービス業（他に分類されないもの）',
        subCategories: [
            { code: '91', name: '職業紹介・労働者派遣業', keywords: ['人材', '派遣', '紹介', '採用', 'HR', 'リクルート', '転職'], newsQuery: '"人材" AND ("業界" OR "動向" OR "採用")' },
            { code: '92', name: 'その他の事業サービス業', keywords: ['ビルメンテナンス', '清掃', 'コールセンター'], newsQuery: '"ビルメンテナンス" OR "BPO" AND ("業界" OR "動向")' },
            { code: '923', name: '警備業', keywords: ['警備', 'セキュリティ', '防犯', '監視', 'ガード'], newsQuery: '"警備" AND ("業界" OR "動向" OR "セキュリティ")' },
        ]
    },
];
/**
 * キーワードから業種を検出する
 */
function detectIndustryByKeywords(text) {
    const lowerText = text.toLowerCase();
    for (const category of exports.INDUSTRY_CLASSIFICATIONS) {
        for (const sub of category.subCategories) {
            for (const keyword of sub.keywords) {
                if (lowerText.includes(keyword.toLowerCase())) {
                    return {
                        categoryCode: category.code,
                        categoryName: category.name,
                        subCategoryCode: sub.code,
                        subCategoryName: sub.name,
                        newsQuery: sub.newsQuery
                    };
                }
            }
        }
    }
    return null;
}
/**
 * 業種名からニュース検索クエリを取得
 */
function getNewsQueryByIndustryName(industryName) {
    const lowerName = industryName.toLowerCase();
    for (const category of exports.INDUSTRY_CLASSIFICATIONS) {
        for (const sub of category.subCategories) {
            if (sub.name.toLowerCase().includes(lowerName) ||
                lowerName.includes(sub.name.toLowerCase())) {
                return sub.newsQuery;
            }
        }
    }
    // フォールバック: 業界名でそのまま検索
    return `"${industryName}" AND ("業界" OR "動向")`;
}
/**
 * 全ての中分類名を取得（Geminiへのプロンプト用）
 */
function getAllSubCategoryNames() {
    const names = [];
    for (const category of exports.INDUSTRY_CLASSIFICATIONS) {
        for (const sub of category.subCategories) {
            names.push(`${sub.name}（${category.name}）`);
        }
    }
    return names;
}
