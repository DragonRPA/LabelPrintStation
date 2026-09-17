import https from 'https';

function checkAsset(url) {
  https.get(url, res => {
    console.log(`[Asset Check: ${res.statusCode}] ${url}`);
  });
}

checkAsset('https://www.dragonrpa.co.kr/LabelPrintStation/assets/index-DbJg64PU.js');
checkAsset('https://www.dragonrpa.co.kr/LabelPrintStation/assets/index-B2sEakt6.css');
checkAsset('https://www.dragonrpa.co.kr/LabelPrintStation/UBUS_DragonRPA_Agent.exe');
checkAsset('https://www.dragonrpa.co.kr/LabelPrintStation/보안인증서_원클릭설치.bat');
