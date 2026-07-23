import React, { useRef, useState, useLayoutEffect, useEffect } from 'react';

// Common SQL Keywords and Functions for Autocomplete
const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET',
  'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'FULL OUTER JOIN', 'CROSS JOIN',
  'ON', 'AND', 'OR', 'NOT', 'IN', 'IS NULL', 'IS NOT NULL', 'LIKE', 'ILIKE',
  'BETWEEN', 'EXISTS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'WITH', 'RECURSIVE',
  'UNION ALL', 'UNION', 'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM',
  'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE', 'TRUNCATE TABLE', 'PARTITION BY',
  'OVER', 'ROW_NUMBER()', 'DENSE_RANK()', 'RANK()', 'COUNT(*)', 'SUM()', 'AVG()',
  'MIN()', 'MAX()', 'COALESCE()', 'NULLIF()', 'DATE_TRUNC()', 'DISTINCT',
  'QUALIFY', 'RETURNING', 'ASC', 'DESC', 'AS', 'PRIMARY KEY', 'FOREIGN KEY'
];

// Helper function to provide syntax highlighting for SQL queries (PostgreSQL, Oracle, Clickhouse, DuckDB)
export const highlightSqlHtml = (sqlText: string, theme: 'dark' | 'light') => {
  if (!sqlText) return '';

  let html = sqlText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const isDark = theme === 'dark';
  const kwColor = isDark ? 'text-blue-400 font-bold' : 'text-blue-700 font-bold';
  const fnColor = isDark ? 'text-purple-400 font-semibold' : 'text-purple-700 font-semibold';
  const strColor = isDark ? 'text-emerald-400 font-medium' : 'text-emerald-700 font-medium';
  const numColor = isDark ? 'text-amber-400 font-medium' : 'text-amber-600 font-medium';
  const commentColor = isDark ? 'text-slate-500 italic' : 'text-slate-500 italic';

  const tokenRegex = /(--.*$|\/\*[\s\S]*?\*\/)|('(?:''|[^'\\]|\\.)*'|"(?:""|[^"\\]|\\.)*")|(\b\d+(?:\.\d+)?\b)|(\b(?:COUNT|SUM|AVG|MIN|MAX|ROUND|COALESCE|NOW|CONCAT|DATE_TRUNC|LOWER|UPPER|CAST|ROW_NUMBER|DENSE_RANK|RANK|LEAD|LAG|FIRST_VALUE|LAST_VALUE|LISTAGG|TO_CHAR|TO_DATE|NVL|DECODE|UNIQEXACT|UNIQCOMBINED|ARGMAX|ARGMIN|TOSTARTOFHOUR|TOSTARTOFDAY|QUANTILESEXACT|DICTGET|READ_CSV_AUTO|READ_PARQUET|READ_CSV|LIST_TRANSFORM|FILTER|JSON_EXTRACT|ARRAY_JOIN|ARRAYMAP|ARRAYFILTER)\b)|(\b(?:SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|FULL|CROSS|ON|GROUP|BY|ORDER|HAVING|LIMIT|OFFSET|UNION|ALL|INSERT|INTO|UPDATE|SET|DELETE|CREATE|TABLE|AS|WITH|RECURSIVE|AND|OR|NOT|IN|IS|NULL|LIKE|ILIKE|BETWEEN|EXISTS|CASE|WHEN|THEN|ELSE|END|ASC|DESC|OVER|PARTITION|WINDOW|INTERVAL|DISTINCT|VALUES|QUALIFY|PIVOT|UNPIVOT|COLUMNS|EXCLUDE|REPLACE|ATTACH|COPY|MERGE|MATCHED|USING|RETURNING|LATERAL|CONNECT|PRIOR|START|FINAL|UPSERT|CONFLICT|DO|RETURNING)\b)/gim;

  html = html.replace(tokenRegex, (match, comment, str, num, fn, kw) => {
    if (comment) {
      return `<span class="${commentColor}">${comment}</span>`;
    }
    if (str) {
      return `<span class="${strColor}">${str}</span>`;
    }
    if (num) {
      return `<span class="${numColor}">${num}</span>`;
    }
    if (fn) {
      return `<span class="${fnColor}">${fn}</span>`;
    }
    if (kw) {
      return `<span class="${kwColor}">${kw.toUpperCase()}</span>`;
    }
    return match;
  });

  if (sqlText.endsWith('\n')) {
    html += '<br/>';
  }

  return html;
};

