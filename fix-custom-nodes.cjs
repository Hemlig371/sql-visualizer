const fs = require('fs');
let content = fs.readFileSync('src/components/CustomNodes.tsx', 'utf8');

// Replace light theme classes with the new slate-800/900 classes
// We'll just replace the light classes that accompany dark: classes
content = content.replace(/bg-white/g, 'bg-slate-800');
content = content.replace(/bg-slate-50/g, 'bg-slate-900');
content = content.replace(/bg-slate-100/g, 'bg-slate-900');
content = content.replace(/border-slate-200/g, 'border-slate-700');
content = content.replace(/border-slate-300/g, 'border-slate-700');
content = content.replace(/text-slate-700/g, 'text-slate-300');
content = content.replace(/text-slate-600/g, 'text-slate-300');
content = content.replace(/text-slate-800/g, 'text-slate-200');

fs.writeFileSync('src/components/CustomNodes.tsx', content, 'utf8');
