export interface CompanyProfile {
  name: string;
  corporateNumber?: string;
  domain?: string;
  url?: string;
  address?: string;
  industryCode?: string;
  industryName?: string;
  representative?: string;
  employees?: number;
  capital?: number;
  revenue?: number;
  profit?: number;
  listingStatus: 'Listed' | 'Unlisted' | 'Unknown';
  description?: string;
}

export interface NewsItem {
  title: string;
  url: string;
  publishedAt: string;
  source: string;
  summary?: string;
}

export interface FinancialData {
  year: string;
  revenue: number | string;
  operatingProfit: number | string;
  netProfit?: number | string;
  netIncome?: string; // From Catr/Kanpo
  totalAssets?: number | string;
  netAssets?: number | string;
  capitalRatio?: number | string;
}

export interface AnalysisResult {
  company: CompanyProfile;
  financials: FinancialData[];
  news: {
    company: NewsItem[];
    industry: NewsItem[];
  };
  strategy: {
    pest: string[];
    swot: {
      strengths: string[];
      weaknesses: string[];
      opportunities: string[];
      threats: string[];
      unknowns?: string[];
    };
    salesTalk: string;
    score: number;
  };
}
