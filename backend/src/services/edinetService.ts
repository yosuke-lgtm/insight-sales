import axios from 'axios';
import { FinancialData } from '../models/types';

const EDINET_API_ENDPOINT = 'https://disclosure.edinet-fsa.go.jp/api/v2';

export class EdinetService {
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.EDINET_API_KEY || '';
  }

  async getFinancials(corporateNumber: string): Promise<FinancialData[]> {
    if (!this.apiKey) {
      console.warn('EDINET API Key is missing.');
      return [];
    }

    // Note: This is a simplified implementation. 
    // Real EDINET API requires 2 steps: 
    // 1. Get document list (GET /documents.json)
    // 2. Get document content (GET /documents/{docID}) and parse XBRL/CSV
    // For this prototype, we will mock the parsing logic or just return empty if too complex without a library.
    
    console.log(`Fetching EDINET data for ${corporateNumber}...`);
    
    // TODO: Implement actual EDINET logic
    // For now, return mock data if it matches a test ID, else empty
    return [];
  }
}
