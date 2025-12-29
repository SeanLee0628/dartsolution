const API_KEY = '577d4d3fff35faf9705ef7383b323d98e87a84bd';
const STOCK_API_KEY = '87d0bffe5d1544a89e2d299ad91baff546740fd4e83ccf0b4d2986c804c8b8b7'; // User provided
const BASE_URL = '/api'; // Proxied by Vite
const STOCK_BASE_URL = '/stock-api';

const ELEMENTS = {
    companyInput: document.getElementById('companyInput'),
    searchBtn: document.getElementById('searchBtn'),
    status: document.getElementById('search-status'),
    results: document.getElementById('results-section'),
    displayCompany: document.getElementById('displayCompanyName'),
    loading: document.getElementById('loading-overlay'),
    tableHeader: document.getElementById('tableHeader'),
    tableBody: document.getElementById('tableBody')
};

let currentCorpCode = null;
let currentCorpName = null;

const REPORT_CODES = {
    q1: '11013', // 1분기
    q2: '11012', // 반기
    q3: '11014', // 3분기
    q4: '11011', // 사업보고서
};

let corpCodesMap = null;

async function loadCorpCodes() {
    if (corpCodesMap) return corpCodesMap;
    try {
        const response = await fetch('/corp_codes.json');
        corpCodesMap = await response.json();
        return corpCodesMap;
    } catch (err) {
        console.error('Failed to load corp codes', err);
        return {};
    }
}

async function searchCompany(name) {
    try {
        setStatus('데이터베이스에서 회사를 찾는 중...', 'info');
        const map = await loadCorpCodes();
        const trimmedName = name.trim();

        // 1. Direct lookup (Exact Match)
        if (map[trimmedName]) {
            currentCorpCode = map[trimmedName];
            currentCorpName = trimmedName;
            return { corpCode: currentCorpCode, corpName: currentCorpName };
        }

        // 2. Case-insensitive lookup
        const lowerName = trimmedName.toLowerCase();
        const keys = Object.keys(map);

        // Check for exact case-insensitive match
        const exactMatch = keys.find(k => k.toLowerCase() === lowerName);
        if (exactMatch) {
            currentCorpCode = map[exactMatch];
            currentCorpName = exactMatch;
            return { corpCode: currentCorpCode, corpName: currentCorpName };
        }

        // 3. Partial match (Case-insensitive)
        const partialMatches = keys.filter(k => k.toLowerCase().includes(lowerName));
        if (partialMatches.length > 0) {
            // Sort to find the shortest match which is usually the most likely intent (e.g. '삼성전자' vs '삼성전자우')
            // But prefer matches that start with the query
            partialMatches.sort((a, b) => {
                const aStarts = a.toLowerCase().startsWith(lowerName);
                const bStarts = b.toLowerCase().startsWith(lowerName);
                if (aStarts && !bStarts) return -1;
                if (!aStarts && bStarts) return 1;
                return a.length - b.length;
            });

            currentCorpName = partialMatches[0];
            currentCorpCode = map[currentCorpName];
            return { corpCode: currentCorpCode, corpName: currentCorpName };
        }

        return await searchCompanyViaAPI(name);
    } catch (err) {
        setStatus(err.message, 'error');
        throw err;
    }
}

async function searchCompanyViaAPI(name) {
    const url = `${BASE_URL}/list.json?crtfc_key=${API_KEY}&corp_name=${encodeURIComponent(name)}&bgn_de=20240101`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.status === '000') {
        const match = data.list[0];
        currentCorpCode = match.corp_code;
        currentCorpName = match.corp_name;
        return { corpCode: currentCorpCode, corpName: currentCorpName };
    }
    throw new Error('회사를 찾을 수 없습니다.');
}

function generateQuarterList() {
    const quarters = [];
    let year = 2025;
    let q = 3; // Latest Q3 2025

    for (let i = 0; i < 20; i++) {
        quarters.push({ year: year.toString(), q: `q${q}` });
        q--;
        if (q < 1) {
            q = 4;
            year--;
        }
    }
    return quarters;
}

async function fetchFinancialData(corpCode) {
    showLoading(true);
    const qList = generateQuarterList();
    const results = [];

    try {
        // Fetch in chunks of 5 to avoid browser request limits/API throttling
        for (let i = 0; i < qList.length; i += 5) {
            const chunk = qList.slice(i, i + 5);
            const promises = chunk.map(target =>
                fetch(`${BASE_URL}/fnlttSinglAcntAll.json?crtfc_key=${API_KEY}&corp_code=${corpCode}&bsns_year=${target.year}&reprt_code=${REPORT_CODES[target.q]}&fs_div=CFS`)
                    .then(res => res.json())
                    .then(data => ({
                        year: target.year,
                        q: target.q,
                        data: data.status === '000' ? processFinancialList(data.list) : { error: data.message }
                    }))
            );
            const chunkResults = await Promise.all(promises);
            results.push(...chunkResults);
        }

        // Post-process Flow indicators (Pure Quarter Calculation)
        calculatePureQuarters(results);

        return results;
    } catch (err) {
        console.error(err);
        setStatus('데이터를 불러오지 못했습니다.', 'error');
    } finally {
        showLoading(false);
    }
}

