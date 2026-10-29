// Quick script to base64 encode google-services.json
const fs = require('fs');
const content = fs.readFileSync('google-services.json', 'utf8');
const base64 = Buffer.from(content).toString('base64');
console.log('\n=== COPY THIS BASE64 STRING ===\n');
console.log(base64);
console.log('\n=== END ===\n');
