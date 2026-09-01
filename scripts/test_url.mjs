fetch('https://dragonrpa.github.io/LabelPrintStation/')
  .then(res => {
    console.log('HTTP Status:', res.status);
    return res.text();
  })
  .then(html => {
    console.log('HTML snippet:', html.slice(0, 200));
  })
  .catch(console.error);
