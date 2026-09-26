import https from 'https';

function checkDirect(url) {
  https.get(url, res => {
    console.log(`[Direct: ${url}] -> Status: ${res.statusCode} | Location: ${res.headers.location || 'none'}`);
  });
}

checkDirect('https://dragonrpa.github.io/LabelPrintStation/demo');
checkDirect('https://dragonrpa.github.io/LabelPrintStation/demo/');
checkDirect('https://dragonrpa.github.io/LabelPrintStation/#/demo');
