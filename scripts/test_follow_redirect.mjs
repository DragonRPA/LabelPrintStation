import https from 'https';

function fetchUrl(url) {
  https.get(url, (res) => {
    console.log(`[GET ${url}] -> Status: ${res.statusCode}`);
    if (res.headers.location) {
      console.log(` -> Redirect to: ${res.headers.location}`);
      fetchUrl(res.headers.location);
      return;
    }
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
      console.log(`Response Length: ${data.length}`);
      console.log('HTML Title snippet:', data.slice(0, 300));
    });
  }).on('error', (e) => {
    console.error('Error:', e.message);
  });
}

fetchUrl('https://www.dragonrpa.co.kr/LabelPrintStation');
