import https from 'https';

function get(url) {
  https.get(url, res => {
    console.log(`[Status: ${res.statusCode}] URL: ${url}`);
    if (res.headers.location) {
      const nextUrl = res.headers.location.startsWith('http') 
        ? res.headers.location 
        : 'https://www.dragonrpa.co.kr' + res.headers.location;
      console.log(` -> Follow redirect to: ${nextUrl}`);
      get(nextUrl);
      return;
    }
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      console.log(` -> Content Length: ${data.length}`);
      console.log(' -> Snippet:', data.slice(0, 350));
    });
  });
}

get('https://www.dragonrpa.co.kr/LabelPrintStation');
