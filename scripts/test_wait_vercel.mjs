setTimeout(() => {
  import('https').then(https => {
    https.get('https://www.dragonrpa.co.kr/LabelPrintStation', (res) => {
      console.log(`[Status: ${res.statusCode}] Location: ${res.headers.location || 'none'}`);
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        console.log('Snippet:', data.slice(0, 400));
      });
    });
  });
}, 15000);
