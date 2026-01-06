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
exports.EdinetService = void 0;
const EDINET_API_ENDPOINT = 'https://disclosure.edinet-fsa.go.jp/api/v2';
class EdinetService {
    constructor() {
        this.apiKey = process.env.EDINET_API_KEY || '';
    }
    getFinancials(corporateNumber) {
        return __awaiter(this, void 0, void 0, function* () {
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
        });
    }
}
exports.EdinetService = EdinetService;
