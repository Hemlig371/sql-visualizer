const fs = require('fs');

function fixTheme(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');

  // We want to replace the light theme strings in ternary expressions.
  // It's a bit tricky to parse perfectly, but we can do string replacements for known patterns.
  
  const replacements = [
    // App.tsx specific
    ["'bg-slate-50 text-slate-800'", "'bg-slate-900 text-slate-100'"],
    ["'bg-white border-slate-200'", "'bg-slate-800 border-slate-700'"],
    ["'bg-slate-100 border-slate-200 text-slate-800'", "'bg-slate-800 border-slate-700 text-slate-200'"],
    ["'text-slate-400'", "'text-slate-400'"], // if light was text-slate-400
    ["'bg-slate-100 border-slate-300 text-slate-400'", "'bg-slate-800 border-slate-700 text-slate-400'"],
    ["'bg-slate-50 border-slate-200'", "'bg-slate-900 border-slate-700'"],
    ["'text-slate-700'", "'text-slate-300'"],
    ["'text-slate-600'", "'text-slate-400'"],
    ["'bg-slate-100 text-slate-500 hover:text-slate-800'", "'bg-slate-800 text-slate-400 hover:text-slate-200'"],
    ["'text-slate-400 hover:text-slate-600'", "'text-slate-400 hover:text-slate-300'"],
    ["'bg-slate-50 border-slate-200 text-slate-600 hover:text-slate-800'", "'bg-slate-900 border-slate-700 text-slate-300 hover:text-slate-100'"],
    ["'text-slate-500 bg-slate-50 border-slate-200'", "'text-slate-400 bg-slate-900 border-slate-700'"],
    ["'bg-slate-100'", "'bg-slate-900'"],
    ["'bg-slate-100 text-slate-800'", "'bg-slate-900 text-slate-200'"],
    ["'!bg-white !border-slate-200 !text-slate-700 [&_button]:!bg-white [&_button]:!border-slate-200 [&_button]:!text-slate-500 [&_button:hover]:!text-slate-800'", "'!bg-slate-800 !border-slate-700 !text-slate-200 [&_button]:!bg-slate-800 [&_button]:!border-slate-700 [&_button]:!text-slate-400 [&_button:hover]:!text-slate-200'"],
    ["'!bg-white !border-slate-200'", "'!bg-slate-800 !border-slate-700'"],
    ["'bg-slate-50 border-slate-200 text-slate-750'", "'bg-slate-900 border-slate-700 text-slate-200'"],
    ["'hover:bg-slate-100 text-slate-500 hover:text-slate-800'", "'hover:bg-slate-800 text-slate-400 hover:text-slate-200'"],
    ["'bg-white border-slate-200 text-slate-600'", "'bg-slate-800 border-slate-700 text-slate-400'"],
    ["'bg-slate-50 border-slate-200 text-slate-850'", "'bg-slate-900 border-slate-700 text-slate-200'"],
    ["'bg-slate-50 text-emerald-700 border-slate-200'", "'bg-slate-900 text-emerald-400 border-slate-700'"],
    
    // CustomNodes.tsx specific
    ["'bg-white border-slate-300'", "'bg-slate-800 border-slate-600'"],
    ["'bg-slate-50 border-slate-200 text-slate-700'", "'bg-slate-900 border-slate-700 text-slate-200'"],
    ["'text-slate-800'", "'text-slate-200'"],
    ["'text-slate-500'", "'text-slate-400'"],
    ["'bg-slate-100 border-slate-200'", "'bg-slate-900 border-slate-700'"],
    ["'bg-white'", "'bg-slate-800'"],
    ["'border-slate-300'", "'border-slate-600'"],
    ["'text-slate-700'", "'text-slate-200'"],
    ["'text-slate-600'", "'text-slate-300'"],
    ["'text-slate-400'", "'text-slate-500'"],
    ["'bg-slate-50'", "'bg-slate-900'"],
    ["'bg-blue-50/50 border-blue-100'", "'bg-blue-900/20 border-blue-800/50'"],
    ["'bg-slate-100'", "'bg-slate-800'"],
    
    // Colors for the minimap mask
    ["'rgba(248, 250, 252, 0.7)'", "'rgba(15, 23, 42, 0.5)'"], // same as dark but a bit lighter maybe? actually let's use rgba(30, 41, 59, 0.7) for slate-800
  ];

  for (const [from, to] of replacements) {
    // Only replace when it looks like it's in the light theme branch of the ternary
    // This is a bit brute force, but we can just split by "theme === 'dark' ?"
    const parts = content.split("theme === 'dark'");
    for (let i = 1; i < parts.length; i++) {
       // inside parts[i], there is ` ? 'dark_class' : 'light_class'`
       // we can do a simple replace on parts[i]
       parts[i] = parts[i].replace(from, to);
    }
    content = parts.join("theme === 'dark'");
  }

  // A fallback general replace for remaining common light classes in ternaries
  const parts = content.split("theme === 'dark'");
  for (let i = 1; i < parts.length; i++) {
      let segment = parts[i];
      segment = segment.replace(/'bg-white/g, "'bg-slate-800");
      segment = segment.replace(/'bg-slate-50/g, "'bg-slate-900");
      segment = segment.replace(/'bg-slate-100/g, "'bg-slate-800");
      segment = segment.replace(/border-slate-200'/g, "border-slate-700'");
      segment = segment.replace(/border-slate-300'/g, "border-slate-600'");
      segment = segment.replace(/text-slate-800'/g, "text-slate-200'");
      segment = segment.replace(/text-slate-700'/g, "text-slate-300'");
      segment = segment.replace(/text-slate-600'/g, "text-slate-400'");
      segment = segment.replace(/text-slate-500'/g, "text-slate-400'");
      parts[i] = segment;
  }
  content = parts.join("theme === 'dark'");

  fs.writeFileSync(filePath, content, 'utf8');
}

fixTheme('./src/App.tsx');
fixTheme('./src/components/CustomNodes.tsx');
