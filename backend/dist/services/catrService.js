"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CatrService = void 0;
const axios_1 = __importDefault(require("axios"));
const cheerio = __importStar(require("cheerio"));
class CatrService {
    constructor() {
        this.baseUrl = 'https://catr.jp';
    }
    getFinancials(companyName) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                console.log(`Searching catr.jp for: ${companyName}`);
                // 1. Search for the company
                const searchUrl = `${this.baseUrl}/search?word=${encodeURIComponent(companyName)}`;
                const searchResponse = yield axios_1.default.get(searchUrl, {
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
                const companyResponse = yield axios_1.default.get(companyUrl, {
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
                $company('tr').each((_, row) => {
                    const text = $company(row).text();
                    if (text.includes('当期純利益') || text.includes('純利益')) {
                        const val = $company(row).find('td').text().trim();
                        if (!netIncome)
                            netIncome = this.cleanNumber(val);
                    }
                    if (text.includes('資産の部') || text.includes('総資産') || text.includes('資産合計')) {
                        const val = $company(row).find('td').last().text().trim();
                        if (!totalAssets)
                            totalAssets = this.cleanNumber(val);
                    }
                });
                const financials = [];
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
            }
            catch (error) {
                console.error('Error scraping catr.jp:', error);
                return [];
            }
        });
    }
    cleanNumber(text) {
        // Normalize whitespace and return the value (often includes unit like 千円)
        return text.replace(/\s+/g, ' ').trim();
    }
}
exports.CatrService = CatrService;