function processFinancialList(list) {
    const extracted = {};
    const findItem = (names) => list.find(i => names.includes(i.account_nm.replace(/\s/g, '').replace('(손실)', '')));

    const indicators = [
        { key: 'revenue', names: ['매출액', '수익(매출액)', '영업수익'] },
        { key: 'costOfSales', names: ['매출원가', '영업원가'] },
        { key: 'grossProfit', names: ['매출총이익', '매출총손익'] },
        { key: 'operatingIncome', names: ['영업이익'] },
        { key: 'netIncome', names: ['당기순이익', '연결당기순이익', '분기순이익', '반기순이익'] },
        { key: 'totalAssets', names: ['자산총계'] },
        { key: 'totalLiabilities', names: ['부채총계'] },
        { key: 'totalEquity', names: ['자본총계'] }
    ];

    indicators.forEach(ind => {
        const item = findItem(ind.names);
        if (item) {
            const raw = BigInt(item.thstrm_amount.replace(/,/g, ''));
            extracted[ind.key] = { raw, formatted: formatCurrency(raw) };
        } else {
            extracted[ind.key] = { raw: 0n, formatted: '-' };
        }
    });

    // Per user request: Calculate Gross Profit = Revenue - Cost of Sales
    if (extracted.revenue.raw !== 0n && extracted.costOfSales.raw !== 0n) {
        const calculatedGrossProfit = extracted.revenue.raw - extracted.costOfSales.raw;
        extracted.grossProfit = {
            raw: calculatedGrossProfit,
            formatted: formatCurrency(calculatedGrossProfit)
        };
    }

    const epsItem = list.find(i => i.account_nm.includes('계속영업기본주당이익')) ||
        list.find(i => i.account_nm.includes('기본주당이익')) ||
        list.find(i => i.account_nm.includes('기본주당순이익')) ||
        list.find(i => i.account_nm.includes('기본주당분기순이익')) ||
        list.find(i => i.account_nm.includes('기본주당반기순이익')) ||
        list.find(i => i.account_nm.includes('주당순이익'));
    if (epsItem) {
        const raw = parseFloat(epsItem.thstrm_amount.replace(/,/g, ''));
        extracted.eps = { raw, formatted: formatNumber(raw) };
    } else {
        extracted.eps = { raw: 0, formatted: '-' };
    }

    return extracted;
}

function calculatePureQuarters(results) {
    const findRes = (y, q) => results.find(r => r.year === y && r.q === q);
    const flowKeys = ['revenue', 'grossProfit', 'operatingIncome', 'netIncome'];

    results.forEach(res => {
        if (res.data.error) return;

        if (res.q === 'q4') {
            // Find Q1, Q2, Q3 for the same year to subtract
            const q1 = findRes(res.year, 'q1');
            const q2 = findRes(res.year, 'q2');
            const q3 = findRes(res.year, 'q3');

            flowKeys.forEach(key => {
                const total = res.data[key].raw;
                if (total === 0n) return;
                const prevSum = (q1?.data[key]?.raw || 0n) + (q2?.data[key]?.raw || 0n) + (q3?.data[key]?.raw || 0n);
                const pure = total - prevSum;
                res.data[key].displayVal = formatCurrency(pure);
            });
        }
    });
}

function formatCurrency(val) {
    if (val === undefined || val === null || val === '-') return '-';
    let num = (typeof val === 'bigint') ? Number(val) : Number(val.toString().replace(/,/g, ''));

    if (num === 0) return '0 원';
    const isNegative = num < 0;
    const absNum = Math.abs(num);

    let result;
    if (absNum >= 1000000000000) {
        result = (absNum / 1000000000000).toFixed(2) + '조';
    } else {
        result = (absNum / 100000000).toFixed(2) + '억';
    }

    return (isNegative ? '-' : '') + result + ' 원';
}

function formatNumber(val) {
    if (val === undefined || val === null || val === '-') return '-';
    const num = parseFloat(val.toString().replace(/,/g, ''));
    if (isNaN(num)) return val;
    return new Intl.NumberFormat('ko-KR').format(Math.round(num)) + ' 원';
}

