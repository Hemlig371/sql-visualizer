import re
import os

files = ['src/App.tsx', 'src/components/CustomNodes.tsx', 'src/index.css']

# Mapping for 2 tones lighter
# 950 -> 800 (1.5 tones actually, but 750 doesn't exist. Let's make it 800 or 700. If we do 800, 900 goes to 700, so we have contrast)
# 900 -> 700
# 800 -> 600
# 700 -> 500
# 600 -> 400
# 500 -> 300
# 400 -> 200

def lighten_slate(match):
    prefix = match.group(1) # bg-slate-, border-slate-, text-slate-
    num_str = match.group(2)
    
    if num_str == '950':
        new_num = '800'
    else:
        num = int(num_str)
        if num >= 300:
            new_num = str(num - 200)
        else:
            new_num = num_str # don't change 200, 100, 50
    return f"{prefix}{new_num}"

# Also hex colors:
# #0b0f19 (very dark, like 950) -> slate-800 (#1e293b)
# #090f1a -> slate-800
# #040811 -> slate-900 -> actually let's make it slate-800 too

for file_path in files:
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Replace slate colors
    content = re.sub(r'((?:bg|text|border|ring|divide)-slate-)(\d+)', lighten_slate, content)
    
    # Replace hex
    content = content.replace('#0b0f19', '#1e293b') # slate-800
    content = content.replace('#090f1a', '#1e293b') # slate-800
    content = content.replace('#040811', '#1e293b') # slate-800
    
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)

