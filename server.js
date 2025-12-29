
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());

// 정적 파일 제공 (Vite 빌드 결과물)
app.use(express.static(path.join(__dirname, 'dist')));

// 1. DART API 프록시
app.use('/api', createProxyMiddleware({
    target: 'https://opendart.fss.or.kr',
    changeOrigin: true,
    pathRewrite: { '^/api': '/api' },
    onProxyRes: (proxyRes, req, res) => {
        proxyRes.headers['Access-Control-Allow-Origin'] = '*';
    }
}));

// 2. 공공데이터포털(주식) API 프록시
app.use('/stock-api', createProxyMiddleware({
    target: 'https://apis.data.go.kr/1160100/service/GetStockSecuritiesInfoService',
    changeOrigin: true,
    pathRewrite: (path, req) => {
        // Remove /stock-api and then remove trailing slash before query string
        return path.replace('/stock-api', '').replace(/\/(\?|$)/, '$1');
    },
    onProxyRes: (proxyRes, req, res) => {
        proxyRes.headers['Access-Control-Allow-Origin'] = '*';
    }
}));

// SPA 라우팅 처리 (모든 요청을 index.html로)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Domestic Proxy Server running on port ${PORT}`);
});
