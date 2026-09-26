import https from 'https';

function check(url) {
  https.get(url, res => {
    console.log(`[GET ${url}] -> Status: ${res.statusCode} | Location: ${res.headers.location || 'none'}`);
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      console.log('Snippet:', data.slice(0, 250));
    });
  }).on('error', console.error);
}

check('https://www.dragonrpa.co.kr/LabelPrintStation/demo');
check('https://www.dragonrpa.co.kr/LabelPrintStation/demo/');
