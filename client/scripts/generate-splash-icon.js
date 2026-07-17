/**
 * Generate splash-icon.png from the monogram SVG.
 * Creates a 400x400 PNG (will be scaled to 200px width in splash screen).
 */
const fs = require('fs');
const path = require('path');

// Read the monogram SVG
const svgPath = path.join(__dirname, '..', 'assets', 'brand', 'monogram.svg');
const svgContent = fs.readFileSync(svgPath, 'utf-8');

// Output path
const outputPath = path.join(__dirname, '..', 'assets', 'images', 'splash-icon.png');

console.log('Generating splash-icon.png from monogram.svg...');
console.log('Note: This script requires manual conversion.');
console.log('');
console.log('Please use one of these methods:');
console.log('1. Online converter: https://cloudconvert.com/svg-to-png');
console.log('2. Install Inkscape and run: inkscape monogram.svg --export-png=splash-icon.png --export-width=400');
console.log('3. Use an image editor to export the SVG as 400x400 PNG');
console.log('');
console.log(`Source: ${svgPath}`);
console.log(`Target: ${outputPath}`);
console.log('');
console.log('For now, copying icon.png as splash-icon.png...');

// Copy icon.png as a temporary solution
const iconPath = path.join(__dirname, '..', 'assets', 'images', 'icon.png');
fs.copyFileSync(iconPath, outputPath);
console.log('✓ Created splash-icon.png (copy of icon.png)');
