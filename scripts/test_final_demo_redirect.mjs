setTimeout(() => {
  import('https').then(https => {
    function test(url) {
      https.get(url, res => {
        console.log(`[Status: ${res.statusCode}] URL: ${url} | Location: ${res.headers.location || 'none'}`);
        if (res.headers.location) {
          const next = res.headers.location.startsWith('http') ? res.headers.location : 'https://www.dragonrpa.co.kr' + res.headers.location;
          console.log(` -> Redirected to: ${next}`);
          test(next);
        }
      });
    }
    test('https://www.dragonrpa.co.kr/LabelPrintStation/demo');
  });
}, 20000);