// Unified SqlEditor component with synced scrolling, line numbers, syntax highlighting & autocomplete
export function SqlEditor({ 
  value, 
  onChange, 
  isWrapSql = false, 
  theme, 
  placeholder = "Enter SQL Query here...",
  minHeightClass = "min-h-0",
  height
}: {
  value: string;
  onChange?: (val: string) => void;
  isWrapSql?: boolean;
  theme: 'dark' | 'light';
  placeholder?: string;
  minHeightClass?: string;
  height?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const [lineHeights, setLineHeights] = useState<number[]>([]);

  // Autocomplete states
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [showAutocomplete, setShowAutocomplete] = useState<boolean>(false);

  const sqlLines = value.split('\n');

  const handleScroll = () => {
    if (textareaRef.current) {
      if (lineNumbersRef.current) {
        lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
      }
      if (highlightRef.current) {
        highlightRef.current.scrollTop = textareaRef.current.scrollTop;
        highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
      }
    }
  };

  useLayoutEffect(() => {
    if (mirrorRef.current && textareaRef.current) {
      const containerWidth = textareaRef.current.clientWidth;
      mirrorRef.current.style.width = `${containerWidth}px`;
      
      const divs = mirrorRef.current.querySelectorAll('div');
      const heights: number[] = [];
      divs.forEach((div) => {
        heights.push(div.getBoundingClientRect().height);
      });
      if (heights.length === 0) {
        heights.push(20);
      }
      setLineHeights(heights);
    }
  }, [value, isWrapSql]);

  // Check cursor and compute suggestions
  const updateAutocomplete = () => {
    if (!textareaRef.current || !onChange) return;
    const cursor = textareaRef.current.selectionStart;
    const textBefore = value.slice(0, cursor);
    const match = textBefore.match(/([a-zA-Z_][a-zA-Z_0-9]*)$/);

    if (match) {
      const typed = match[1].toUpperCase();
      const filtered = SQL_KEYWORDS.filter(kw => 
        kw.startsWith(typed) && kw !== typed
      ).slice(0, 8);

      if (filtered.length > 0) {
        setSuggestions(filtered);
        setSelectedIndex(0);
        setShowAutocomplete(true);
        return;
      }
    }
    setShowAutocomplete(false);
  };

  const applySuggestion = (keyword: string) => {
    if (!textareaRef.current || !onChange) return;
    const cursor = textareaRef.current.selectionStart;
    const textBefore = value.slice(0, cursor);
    const textAfter = value.slice(cursor);
    const match = textBefore.match(/([a-zA-Z_][a-zA-Z_0-9]*)$/);

    if (match) {
      const wordStart = cursor - match[1].length;
      const isFunction = keyword.endsWith('()');
      const insertion = isFunction ? keyword.slice(0, -1) : keyword + ' ';
      const newValue = value.slice(0, wordStart) + insertion + textAfter;
      
      onChange(newValue);
      setShowAutocomplete(false);

      setTimeout(() => {
        if (textareaRef.current) {
          const newPos = wordStart + insertion.length;
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(newPos, newPos);
        }
      }, 10);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showAutocomplete && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        applySuggestion(suggestions[selectedIndex]);
        return;
      }
      if (e.key === 'Escape') {
        setShowAutocomplete(false);
        return;
      }
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    if (onChange) {
      onChange(val);
    }
  };

  useEffect(() => {
    updateAutocomplete();
  }, [value]);

  return (
    <div 
      style={{ height }}
      className={`flex-1 relative rounded-md border overflow-hidden font-mono text-xs leading-relaxed flex transition-colors ${minHeightClass} ${
        theme === 'dark' ? 'border-slate-600 bg-slate-850' : 'border-slate-300 bg-slate-100 shadow-sm'
      }`}
    >
      {/* HIDDEN MIRROR DIV FOR EXACT LINE HEIGHT MEASUREMENT */}
      <div
        ref={mirrorRef}
        aria-hidden="true"
        className={`absolute opacity-0 pointer-events-none -z-50 font-mono text-xs leading-relaxed p-3 ${
          isWrapSql ? 'whitespace-pre-wrap [word-break:break-word]' : 'whitespace-pre'
        }`}
        style={{ top: 0, left: 0, visibility: 'hidden' }}
      >
        {sqlLines.map((line, i) => (
          <div key={i}>{line || '\u00A0'}</div>
        ))}
      </div>

      {/* LINE NUMBERS */}
      <div 
        ref={lineNumbersRef}
        className={`w-10 border-r flex flex-col items-end pr-2 pt-3 pb-3 font-mono select-none overflow-hidden shrink-0 transition-colors ${
          theme === 'dark' ? 'bg-slate-800/80 border-slate-700 text-slate-500' : 'bg-slate-200 border-slate-300 text-slate-500'
        }`}
      >
        {sqlLines.map((_, i) => (
          <div 
            key={i} 
            style={{ height: lineHeights[i] ? `${lineHeights[i]}px` : undefined }}
            className="text-xs font-mono leading-relaxed flex items-start justify-end w-full"
          >
            {i + 1}
          </div>
        ))}
      </div>

      {/* EDITOR AREA & SYNTAX HIGHLIGHT LAYER */}
      <div className="flex-1 h-full relative overflow-hidden">
        <div
          ref={highlightRef}
          aria-hidden="true"
          className={`absolute inset-0 p-3 font-mono text-xs leading-relaxed pointer-events-none overflow-hidden select-none z-0 ${
            isWrapSql ? 'whitespace-pre-wrap [word-break:break-word]' : 'whitespace-pre'
          } ${theme === 'dark' ? 'text-slate-200' : 'text-slate-800'}`}
          dangerouslySetInnerHTML={{ __html: highlightSqlHtml(value, theme) }}
        />

        <textarea
          ref={textareaRef}
          value={value}
          onScroll={handleScroll}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onClick={() => setShowAutocomplete(false)}
          readOnly={!onChange}
          spellCheck="false"
          className={`absolute inset-0 w-full h-full p-3 bg-transparent text-transparent caret-blue-600 dark:caret-blue-400 resize-none outline-none text-xs font-mono leading-relaxed overflow-y-auto selection:bg-blue-500/30 z-10 transition-colors ${
            isWrapSql ? 'whitespace-pre-wrap [word-break:break-word]' : 'whitespace-pre'
          }`}
          placeholder={placeholder}
        />

        {/* AUTOCOMPLETE POPUP DROPDOWN */}
        {showAutocomplete && suggestions.length > 0 && (
          <div className={`absolute bottom-3 right-3 z-30 rounded-lg border shadow-xl p-1.5 min-w-[180px] max-w-[240px] font-mono text-xs animate-in fade-in duration-100 ${
            theme === 'dark' ? 'bg-slate-800 border-slate-600 text-slate-200' : 'bg-white border-slate-300 text-slate-800'
          }`}>
            <div className="text-[9px] uppercase font-bold tracking-wider px-2 py-0.5 text-slate-400 border-b mb-1 flex items-center justify-between">
              <span>Автодополнение SQL</span>
              <span className="text-[8px] opacity-70">Tab / Enter</span>
            </div>
            <div className="space-y-0.5 max-h-40 overflow-y-auto">
              {suggestions.map((kw, idx) => (
                <button
                  key={kw}
                  type="button"
                  onClick={() => applySuggestion(kw)}
                  className={`w-full text-left px-2 py-1 rounded text-xs flex items-center justify-between transition-colors ${
                    idx === selectedIndex
                      ? 'bg-blue-600 text-white font-bold'
                      : theme === 'dark' ? 'hover:bg-slate-700 text-slate-300' : 'hover:bg-slate-100 text-slate-700'
                  }`}
                >
                  <span>{kw}</span>
                  <span className={`text-[9px] ${idx === selectedIndex ? 'text-blue-200' : 'text-slate-400'}`}>
                    ключевое слово
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
