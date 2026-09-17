import https from 'https';

function check() {
  https.get('https://www.dragonrpa.co.kr/LabelPrintStation/', (res) => {
    console.log(`HTTP Status: ${res.statusCode}`);
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
      console.log(`Response Length: ${data.length}`);
      console.log('Snippet:', data.slice(0, 300));
    });
  }).on('error', (e) => {
    console.error('Error:', e.message);
  });
}

setTimeout(check, 10000);
