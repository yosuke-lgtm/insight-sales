import axios from 'axios';
import * as cheerio from 'cheerio';
import { FinancialData } from '../models/types';

export class CatrService {
  private baseUrl = 'https://catr.jp';

  async getFinancials(companyName: string): Promise<FinancialData[]> {
    try {
      console.log(`Searching catr.jp for: ${companyName}`);
      
      // 1. Search for the company
      const searchUrl = `${this.baseUrl}/search?word=${encodeURIComponent(companyName)}`;
      const searchResponse = await axios.get(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        timeout: 10000
      });

      const $search = cheerio.load(searchResponse.data);
      
      // Find the first matching company link
      let targetLink = '';
      const firstResult = $search('.company_name a').first();
      
      if (firstResult.length > 0) {
        targetLink = firstResult.attr('href') || '';
      }

      if (!targetLink) {
        console.log('No company found on catr.jp');
        return [];
      }

      // 2. Fetch the company page
      const companyUrl = `${this.baseUrl}${targetLink}`;
      console.log(`Fetching company page: ${companyUrl}`);
      
      const companyResponse = await axios.get(companyUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        timeout: 10000
      });

      const $company = cheerio.load(companyResponse.data);
      
      // 3. Extract Financial Data
      let netIncome = '';
      let totalAssets = '';
      
      // Iterate over all table rows to find key financial values
      $company('tr').each((_: number, row: any) => {
        const text = $company(row).text();
        if (text.includes('当期純利益') || text.includes('純利益')) {
           const val = $company(row).find('td').text().trim();
           if (!netIncome) netIncome = this.cleanNumber(val);
        }
        if (text.includes('資産の部') || text.includes('総資産') || text.includes('資産合計')) {
           const val = $company(row).find('td').last().text().trim();
           if (!totalAssets) totalAssets = this.cleanNumber(val);
        }
      });

      const financials: FinancialData[] = [];

      if (netIncome || totalAssets) {
        financials.push({
          year: 'Latest (Kanpo)',
          revenue: '-',
          operatingProfit: '-',
          netIncome: netIncome || '-',
          totalAssets: totalAssets || '-'
        });
        console.log(`Catr.jp found: netIncome=${netIncome}, totalAssets=${totalAssets}`);
      }

      return financials;

    } catch (error) {
      console.error('Error scraping catr.jp:', error);
      return [];
    }
  }

  private cleanNumber(text: string): string {
    // Normalize whitespace and return the value (often includes unit like 千円)
    return text.replace(/\s+/g, ' ').trim();
  }
}
