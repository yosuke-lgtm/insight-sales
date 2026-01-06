import { GoogleGenerativeAI } from '@google/generative-ai';
import { CompanyProfile, FinancialData, NewsItem } from '../models/types';

export class GeminiService {
  private genAI: GoogleGenerativeAI;
  private modelCandidates = ['gemini-2.5-flash-lite', 'gemini-2.0-flash-lite', 'gemini-2.0-flash'];
  // Vision/OCR用（マルチモーダル対応モデル）
  private visionModelCandidates = ['gemini-2.5-flash-lite', 'gemini-2.0-flash-lite', 'gemini-2.0-flash'];

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY || '';
    if (!apiKey) {
      console.warn('Gemini API Key is missing.');
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  private isRetryableError(err: any): boolean {
    const msg = typeof err === 'string' ? err : err?.message || '';
    return /429|rate limit|quota exceeded|503|unavailable|overloaded/i.test(msg);
  }

  // 429系で落ちたら次のモデルに切り替えるフォールバック呼び出し
  private async generateWithFallback(prompt: string, useLiteOnly = false): Promise<string> {
    const candidates = useLiteOnly
      ? ['gemini-2.5-flash-lite', 'gemini-2.0-flash-lite']
      : this.modelCandidates;

    for (const modelName of candidates) {
      try {
        const model = this.genAI.getGenerativeModel({ model: modelName });
        const res = await model.generateContent(prompt);
        return res.response.text();
      } catch (err: any) {
        const retryable = this.isRetryableError(err);
        console.warn(`Gemini call failed on ${modelName}:`, err?.message || err);
        if (!retryable) {
          throw err;
        }
        // リトライ可能なら次の候補へ
      }
    }

    throw new Error('All Gemini model calls failed (rate limited or other errors)');
  }

  /**
   * 画像（PDFのページ等）からテキストを抽出するOCR
   * - 画像はPNG/JPEGのBuffer配列を想定
   * - 429等で落ちたらvisionModelCandidatesでフォールバック
   */
  async extractTextFromImages(images: Buffer[], hint?: string): Promise<string> {
    if (!images || images.length === 0) return '';

    const basePrompt = `
あなたはOCRエンジンです。以下の画像に含まれるテキストを、可能な限り正確に日本語で抽出してください。
図表や表の内容も、読み取れる範囲でテキスト化してください。
出力は抽出したテキストのみ。説明や前置き、箇条書きのラベルは不要です。
${hint ? `\n補足: ${hint}\n` : ''}
`;

    const imageParts = images.map((buf) => ({
      inlineData: {
        mimeType: 'image/png',
        data: buf.toString('base64')
      }
    }));

    for (const modelName of this.visionModelCandidates) {
      try {
        const model = this.genAI.getGenerativeModel({ model: modelName });
        const res = await model.generateContent({
          contents: [
            {
              role: 'user',
              parts: [{ text: basePrompt }, ...imageParts]
            }
          ]
        } as any);
        return res.response.text();
      } catch (err: any) {
        const retryable = this.isRetryableError(err);
        console.warn(`Gemini OCR call failed on ${modelName}:`, err?.message || err);
        if (!retryable) {
          throw err;
        }
      }
    }

    throw new Error('All Gemini OCR model calls failed (rate limited or other errors)');
  }

  /**
   * Webサイト情報から業種を推定し、PESTLE分析用のニュースクエリを生成（軽量モデル使用）
   * 4つの切り口でクエリを生成: Regulation, ClientMarket, Technology, Industry
   */
  async detectIndustryAndQuickAnalysis(
    companyName: string,
    scrapedData: { title: string; description: string; bodyText: string }
  ): Promise<{
    industry: string;
    industryCode: string;
    industryNewsQuery: string;
    pestleQueries: {
      regulation: string;    // 法規制・政策
      clientMarket: string;  // 顧客市場・需要
      technology: string;    // 技術動向
      industry: string;      // 業界動向
    };
    businessType: string;
    estimatedScale: string;
    mainProducts: string[];
    clientIndustries: string[];  // 顧客業界
  }> {
    const prompt = `
以下のWebサイト情報から、この企業の業種判定と、PESTLE分析用のニュース検索クエリを生成してください。

## 企業名
${companyName}

## Webサイト情報
タイトル: ${scrapedData.title}
説明: ${scrapedData.description}
本文（抜粋）: ${scrapedData.bodyText.substring(0, 2500)}

## 重要な指示
1. この企業の「顧客（クライアント）」が誰かを特定してください
2. GNews APIは複雑なクエリが苦手なので、【シンプルなキーワード2〜3語】にしてください
3. ANDは使わず、スペース区切りで記述してください（例: 弁護士 広告規制）

## 回答形式（必ずJSON形式で）
{
  "industryCode": "72",
  "industry": "専門サービス業",
  "businessType": "BtoB",
  "estimatedScale": "中小企業",
  "mainProducts": ["Webマーケティング支援", "士業向けコンサル", "BPOサービス"],
  "clientIndustries": ["弁護士", "司法書士", "税理士", "医療機関"],
  "pestleQueries": {
    "regulation": "弁護士 広告規制",
    "clientMarket": "債務整理 増加",
    "technology": "リーガルテック 導入",
    "industry": "士業 マーケティング"
  }
}

## クエリ作成ルール（重要）
- 2〜3語のシンプルなキーワードにする
- ORやANDは使わない（GNewsが正しく処理できない）
- 「業界」「動向」「サービス業」などの汎用的すぎる語は【禁止】
- 必ず【企業の具体的な強み・製品・専門領域】をキーワードに含める
  - 悪い例: "サービス業 法規制"（広すぎるため風営法などが混じる）
  - 良い例: "警備業法 改正"、"ホームセキュリティ 市場"、"防犯カメラ AI"
- regulation（法規制）は、その業界特有の法律名を含める
- clientMarket（市場）は、顧客業界の具体的な課題を含める

JSONのみを返してください。
`;

    try {
      const text = await this.generateWithFallback(prompt, true);
      
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        console.log('Quick analysis with PESTLE queries:', parsed);
        
        // Geminiが返すキー名を正規化（political→regulation, economic→clientMarket等）
        const pq = parsed.pestleQueries || {};
        const normalizedQueries = {
          regulation: pq.regulation || pq.political || pq.legal || '',
          clientMarket: pq.clientMarket || pq.economic || pq.social || '',
          technology: pq.technology || pq.technological || '',
          industry: pq.industry || ''
        };
        
        // 空のクエリにはデフォルト値を設定
        const industryName = parsed.industry || 'サービス業';
        if (!normalizedQueries.regulation) normalizedQueries.regulation = `${industryName} 法規制`;
        if (!normalizedQueries.clientMarket) normalizedQueries.clientMarket = `${industryName} 市場`;
        if (!normalizedQueries.technology) normalizedQueries.technology = `${industryName} DX`;
        if (!normalizedQueries.industry) normalizedQueries.industry = `${industryName} 業界`;
        
        return {
          industry: parsed.industry || 'その他サービス業',
          industryCode: parsed.industryCode || '99',
          industryNewsQuery: normalizedQueries.industry,
          pestleQueries: normalizedQueries,
          businessType: parsed.businessType || 'Both',
          estimatedScale: parsed.estimatedScale || '中小企業',
          mainProducts: parsed.mainProducts || [],
          clientIndustries: parsed.clientIndustries || []
        };

      }
    } catch (error) {
      console.error('Quick analysis error:', error);
    }

    // フォールバック
    return {
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
  }

  async generateStrategyCarte(
    company: CompanyProfile,
    financials: FinancialData[],
    companyNews: NewsItem[],
    industryNews: NewsItem[],
    scrapedData: { 
      title: string; 
      description: string; 
      bodyText: string; 
      recruitLinks: string[];
      techStack: { cms: string[]; crm: string[]; ma: string[]; analytics: string[]; ec: string[]; js: string[] };
      companyInfo?: { revenue: string; capital: string; employees: string; founded: string; fiscalYearEnd: string };
    },
    inquiryBody?: string,
    businessSegment?: string, // 対象事業（複数事業がある場合）
    additionalUrlData?: { title: string; description: string; bodyText: string } | null // 追加参考URLの情報
  ): Promise<{
    summary: string;
    industrySummary: string;
    industryData: { marketSize: string; growthRate: string; companyCount: string; laborPopulation: string };
    techStackAnalysis: { maturity: string; tools: string[]; missing: string[]; hypothesis: string };
    pestle: { political: string; economic: string; social: string; technological: string; legal: string; environmental: string; futureOutlook: string; conclusion: string };
    fiveForces: { rivalry: string; newEntrants: string; substitutes: string; suppliers: string; buyers: string; futureOutlook: string; conclusion: string };
    threeC: { customer: string; competitor: string; company: string; conclusion: string };
    stp: { segmentation: string; targeting: string; positioning: string; conclusion: string };
    marketing: { valueProposition: string; ksf: string[]; conclusion: string };
    businessModel: { costStructure: string; unitEconomics: string; economicMoat: string; conclusion: string };
    financialHealth: { 
      status: string; 
      concern: string; 
      investmentCapacity: string;
      budgetCycle: string;
      decisionSpeed: string;
      conclusion: string; 
    };
    swot: { strengths: string[]; weaknesses: string[]; opportunities: string[]; threats: string[]; unknowns?: string[]; conclusion: string };
    estimatedChallenges: string[];
    recruitment: { jobTypes: string[]; count: string; phase: string; conclusion: string };
    sevenS: { strategy: string; structure: string; systems: string; sharedValues: string; style: string; staff: string; skills: string };
    businessSummary: { summary: string; serviceClass: string; customerSegment: string; revenueModel: string; conclusion: string };
    valueChain: { ksf: string[]; stages: { name: string; activities: string[]; significance: string }[]; conclusion: string };
    salesStrategy: string;
    callTalk: string;
    formDraft: { short: string; long: string };
    score: number;
  }> {
    const prompt = `
あなたは世界トップクラスの戦略コンサルタント兼BtoBセールスのエキスパートです。

## 重要な指示
**必ずGoogle検索を使用して、対象企業の最新情報（IR発表、プレスリリース、業界動向、競合情報）を調査した上で分析してください。**
提供された情報だけでなく、あなた自身で最新の公開情報を検索・収集し、それを分析に反映させてください。

以下の企業情報、財務データ、ニュース、Webサイト情報、**利用ツール（Tech Stack）**を統合し、極めて具体的かつ洞察に富んだ「企業戦略カルテ」を作成してください。
各分析パートには、必ず**「結論（Conclusion）」**を含め、営業担当者が一目で要点を掴めるようにしてください。

**特にバリューチェーン分析においては、採用情報（募集職種から推測される注力プロセス）や企業ニュース（新規事業や提携から推測される強化領域）を反映させ、単なる一般論ではない、その企業独自の分析を行ってください。**

## 表現ルール（重要）
- 分析本文の中で重要なキーワード/結論/数値は **太字**（Markdownの **...**）で強調してください。
- 「情報が見つからない/不明/未確認」は **弱み（Weaknesses）に含めない** でください。そうした項目は swot.unknowns に入れてください。
- techStackAnalysis.hypothesis は **空欄にせず必ず** 記述してください（情報が不足する場合でも、推定根拠と仮説を簡潔に書く）。

## 対象企業情報
- 企業名: ${company.name}
- 業種: ${company.industryName || '不明'}
- 所在地: ${company.address || '不明'}
- 上場区分: ${company.listingStatus}
${financials.length > 0 ? `- 売上: ${financials[0].revenue}億円\n- 営業利益: ${financials[0].operatingProfit}億円\n- 純利益: ${financials[0].netIncome || '-'} (Catr/EDINET)` : ''}
${businessSegment ? `
## ⚠️ 分析対象事業
**「${businessSegment}」事業に焦点を絞って分析してください。**
複数事業を持つ企業の場合でも、上記事業のみを対象とし、その事業における強み・弱み・市場環境・競合・営業戦略を詳細に分析してください。
` : ''}

## 成長フェーズ判定基準（ヒント）
以下の基準を参考に、企業の現状を分析し、最適な提案方針を導き出してください。

**1. 拡大投資期 (Aggressive Growth)**
- 特徴: 売上増、営業利益は低めor赤字、採用増、新規事業が多い
- 提案方針: **「攻めの投資」**。MA / SaaS / 採用支援などが最も刺さる。

**2. 停滞期 (Flat)**
- 特徴: 売上横ばい、プレスリリース減少、採用抑制
- 提案方針: **「改善・効率化」**。コスト削減、業務整理、DXによる生産性向上が刺さる。

**3. 衰退期 (Decline)**
- 特徴: 売上減、人員削減、ネガティブニュース
- 提案方針: リスクが高いため慎重に。またはV字回復のための抜本的改革提案。

## Webサイト情報 (Scraped)
- タイトル: ${scrapedData.title}
- 説明: ${scrapedData.description}
- 本文要約: ${scrapedData.bodyText.substring(0, 3000)}...
- 採用ページリンク数: ${scrapedData.recruitLinks.length}

- 採用ページリンク数: ${scrapedData.recruitLinks.length}
- スクレイピングされた企業情報:
  - 売上高: ${scrapedData.companyInfo?.revenue || '不明'}
  - 資本金: ${scrapedData.companyInfo?.capital || '不明'}
  - 従業員数: ${scrapedData.companyInfo?.employees || '不明'}
  - 設立: ${scrapedData.companyInfo?.founded || '不明'}
  - 決算: ${scrapedData.companyInfo?.fiscalYearEnd || '不明'}

## Tech Stack (検出されたツール)
- CMS: ${scrapedData.techStack.cms.join(', ') || '不明'}
- CRM/MA: ${scrapedData.techStack.crm.concat(scrapedData.techStack.ma).join(', ') || '不明'}
- Analytics: ${scrapedData.techStack.analytics.join(', ') || '不明'}
- JS Frameworks: ${scrapedData.techStack.js.join(', ') || '不明'}

## 最新ニュース（企業）
${companyNews.slice(0, 5).map(n => `- ${n.title}`).join('\n') || 'なし'}

## 最新ニュース（業界・トレンド）
${industryNews.slice(0, 5).map(n => `- ${n.title}`).join('\n') || 'なし'}

${inquiryBody ? `## 問い合わせ内容\n${inquiryBody}` : ''}

${additionalUrlData ? `
## ⚠️ 追加参考URL情報
ユーザーが分析のために追加で指定した参考URLの情報です。この内容も重要な考慮材料として分析・提案に反映させてください。
- タイトル: ${additionalUrlData.title}
- 概要: ${additionalUrlData.description}
- 本文: ${additionalUrlData.bodyText.substring(0, 3000)}...
` : ''}

## 出力形式 (JSON)
以下のJSON形式で出力してください。

\`\`\`json
{
  "summary": "企業サマリ（5行程度。事業内容だけでなく、現在の市場での立ち位置や直近の動きを含めて）",
  "industrySummary": "業界要約（5行程度。市場の成熟度、主要なトレンド、破壊的イノベーションの兆候など）",
  "industryData": {
    "marketSize": "市場規模（兆円・推定可）",
    "growthRate": "市場成長率（%・推定可）",
    "companyCount": "企業数推移（増加/横ばい/減少）",
    "laborPopulation": "労働人口（増加/減少/人手不足感）"
  },
  "techStackAnalysis": {
    "maturity": "DX成熟度（未導入/導入初期/活用期/先進的）",
    "tools": ["検出されたツールから推測される主要スタック"],
    "missing": ["導入すべきだが欠けているツール（例：MAが無い、分析ツールが弱いなど）"],
    "hypothesis": "ツール構成から読み取れる組織課題や注力領域（例：HubSpotがあるためインバウンド強化中だが、MA未活用でリードナーチャリングに課題ありそう、など）"
  },
  "businessSummary": {
    "summary": "事業要約（3行）",
    "serviceClass": "サービス分類",
    "customerSegment": "顧客セグメント",
    "revenueModel": "収益モデル",
    "conclusion": "事業構造から見える強みと脆さの結論"
  },
  "valueChain": {
    "ksf": ["KSF1", "KSF2", "KSF3"],
    "stages": [
      {
        "name": "フェーズ1（業界特有の工程名。例：製造業なら調達/設計、小売なら仕入）",
        "activities": ["具体的な活動内容（採用情報やニュースから得られた具体的な取り組みや注力ポイントを含めること）"],
        "significance": "貢献内容"
      },
      {
        "name": "フェーズ2（業界特有の工程名。例：製造業なら製造/加工、小売なら店舗運営）",
        "activities": ["具体的な活動内容（採用情報やニュースから得られた具体的な取り組みや注力ポイントを含めること）"],
        "significance": "貢献内容"
      },
      {
        "name": "フェーズ3（業界特有の工程名。例：製造業なら物流/出荷、小売なら販売）",
        "activities": ["具体的な活動内容（採用情報やニュースから得られた具体的な取り組みや注力ポイントを含めること）"],
        "significance": "貢献内容"
      },
      {
        "name": "フェーズ4（業界特有の工程名。例：製造業ならアフター、小売ならCS）",
        "activities": ["具体的な活動内容（採用情報やニュースから得られた具体的な取り組みや注力ポイントを含めること）"],
        "significance": "貢献内容"
      }
    ],
    "conclusion": "バリューチェーン分析から見える差別化ポイントと強化すべき領域"
  },
  "businessModel": {
    "costStructure": "コスト構造（固定費型/変動費型、主なコスト要因）",
    "unitEconomics": "事業経済性（LTV/CAC、利益率の傾向）",
    "economicMoat": "経済的な堀（参入障壁の源泉）",
    "conclusion": "ビジネスモデルの持続可能性に関する結論"
  },
  "financialHealth": {
    "status": "財務状況と規模感。スクレイピングされた従業員数（${scrapedData.companyInfo?.employees || '不明'}）や売上高（${scrapedData.companyInfo?.revenue || '不明'}）を必ず明記すること。例: '従業員数1,950名の大規模企業で、売上高も安定している'",
    "concern": "財務上の懸念点（あれば）",
    "investmentCapacity": "投資余力（高/中/低）。利益状況や事業の安定性から推定",
    "budgetCycle": "予算決裁の時期（一般的な日本企業なら3月、外資なら12月など、決算月: ${scrapedData.companyInfo?.fiscalYearEnd || '不明'} から推測）",
    "decisionSpeed": "意思決定スピード（速い/普通/遅い）。オーナー企業か大企業か等から推測",
    "conclusion": "財務視点でのターゲット優先度記述"
  },
  "recruitment": {
    "jobTypes": ["募集職種（'営業', 'SE', 'マーケティング'など具体的に列挙。採用ページURL: ${scrapedData.recruitLinks.join(', ')} の内容や本文から推測）"],
    "count": "求人数（多い/普通/少ない）",
    "phase": "成長フェーズ（立ち上げ/拡大/成熟/第二創業）",
    "conclusion": "採用動向から読み取れる経営の注力ポイント"
  },
  "sevenS": {
    "strategy": "企業の戦略・方向性",
    "structure": "組織構造（事業部制/機能別/マトリクスなど）",
    "systems": "業務プロセス・ITシステム",
    "sharedValues": "企業理念・価値観・文化",
    "style": "経営スタイル（トップダウン/ボトムアップ/現場主導など）",
    "staff": "人材の特徴・採用傾向",
    "skills": "組織の強み・コアコンピタンス"
  },
  "pestle": {
    "political": "政治・規制環境が企業に与える影響（プラス面・マイナス面を含む）",
    "economic": "経済環境が企業活動に与える影響（プラス面・マイナス面を含む）",
    "social": "社会動向が事業に与える影響（プラス面・マイナス面を含む）",
    "technological": "技術変化が事業・競争力に与える影響（プラス面・マイナス面を含む）",
    "legal": "法規制の変化が事業運営に与える影響（プラス面・マイナス面を含む）",
    "environmental": "環境問題・サステナビリティが事業に与える影響（プラス面・マイナス面を含む）",
    "futureOutlook": "PESTLE全体から見た3-5年後の未来予測",
    "conclusion": "マクロ環境が企業に与えるインパクトの結論"
  },
  "fiveForces": {
    "rivalry": "『強/中/弱』判定に加え、ニュースから読み取れる具体的な競合の動きや争点を詳述（例：「強：セコムとの価格競争に加え、IT系スタートアップの参入により激化」）",
    "newEntrants": "『高/中/低』判定に加え、異業種からの参入ニュースや技術トレンドからリアルな脅威を詳述",
    "substitutes": "『高/中/低』判定に加え、単なる類似サービスだけでなく、最新技術による代替（例：AIカメラ）を詳述",
    "suppliers": "『強/中/弱』判定に加え、ニュースや提携情報から推測されるサプライヤーとの関係性を詳述",
    "buyers": "『強/中/弱』判定に加え、導入事例やニュースから具体的な顧客層を特定し、交渉力を詳述",
    "futureOutlook": "5Fから見た業界構造の未来変化（3-5年後）",
    "conclusion": "業界内での競争優位性に関する結論"
  },
  "swot": {
    "strengths": ["強み"],
    "weaknesses": ["弱み"],
    "opportunities": ["機会"],
    "threats": ["脅威"],
    "unknowns": ["追加調査すべき不明点（弱みではない）"],
    "conclusion": "SWOTから導き出される戦略の方向性"
  },
  "stp": {
    "segmentation": "市場をどのような軸で分割しているか（業種別/規模別/地域別/課題別など）。具体的な軸と、その理由を記述",
    "targeting": "どのセグメントを狙っているか。具体的なターゲット像（例：従業員50-300名の製造業、ITリテラシーが低い経営者層など）を記述。『中小企業』のような曖昧な表現は禁止",
    "positioning": "競合と比較してどのような立ち位置を取っているか。価格帯、専門性、サービス範囲などを具体的に記述",
    "conclusion": "STP戦略の一貫性と市場適合性に関する評価"
  },
  "threeC": {
    "customer": "主要顧客の具体像（業種、規模、課題、検討理由）。『中小企業』のような曖昧な表現ではなく、『従業員100名以下の製造業で、人手不足に悩む経営者』のように詳細に記述",
    "competitor": "主要競合企業を2-3社、具体的な社名で挙げる。社名が不明な場合は『〇〇系の競合』のように特徴で記述。『同業他社』という表現は禁止",
    "company": "自社の強み・特徴を具体的に記述（技術力、価格優位性、サポート体制、実績など）",
    "conclusion": "3C分析から導き出されるKSF（成功要因）を具体的に記述"
  },
  "marketing": {
    "valueProposition": "顧客に提供する具体的な価値（コスト削減なら何%、時間短縮なら何時間など、可能な限り数値化）",
    "ksf": ["KSF1: 具体的な成功要因（例：24時間サポート体制）", "KSF2: 具体的な成功要因（例：業界特化型のノウハウ）"],
    "conclusion": "顧客に選ばれる理由の結論"
  },
  "estimatedChallenges": ["推定課題1（経営レベル）", "推定課題2"],
  "salesStrategy": "営業戦略の提案（上記の分析を踏まえ、誰に、何を、どう提案すべきか）",
  "callTalk": "以下の電話営業用トークスクリプトテンプレートを使用し、{KW}や{ターゲット}を分析結果に基づいて埋めた台本を作成。改行は\\nとして出力すること。\n\n【テンプレート】\nお世話になっております。Zenkenの担当者です。\n\n弊社は、{ターゲット業界}向けに{事業分野}の専門メディアを企画・運営しておりまして、\n今回、新しく「{KW}」専門メディアを立ち上げる予定があり、\nその中で御社をぜひご紹介させていただきたくお電話いたしました。\n\nこの企画は、一般的なポータルサイトとは違って、\n一つの特定分野について深く情報発信し、カタログの一括資料請求ではなく、\n「{KW}」をとことん専門的に扱うメディアを立ち上げるものです。\n\nそうすることで興味本意の軽い資料請求ではなく、\n「{KW}」を能動的に探している本気度の高い問い合わせを獲得できる企画です。\n\n実際に同価格帯の企業様では、指名案件が増えた、平均単価25％アップといった成果も出ております。\n\nご興味をお持ちいただけるようであれば、一度、オンラインで概要をご紹介できればと思いますが、\n来週以降でご都合いかがでしょうか？",
  "formDraft": {
    "short": "短いフォーム営業文（50文字）。要点を絞って。",
    "long": "以下のテンプレートを使用し、分析結果（PEST分析、USP、ターゲットなど）に基づいて空欄＜＞を埋めた営業メール文案を作成してください。改行は\\nとして出力すること。\n\n【テンプレート】\n件名: 【ご相談】「＜メディアのテーマ＞」専門メディアの立ち上げに伴う掲載のご相談\n\n本文:\n＜会社名＞\n＜ご担当者名＞ 様\n\nお世話になっております。\nZenken株式会社の担当者と申します。\n\nこの度、弊社では「＜メディアのテーマ＞」に特化した専門メディアを立ち上げる予定です。\nぜひ御社の＜サービス名＞をご紹介させていただきたく、ご連絡を差し上げました。\n\n▼詳細\n＜対象となるペルソナ（例：〇〇に課題を持つ経営者層）＞に向けて、\n＜具体的に紹介する内容（例：成功事例や制度概要、検討時のポイントなど）＞を掘り下げた、\n成約に結び付きやすい問い合わせを発生させるメディアです。\n\n＜PEST分析（特にSocial/Environmental/Political）を踏まえた社会的・業界的背景＞を受けて、\n＜ターゲットユーザーのニーズや関心が＞高まっております。\nその中で、御社の＜専門性やUSP＞をご紹介させていただきたく存じます。\n\n他業界での事例では、\n「商談化率が5倍になった！」「受注率が3倍になった！」とお喜びいただいている戦略です。\n\n有償の企画ですが、ご興味をお持ちいただけるようでしたら、\nぜひ一度、Zoomにて本企画の詳細をご説明させていただければ幸いです。\n\n■日程調整\n下記のリンクよりご都合のよろしいお日にちをご登録くださいませ。\nhttps://meetings.hubspot.com/kouichi-hiramatsu/round\n\nお忙しい中、恐れ入りますが、\nどうぞよろしくお願いいたします。"
  },
  "score": 75
}
\`\`\`

※「score」は、この企業が「新しいソリューション（特にDXや効率化ツール）」を導入する可能性（受注確度）を0-100でスコアリングしてください。
- 80以上: 成長企業で投資意欲が高く、課題も明確（今すぐアプローチすべき）
- 50-79: 課題はあるが予算や優先順位に懸念あり
- 49以下: 保守的、または財務状況が厳しく新規投資が難しい
`;

    // Retry logic with exponential backoff
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Gemini API call attempt ${attempt}...`);
        const text = await this.generateWithFallback(prompt);
        
        // Extract JSON from response
        const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch && jsonMatch[1]) {
          console.log('Gemini API success!');
          const parsed = JSON.parse(jsonMatch[1]);
          return await this.ensureConclusions(parsed, company);
        }
        
        // Try parsing the whole response as JSON
        try {
          const parsed = JSON.parse(text);
          return await this.ensureConclusions(parsed, company);
        } catch {
          console.warn('Could not parse Gemini response as JSON');
        }
        
        return this.getDefaultResponse();
      } catch (error: any) {
        console.error(`Gemini API Error (attempt ${attempt}):`, error.message || error);
        
        // If rate limited, wait and retry
        if (this.isRetryableError(error) && attempt < maxRetries) {
          const waitTime = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
          console.log(`Retryable error. Waiting ${waitTime}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
        
        if (attempt === maxRetries) {
          return this.getDefaultResponse();
        }
      }
    }
    
