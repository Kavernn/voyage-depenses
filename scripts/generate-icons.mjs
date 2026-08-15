import sharp from 'sharp';

const sizes = [180, 192, 512];

for (const size of sizes) {
  await sharp('public/icons/bear.svg')
    .resize(size, size)
    .png()
    .toFile(`public/icons/icon-${size}.png`);

  console.log(`✓ icon-${size}.png`);
}
