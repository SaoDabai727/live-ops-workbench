const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pngToIco = require('png-to-ico').default;

const outDir = path.join(__dirname, '..', 'build');
const assetsDir = path.join(__dirname, '..', 'renderer', 'assets');
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0B1526"/>
      <stop offset="100%" stop-color="#111D33"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#00E5C0"/>
      <stop offset="100%" stop-color="#38BDF8"/>
    </linearGradient>
  </defs>
  <rect x="64" y="64" width="896" height="896" rx="196" fill="url(#bg)"/>
  <rect x="64" y="64" width="896" height="896" rx="196" fill="none" stroke="#1E3A4F" stroke-width="18"/>
  <rect x="250" y="280" width="524" height="360" rx="48" fill="none" stroke="url(#accent)" stroke-width="44"/>
  <rect x="310" y="340" width="404" height="240" rx="28" fill="#081018"/>
  <polyline points="340,470 390,430 440,500 500,380 560,490 620,420 680,460"
            fill="none" stroke="url(#accent)" stroke-width="36" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="692" cy="372" r="28" fill="#00E5C0"/>
  <rect x="470" y="640" width="84" height="56" rx="14" fill="#1A3348"/>
  <rect x="390" y="696" width="244" height="36" rx="18" fill="#1A3348"/>
</svg>`;

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(assetsDir, { recursive: true });
  const svgBuf = Buffer.from(svg);
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = [];
  for (const s of icoSizes) {
    const buf = await sharp(svgBuf).resize(s, s).png().toBuffer();
    fs.writeFileSync(path.join(outDir, `icon-${s}.png`), buf);
    pngs.push(buf);
  }
  fs.writeFileSync(path.join(outDir, 'icon.png'), await sharp(svgBuf).resize(1024, 1024).png().toBuffer());
  fs.writeFileSync(path.join(assetsDir, 'logo.png'), await sharp(svgBuf).resize(128, 128).png().toBuffer());
  fs.writeFileSync(path.join(outDir, 'icon.ico'), await pngToIco(pngs));
  console.log('OK icons in build/ + renderer/assets/logo.png');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