    return this.getDefaultResponse();
  }

  private getMissingConclusionPaths(result: any): string[] {
    const required = [
      ['pestle', 'conclusion'],
      ['fiveForces', 'conclusion'],
      ['threeC', 'conclusion'],
      ['stp', 'conclusion'],
      ['marketing', 'conclusion'],
      ['businessModel', 'conclusion'],
      ['financialHealth', 'conclusion'],
      ['swot', 'conclusion'],
      ['recruitment', 'conclusion'],
      ['businessSummary', 'conclusion'],
      ['valueChain', 'conclusion']
    ];

    const isMissing = (value: unknown) => {
      if (typeof value !== 'string') return true;
      const normalized = value.trim();
      return (
        normalized.length === 0 ||
        normalized === '-' ||
        normalized === '不明' ||
        normalized === '情報取得中...' ||
        normalized === '分析中'
      );
    };

    const missing: string[] = [];
    for (const path of required) {
      let cur: any = result;
      for (const key of path) {
        cur = cur?.[key];
      }
      if (isMissing(cur)) missing.push(path.join('.'));
    }
    return missing;
  }

  private setByPath(target: any, path: string, value: string) {
    const keys = path.split('.').filter(Boolean);
    if (keys.length === 0) return;
    let cur = target;
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!cur[key] || typeof cur[key] !== 'object') cur[key] = {};
      cur = cur[key];
    }
    cur[keys[keys.length - 1]] = value;
  }

  private async ensureConclusions(result: any, company: CompanyProfile) {
    const missing = this.getMissingConclusionPaths(result);
    if (missing.length === 0) return result;

    try {
      const sections: Record<string, any> = {};
      for (const path of missing) {
        const sectionKey = path.split('.')[0];
        if (sections[sectionKey]) continue;
        sections[sectionKey] = result?.[sectionKey];
      }

      const repairPrompt = `
あなたは戦略コンサルタントです。次のJSONは企業戦略カルテの結果ですが、いくつかの conclusion（結論）フィールドが空欄または「-」になっています。
対象企業: ${company.name}

## 依頼
- missingPaths に含まれる各パスに対して、conclusion の文章を **1〜3文** で補完してください。
- 既存の他フィールド（本文/箇条書き）を根拠にし、推測は「〜の可能性」として慎重に書いてください。
- 出力は JSON のみ。キーは missingPaths の各値（例: "pestle.conclusion"）で、値は補完した文字列。
- 余計なキーは出力しないでください。

missingPaths:
${JSON.stringify(missing)}

sections:
${JSON.stringify(sections)}
`;

      const text = await this.generateWithFallback(repairPrompt, true);
      const match = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/\{[\s\S]*\}/);
      if (!match) return result;

      const patch = JSON.parse(match[1] || match[0]);
      if (!patch || typeof patch !== 'object') return result;

      for (const [path, value] of Object.entries(patch)) {
        if (!missing.includes(path)) continue;
        if (typeof value !== 'string' || value.trim().length === 0) continue;
        this.setByPath(result, path, value.trim());
      }
    } catch (e) {
      console.warn('ensureConclusions failed:', e);
    }

    return result;
  }

  /**
   * インバウンドリードの流入文脈（Context）を分析し、仮説を生成する
   * - 企業の外部環境（PESTLE）
   * - LPのテーマ（直近の関心）
   * これらを掛け合わせて、「なぜ今、この資料をDLしたのか？」を言語化する。
   */
  async analyzeInboundLeadContext(
    companyName: string,
    scrapedData: { title: string; description: string; bodyText: string },
    lpTitle: string,
    lpUrl: string,
    inflowType: string // '資料DL' | 'お問い合わせ' etc.
  ): Promise<{
    pestle_factors: string[]; // ['Social(人材不足)', 'Tech(DX)']
    hypothesis: string;       // 「人材不足の課題に対し、DXによる効率化を検討中...」
    sales_hook: string;       // 営業トークの切り出し
  }> {
    const prompt = `
あなたはBtoBマーケティングとインサイドセールスのプロフェッショナルです。
以下の情報を統合し、「このリード（企業）が、なぜこのタイミングで、このLP（ランディングページ）に関心を持ったのか？」という**来訪仮説**を構築してください。

## リード企業情報
- 企業名: ${companyName}
- 企業サイト要約: ${scrapedData.description}
- 事業内容(抜粋): ${scrapedData.bodyText.substring(0, 1000)}

## 流入情報 (Context)
- アクション: ${inflowType}
- 閲覧ページ(LP): ${lpTitle}
- URL: ${lpUrl}

## 分析プロセス
1. **外部環境分析 (Macro Context)**:
   - 企業情報から、この企業が直面しているであろう外部環境要因（PESTLE）を推測してください。
   - 特に「Social(社会課題: 人手不足など)」「Legal(法規制)」「Economic(コスト)」等の観点で、BtoBサービス導入の引き金になりそうなものを探してください。

2. **流入意図の特定 (Micro Context)**:
   - LPのタイトル（"${lpTitle}"）から、担当者が具体的に何を探しているか（比較、事例、基礎知識、コスト感など）を特定してください。

3. **仮説の統合 (Synthesis)**:
   - 「Macro Context（背景）」と「Micro Context（きっかけ）」をつなげてください。
   - 例: 「【Social: 建設業の2024年問題(人手不足)】の対策として、【Micro: 施工管理システムの比較】を行っている」

## 出力形式 (JSONのみ)
\`\`\`json
{
  "pestle_factors": ["🌏Social(人手不足)", "⚖️Legal(電子帳簿保存法)"],
  "hypothesis": "建設業界の2024年問題（人手不足）を背景に、業務効率化の手段として施工管理システムを比較検討している可能性が高い。（情報収集フェーズ）",
  "sales_hook": "「建設業界でも2024年問題への対策が進んでいますが、御社では現場の省力化についてどのような取り組みをされていますか？」"
}
\`\`\`

JSONのみを返してください。その他チャットなどの前置きは不要です。
`;

    try {
      // Use flash-lite for speed if possible, otherwise flash
      const text = await this.generateWithFallback(prompt, true);
      const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
         return JSON.parse(jsonMatch[1] || jsonMatch[0]);
      }
    } catch (e) {
      console.error('Inbound context analysis failed:', e);
    }

    return {
      pestle_factors: [],
      hypothesis: `LP「${lpTitle}」への関心が確認されました。`,
      sales_hook: `${lpTitle}についてのご状況はいかがでしょうか？`
    };
  }


  private getDefaultResponse() {
    return {
      summary: '情報取得中...',
      industrySummary: '情報取得中...',
      industryData: { marketSize: '-', growthRate: '-', companyCount: '-', laborPopulation: '-' },
      techStackAnalysis: { maturity: '-', tools: [], missing: [], hypothesis: '-' },
      pestle: { political: '-', economic: '-', social: '-', technological: '-', legal: '-', environmental: '-', futureOutlook: '-', conclusion: '-' },
      fiveForces: { rivalry: '-', newEntrants: '-', substitutes: '-', suppliers: '-', buyers: '-', futureOutlook: '-', conclusion: '-' },
      threeC: { customer: '-', competitor: '-', company: '-', conclusion: '-' },
      stp: { segmentation: '-', targeting: '-', positioning: '-', conclusion: '-' },
      marketing: { valueProposition: '-', ksf: [], conclusion: '-' },
      businessModel: { costStructure: '-', unitEconomics: '-', economicMoat: '-', conclusion: '-' },
      financialHealth: { status: '-', concern: '-', investmentCapacity: '-', budgetCycle: '-', decisionSpeed: '-', conclusion: '-' },
      swot: { strengths: [], weaknesses: [], opportunities: [], threats: [], unknowns: [], conclusion: '-' },
      estimatedChallenges: ['分析中'],
      recruitment: { jobTypes: [], count: '-', phase: '-', conclusion: '-' },
      sevenS: { strategy: '-', structure: '-', systems: '-', sharedValues: '-', style: '-', staff: '-', skills: '-' },
      businessSummary: { summary: '-', serviceClass: '-', customerSegment: '-', revenueModel: '-', conclusion: '-' },
      valueChain: { ksf: [], stages: [], conclusion: '-' },
      salesStrategy: '分析中',
      callTalk: 'お忙しいところ恐れ入ります。',
      formDraft: { short: '分析中', long: '分析中' },
      score: 0
    };
  }
}
