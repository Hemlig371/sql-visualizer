import re

# Update src/index.css
with open('src/index.css', 'r', encoding='utf-8') as f:
    css = f.read()

if '--color-slate-750' not in css:
    css = css.replace('@theme {', '@theme {\n  --color-slate-750: #263345;\n  --color-slate-850: #172033;\n  --color-slate-925: #0d1424;')

with open('src/index.css', 'w', encoding='utf-8') as f:
    f.write(css)

# Update App.tsx and CustomNodes.tsx
for path in ['src/App.tsx', 'src/components/CustomNodes.tsx']:
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Replace slate-700 with slate-750
    content = content.replace('slate-700', 'slate-750')
    # Replace slate-800 with slate-850
    content = content.replace('slate-800', 'slate-850')
    
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)

