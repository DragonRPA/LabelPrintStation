import https from 'https';

https.get('https://www.dragonrpa.co.kr/pc-wiki', (res) => {
  console.log(`[/pc-wiki] Status: ${res.statusCode}`);
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    console.log('Snippet:', data.slice(0, 300));
  });
});
