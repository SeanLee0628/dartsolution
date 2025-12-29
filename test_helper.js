
// Test function for DART API
window.testDartApi = async function () {
    const corpCode = '00126380'; // Samsung Electronics example code
    const year = '2024';
    const reportCode = '11011'; // Annual Report
    const dartUrl = `https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json?crtfc_key=${API_KEY}&corp_code=${corpCode}&bsns_year=${year}&reprt_code=${reportCode}&fs_div=CFS`;
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(dartUrl)}`;

    console.log('--- TEST DART API START ---');
    console.log('Target URL:', dartUrl);
    console.log('Proxy URL:', proxyUrl);

    try {
        const res = await fetch(proxyUrl);
        const wrapper = await res.json();
        console.log('Proxy Response Status:', res.status);
        console.log('Wrapper Contents:', wrapper.contents);

        try {
            const data = JSON.parse(wrapper.contents);
            console.log('Parsed Data:', data);
        } catch (e) {
            console.error('Failed to parse wrapper contents as JSON', e);
        }
    } catch (err) {
        console.error('Test Failed:', err);
    }
    console.log('--- TEST DART API END ---');
};
