import re

with open('src/App.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Remove preset description
content = re.sub(r'<p className=\{`text-\[11px\] italic leading-relaxed.*?\n.*?\{sqlPresets\.find.*?description\}\n.*?</p>', '', content, flags=re.DOTALL)

# Remove the text hints in the node details panel
hints = []

# We need to remove the whole div/p containing these hints.
content = re.sub(r'<div className=\{`text-\[11px\] italic.*?\>.*?Базовая таблица базы данных.*?</div>', '', content, flags=re.DOTALL)
content = re.sub(r'<p className=\{`text-\[11px\].*?\>.*?Объединяет записи из предыдущих шагов.*?</p>', '', content, flags=re.DOTALL)
content = re.sub(r'<p className=\{`text-\[11px\].*?\>.*?Фильтрует строки: пропускает дальше.*?</p>', '', content, flags=re.DOTALL)
content = re.sub(r'<p className=\{`text-\[11px\].*?\>.*?Группирует строки с одинаковыми.*?</p>', '', content, flags=re.DOTALL)
content = re.sub(r'<p className=\{`text-\[11px\].*?\>.*?Фильтрует уже сгруппированные.*?</p>', '', content, flags=re.DOTALL)
content = re.sub(r'<p className=\{`text-\[11px\].*?\>.*?Сортирует результирующие строки.*?</p>', '', content, flags=re.DOTALL)
content = re.sub(r'<p className=\{`text-\[11px\].*?\>.*?Ограничивает количество возвращаемых.*?</p>', '', content, flags=re.DOTALL)
content = re.sub(r'<p className=\{`text-\[11px\].*?\>.*?Константное значение или вычисление.*?</p>', '', content, flags=re.DOTALL)

# The result one is a bit more complex, it has a ternary:
# <div className={`text-[11px] ${theme === 'dark' ? 'text-slate-400' : 'text-slate-400'}`}>
#   {selectedNode.data.columns?.some((col: any) => col.name && col.name.includes('Operation:'))
#     ? 'Итоговый результат выполнения DML-операции (модификация данных):'
#     : 'Итоговый набор колонок, который возвращается пользователю в результате выполнения SELECT:'}
# </div>
content = re.sub(r'<div className=\{`text-\[11px\] \$\{theme === \'dark\'.*?\>.*?\{selectedNode\.data\.columns\?\.some.*?\? \'Итоговый результат.*?\'Итоговый набор колонок.*?\}</div>', '', content, flags=re.DOTALL)

with open('src/App.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
