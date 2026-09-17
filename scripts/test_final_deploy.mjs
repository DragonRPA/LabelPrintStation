import https from 'https';

function test(url) {
  https.get(url, (res) => {
    console.log(`[${url}] -> Status: ${res.statusCode} | Location: ${res.headers.location || 'none'}`);
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      console.log('Snippet:', data.slice(0, 200));
    });
  }).on('error', console.error);
}

test('https://www.dragonrpa.co.kr/LabelPrintStation/');
test('https://homepage-ed0nl276p-dragonrpa.vercel.app/LabelPrintStation/');
