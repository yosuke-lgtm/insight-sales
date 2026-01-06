import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1'; // 一部環境で0.0.0.0が禁止されるためループバックをデフォルトに

import { analyzeCompany, analyzeInboundLead } from './controllers/analyzeController';

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/api/analyze', analyzeCompany);
app.post('/api/analyze-inbound-lead', analyzeInboundLead);

app.listen(Number(PORT), HOST, () => {
  console.log(`Server is running on http://${HOST}:${PORT}`);
});
