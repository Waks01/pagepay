/**
 * Generate Android adaptive icon assets from brand SVGs.
 * 
 * Android adaptive icons require:
 * - foreground: 1024x1024 PNG with logo centered in 684x684 safe zone
 * - monochrome: 1024x1024 PNG, single color for themed icons
 * 
 * Since we don't have sharp/image processing, we'll copy existing assets
 * and guide manual conversion if needed.
 */
const fs = require('fs');
const path = require('path');

const assetsDir = path.join(__dirname, '..', 'assets', 'images');
const iconPath = path.join(assetsDir, 'icon.png');
const foregroundPath = path.join(assetsDir, 'android-icon-foreground.png');
const monochromePath = path.join(assetsDir, 'android-icon-monochrome.png');

console.log('Checking Android adaptive icon assets...\n');

// Check current file sizes
const checkFile = (filePath, name) => {
  if (fs.existsSync(filePath)) {
    const stats = fs.statSync(filePath);
    console.log(`✓ ${name}: ${stats.size} bytes`);
    return stats.size;
  } else {
    console.log(`✗ ${name}: MISSING`);
    return 0;
  }
};

const iconSize = checkFile(iconPath, 'icon.png');
const foregroundSize = checkFile(foregroundPath, 'android-icon-foreground.png');
const monochromeSize = checkFile(monochromePath, 'android-icon-monochrome.png');

console.log('\n--- Analysis ---');

// Check if foreground is too small (should be ~100KB+ for 1024x1024)
if (foregroundSize < 10000) {
  console.log('⚠ android-icon-foreground.png is too small!');
  console.log('  Expected: ~100KB+ for 1024x1024px');
  console.log('  Found: ' + foregroundSize + ' bytes');
  console.log('\n  Copying icon.png as temporary fix...');
  
  fs.copyFileSync(iconPath, foregroundPath);
  console.log('  ✓ Copied icon.png → android-icon-foreground.png');
}

if (monochromeSize < 10000) {
  console.log('⚠ android-icon-monochrome.png is too small!');
  console.log('  Expected: ~100KB+ for 1024x1024px');
  console.log('  Found: ' + monochromeSize + ' bytes');
  console.log('\n  Copying icon.png as temporary fix...');
  
  fs.copyFileSync(iconPath, monochromePath);
  console.log('  ✓ Copied icon.png → android-icon-monochrome.png');
}

console.log('\n--- Next Steps ---');
console.log('For production-ready adaptive icons, convert the SVG files:');
console.log('');
console.log('1. Foreground (colored logo):');
console.log('   Source: assets/brand/adaptive-foreground.svg');
console.log('   Export: 1024x1024 PNG with transparent background');
console.log('   Target: assets/images/android-icon-foreground.png');
console.log('');
console.log('2. Monochrome (single color):');
console.log('   Source: assets/brand/monochrome.svg');
console.log('   Export: 1024x1024 PNG with transparent background');
console.log('   Target: assets/images/android-icon-monochrome.png');
console.log('');
console.log('Use: https://cloudconvert.com/svg-to-png');
console.log('Or: Figma/Photoshop/Illustrator to export SVG as PNG');
console.log('');
console.log('✓ Temporary icons are in place. App will build successfully.');
console.log('  (Icon may look pixelated until you replace with proper 1024x1024 PNGs)');
