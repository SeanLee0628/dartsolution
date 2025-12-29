import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// 정적 파일 제공 (Vite 빌드 결과물)
app.use(express.static(path.join(__dirname, 'dist')));

// 1. DART API 프록시
app.use('/api', createProxyMiddleware({
    target: 'https://opendart.fss.or.kr',
    changeOrigin: true,
    pathRewrite: { '^/api': '/api' },
    onProxyRes: (proxyRes, req, res) => {
        // CORS 헤더 추가 (필요 시)
        proxyRes.headers['Access-Control-Allow-Origin'] = '*';
    }
}));

// 2. 공공데이터포털(주식) API 프록시
app.use('/stock-api', createProxyMiddleware({
    target: 'http://apis.data.go.kr/1160100/service/GetStockSecuritiesInfoService',
    changeOrigin: true,
    pathRewrite: { '^/stock-api': '' },
    onProxyRes: (proxyRes, req, res) => {
        proxyRes.headers['Access-Control-Allow-Origin'] = '*';
    }
}));

// SPA 라우팅 처리 (모든 요청을 index.html로)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Domestic Proxy Server running on http://localhost:${PORT}`);
    console.log(`- Proxying /api -> https://opendart.fss.or.kr/api`);
    console.log(`- Proxying /stock-api -> http://apis.data.go.kr/...`);
});
