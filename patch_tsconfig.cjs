const fs = require('fs');
const content = fs.readFileSync('tsconfig.json', 'utf8');
const config = JSON.parse(content);
config.compilerOptions.esModuleInterop = true;
config.compilerOptions.resolveJsonModule = true;
fs.writeFileSync('tsconfig.json', JSON.stringify(config, null, 2));
console.log("Updated tsconfig.json");