function renderData(results, stockData = {}) {
    ELEMENTS.displayCompany.textContent = currentCorpName;
    ELEMENTS.results.classList.remove('hidden');
    setTimeout(() => ELEMENTS.results.classList.add('show'), 10);

    // Header
    ELEMENTS.tableHeader.innerHTML = '<th>항목</th>' +
        results.map(r => `<th>${r.year}년 ${r.q.toUpperCase()}</th>`).join('');

    const rows = [
        { label: '매출액', key: 'revenue' },
        { label: '매출총이익', key: 'grossProfit' },
        { label: '영업이익', key: 'operatingIncome' },
        { label: '당기순이익', key: 'netIncome' },
        { label: '자산총액', key: 'totalAssets' },
        { label: '부채총액', key: 'totalLiabilities' },
        { label: '자본총액', key: 'totalEquity' },
        { label: 'EPS', key: 'eps' }
    ];

    ELEMENTS.tableBody.innerHTML = rows.map(row => {
        return `<tr>
            <td>${row.label}</td>
            ${results.map(r => {
            if (r.data.error) return `<td>-</td>`;
            const val = r.data[row.key];
            return `<td>${val.displayVal || val.formatted}</td>`;
        }).join('')}
        </tr>`;
    }).join('');

    // Append Stock Data Rows
    if (true) {
        const stockRows = [
            { label: '주가 (종가)', type: 'close' },
            { label: 'PBR', type: 'pbr' }
        ];

        const stockHtml = stockRows.map(row => {
            return `<tr>
                <td>${row.label}</td>
                ${results.map(r => {
                const key = `${r.year}-${r.q}`;
                const data = stockData[key];
                if (!data) return `<td>-</td>`;

                if (row.type === 'close') {
                    return `<td>${new Intl.NumberFormat('ko-KR').format(data.close)} 원</td>`;
                }
                if (row.type === 'pbr') {
                    const equity = r.data.totalEquity ? r.data.totalEquity.raw : 0;
                    const equityVal = (typeof equity === 'bigint') ? Number(equity) : Number(equity);

                    if (data.marketCap && equityVal > 0) {
                        const pbr = data.marketCap / equityVal;
                        return `<td>${pbr.toFixed(2)}배</td>`;
                    }
                    return `<td>-</td>`;
                }
                return `<td>-</td>`;
            }).join('')}
            </tr>`;
        }).join('');

        ELEMENTS.tableBody.innerHTML += stockHtml;
    }
}

function setStatus(msg, type) {
    ELEMENTS.status.textContent = msg;
    ELEMENTS.status.className = `status-msg ${type}`;
}

function showLoading(show) {
    if (show) ELEMENTS.loading.classList.remove('hidden');
    else ELEMENTS.loading.classList.add('hidden');
}

async function fetchStockData(corpName, beginBasDt, endBasDt) {
    try {
        const url = `${STOCK_BASE_URL}/getStockPriceInfo?serviceKey=${STOCK_API_KEY}&numOfRows=5000&resultType=json&itmsNm=${encodeURIComponent(corpName)}&beginBasDt=${beginBasDt}&endBasDt=${endBasDt}`;
        console.log('Fetching Stock URL:', url);
        const response = await fetch(url);

        if (!response.ok) {
            const text = await response.text();
            console.error(`Stock API Error (${response.status}):`, text);
            throw new Error(`Stock API returned ${response.status}`);
        }

        const text = await response.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            console.error('Failed to parse Stock API response:', text);
            throw new Error('Invalid JSON response from Stock API');
        }

        const items = data.response?.body?.items?.item || [];
        const quarterlyData = {};

        items.forEach(item => {
            const date = item.basDt; // YYYYMMDD
            const year = parseInt(date.substring(0, 4));
            const month = parseInt(date.substring(4, 6));
            let q;
            if (month <= 3) q = 'q1';
            else if (month <= 6) q = 'q2';
            else if (month <= 9) q = 'q3';
            else q = 'q4';

            const key = `${year}-${q}`;
            if (!quarterlyData[key]) {
                quarterlyData[key] = {
                    dates: [],
                    totalVol: 0,
                    totalVal: 0
                };
            }

            quarterlyData[key].dates.push({
                date: date,
                close: parseInt(item.clpr),
                vol: parseInt(item.trqu),
                val: parseInt(item.trPrc),
                marketCap: parseFloat(item.mrktTotAmt),
                issuedShares: parseInt(item.lstgStCnt)
            });
            quarterlyData[key].totalVol += parseInt(item.trqu);
            quarterlyData[key].totalVal += parseInt(item.trPrc);
        });

        // Find close price (last date of quarter)
        Object.keys(quarterlyData).forEach(key => {
            const qData = quarterlyData[key];
            qData.dates.sort((a, b) => b.date.localeCompare(a.date)); // Descending date
            qData.close = qData.dates[0].close; // Latest date close price
            qData.marketCap = qData.dates[0].marketCap; // Latest date market cap
            qData.issuedShares = qData.dates[0].issuedShares; // Latest date issued shares
        });

        return quarterlyData;
    } catch (e) {
        console.warn("Stock data fetch failed", e);
        return {};
    }
}

async function handleSearch() {
    const name = ELEMENTS.companyInput.value.trim();
    if (!name) return;
    try {
        const { corpCode } = await searchCompany(name);

        // Define range for stock data (Latest 5 years roughly)
        // We know we fetch 20 quarters ending at 2025Q3
        // Just fetch safely from 20200101 to Today
        const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const startDt = '20200101';

        const [financialData, stockData] = await Promise.all([
            fetchFinancialData(corpCode),
            fetchStockData(currentCorpName, startDt, today)
        ]);

        if (financialData) {
            renderData(financialData, stockData);
            setStatus(`'${currentCorpName}' 최근 20개 분기 데이터를 불러왔습니다.`, 'info');
        }
    } catch (err) {
        console.error(err);
    }
}

ELEMENTS.searchBtn.addEventListener('click', handleSearch);
ELEMENTS.companyInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSearch();
});
