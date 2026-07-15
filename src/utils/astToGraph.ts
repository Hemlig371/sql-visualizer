// @ts-nocheck
import pkg from 'node-sql-parser';
const { Parser } = pkg;
import dagre from 'dagre';

export interface GraphNode {
  id: string;
  type: string;
  data: any;
  position: { x: number; y: number };
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  animated?: boolean;
  label?: string;
  style?: any;
}

const parser = new Parser();

// --- 1. CORE LEXER (STATE MACHINE) ---
// This safely breaks SQL down into syntactic tokens, handling dialects perfectly.

export interface Token {
  type: 'word' | 'string' | 'comment' | 'symbol' | 'whitespace';
  value: string;
  start: number;
  end: number;
}

export function tokenizeSql(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = sql.length;

  while (i < len) {
    const char = sql[i];
    const nextChar = sql[i + 1] || '';

    // Whitespace
    if (/\s/.test(char)) {
      const start = i;
      while (i < len && /\s/.test(sql[i])) i++;
      tokens.push({ type: 'whitespace', value: sql.substring(start, i), start, end: i });
      continue;
    }

    // Single line comment (-- or #)
    if ((char === '-' && nextChar === '-') || char === '#') {
      const start = i;
      while (i < len && sql[i] !== '\n' && sql[i] !== '\r') i++;
      tokens.push({ type: 'comment', value: sql.substring(start, i), start, end: i });
      continue;
    }

    // Multi-line comment (/* ... */) with ClickHouse nested support
    if (char === '/' && nextChar === '*') {
      const start = i;
      let depth = 1;
      i += 2;
      while (i < len && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') {
          depth++;
          i += 2;
        } else if (sql[i] === '*' && sql[i + 1] === '/') {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      tokens.push({ type: 'comment', value: sql.substring(start, i), start, end: i });
      continue;
    }

    // Postgres Dollar Quotes ($tag$ ... $tag$)
    if (char === '$' && (nextChar === '$' || /[a-zA-Z0-9_]/.test(nextChar))) {
      const match = sql.substring(i).match(/^(\$[a-zA-Z0-9_]*\$)/);
      if (match) {
        const tag = match[1];
        const start = i;
        i += tag.length;
        const endTagIdx = sql.indexOf(tag, i);
        if (endTagIdx !== -1) {
          i = endTagIdx + tag.length;
        } else {
          i = len;
        }
        tokens.push({ type: 'string', value: sql.substring(start, i), start, end: i });
        continue;
      }
    }

    // Oracle Q-quotes (q'[...]', q'{...}', q'<...>', q'(...)', q'!...!')
    if ((char === 'q' || char === 'Q') && nextChar === "'") {
      const quoteChar = sql[i + 2];
      if (quoteChar) {
        let closeChar = quoteChar;
        if (quoteChar === '[') closeChar = ']';
        else if (quoteChar === '{') closeChar = '}';
        else if (quoteChar === '<') closeChar = '>';
        else if (quoteChar === '(') closeChar = ')';

        const start = i;
        i += 3;
        while (i < len) {
          if (sql[i] === closeChar && sql[i + 1] === "'") {
            i += 2;
            break;
          }
          i++;
        }
        tokens.push({ type: 'string', value: sql.substring(start, i), start, end: i });
        continue;
      }
    }

    // Standard Strings (', ", `)
    if (char === "'" || char === '"' || char === '`') {
      const start = i;
      const quote = char;
      i++;
      while (i < len) {
        if (sql[i] === '\\') { // Escape char
          i += 2;
          continue;
        }
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) { // Double quote escape (e.g. '')
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      tokens.push({ type: 'string', value: sql.substring(start, i), start, end: i });
      continue;
    }

    // Words (Identifiers, Keywords)
    if (/[a-zA-Z0-9_\u0400-\u04FFёЁ]/.test(char)) {
      const start = i;
      while (i < len && /[a-zA-Z0-9_\u0400-\u04FFёЁ.$]/.test(sql[i])) i++;
      tokens.push({ type: 'word', value: sql.substring(start, i), start, end: i });
      continue;
    }

    // Symbols (Punctuation, Operators)
    const start = i;
    tokens.push({ type: 'symbol', value: char, start, end: i + 1 });
    i++;
  }
  return tokens;
}

export function stripCommentsSafely(sql: string): string {
  return tokenizeSql(sql)
    .filter(t => t.type !== 'comment')
    .map(t => t.value)
    .join('');
}


// --- 2. EXPRESSION FORMATTER ---

export function formatExpr(expr: any): string {
  if (expr === null || expr === undefined) return '';
  if (typeof expr === 'string') return expr;
  if (typeof expr === 'number') return String(expr);
  if (typeof expr === 'boolean') return expr ? 'TRUE' : 'FALSE';

  if (expr.ast !== undefined) return formatExpr(expr.ast);
  if (expr.expr !== undefined) return formatExpr(expr.expr);
  if (Array.isArray(expr)) return expr.map(formatExpr).join(', ');

  let overStr = '';
  if (expr && expr.over) {
    let partitionStr = '';
    if (expr.over.partitionby) {
      partitionStr = 'PARTITION BY ' + (Array.isArray(expr.over.partitionby) ? expr.over.partitionby.map(formatExpr).join(', ') : formatExpr(expr.over.partitionby));
    }
    let orderStr = '';
    if (expr.over.orderby) {
      orderStr = 'ORDER BY ' + (Array.isArray(expr.over.orderby) ? expr.over.orderby.map((o: any) => {
        const oExpr = formatExpr(o.expr || o);
        const oType = o.type ? ` ${o.type.toUpperCase()}` : '';
        return oExpr + oType;
      }).join(', ') : formatExpr(expr.over.orderby));
    }
    let frameStr = '';
    if (expr.over.window_frame) {
      frameStr = 'ROWS/RANGE BETWEEN ...';
    }
    const innerOver = [partitionStr, orderStr, frameStr].filter(Boolean).join(' ');
    overStr = ` OVER (${innerOver})`;
  }

  let filterStr = '';
  if (expr && expr.filter) {
     filterStr = ` FILTER (WHERE ${formatExpr(expr.filter)})`;
  }

  if (expr.type === 'select' || expr.type === 'union') {
    try {
      return `(${parser.sqlify(expr)})`;
    } catch (e) {
      const tables = expr.from ? (Array.isArray(expr.from) ? expr.from.map((f: any) => {
        if (typeof f === 'string') return f;
        return f.table || formatExpr(f);
      }).join(', ') : '') : '';
      return `(SELECT ... FROM ${tables || '...'})`;
    }
  }

  let prefix = '';
  if (expr.distinct) prefix = 'DISTINCT ';

  switch (expr.type) {
    case 'column_ref':
      const colVal = typeof expr.column === 'object' ? formatExpr(expr.column) : expr.column;
      const tblVal = expr.table ? (typeof expr.table === 'object' ? formatExpr(expr.table) : expr.table) : '';
      return prefix + (tblVal ? `${tblVal}.${colVal}` : colVal);
    case 'binary_expr':
      const left = formatExpr(expr.left);
      const right = formatExpr(expr.right);
      const op = typeof expr.operator === 'object' ? formatExpr(expr.operator) : (expr.operator || '');
      return `(${left} ${op} ${right})`;
    case 'number':
    case 'string':
    case 'single_quote_string':
      return typeof expr.value === 'string' ? `'${expr.value}'` : String(expr.value);
    case 'double_quote_string':
      return `"${expr.value}"`;
    case 'aggr_func':
      const aggrName = typeof expr.name === 'object' ? formatExpr(expr.name) : expr.name;
      const aggrArgs = expr.args?.expr ? formatExpr(expr.args.expr) : (expr.args ? formatExpr(expr.args) : '*');
      return `${aggrName}(${prefix}${aggrArgs})${filterStr}${overStr}`;
    case 'function':
      const funcName = typeof expr.name === 'object' ? formatExpr(expr.name) : expr.name;
      const funcArgs = Array.isArray(expr.args) ? expr.args.map(formatExpr).join(', ') : (expr.args ? formatExpr(expr.args) : '');
      return `${funcName}(${funcArgs})${filterStr}${overStr}`;
    case 'expr_list':
      if (Array.isArray(expr.value)) return expr.value.map(formatExpr).join(', ');
      return formatExpr(expr.value);
    case 'star':
      return '*';
    case 'interval':
      return `INTERVAL ${expr.value} ${expr.unit}`;
    case 'case':
      const cases = expr.args?.map((arg: any) => {
        if (!arg) return '';
        if (arg.type === 'when') return `WHEN ${formatExpr(arg.cond)} THEN ${formatExpr(arg.result)}`;
        if (arg.type === 'else') return `ELSE ${formatExpr(arg.result)}`;
        return '';
      }).filter(Boolean).join(' ');
      return `CASE ${cases} END`;
    default:
      if (expr.value !== undefined) {
        if (typeof expr.value === 'object' && expr.value !== null) return formatExpr(expr.value);
        return String(expr.value);
      }
      if (expr.column !== undefined) {
        return typeof expr.column === 'object' ? formatExpr(expr.column) : String(expr.column);
      }
      if (expr.name !== undefined) {
        return typeof expr.name === 'object' ? formatExpr(expr.name) : String(expr.name);
      }
      if (expr.from !== undefined || expr.columns !== undefined) return '(SELECT ...)';
      return '';
  }
}


// --- 3. TOKENS-BASED UTILITIES ---

function findClosingParenthesis(text: string, openIndex: number): number {
  const tokens = tokenizeSql(text);
  let depth = 0;
  let foundOpen = false;

  for (const t of tokens) {
    if (t.start >= openIndex && t.type === 'symbol') {
      if (t.value === '(') {
        depth++;
        foundOpen = true;
      } else if (t.value === ')') {
        depth--;
        if (foundOpen && depth === 0) return t.start;
      }
    }
  }
  return -1;
}

function extractCleanSubquerySql(tableStr: string): { sql: string; alias: string | null } {
  let str = tableStr.trim();
  let alias: string | null = null;
  
  if (str.startsWith('(')) {
    const closingIdx = findClosingParenthesis(str, 0);
    if (closingIdx !== -1) {
      const subquerySql = str.substring(1, closingIdx).trim();
      const remaining = str.substring(closingIdx + 1).trim();
      if (remaining) {
        const aliasMatch = remaining.match(/^(?:AS\s+)?([A-Za-z0-9_\u0400-\u04FFёЁ]+)/i);
        if (aliasMatch) {
          alias = aliasMatch[1];
        }
      }
      return { sql: subquerySql, alias };
    }
  }
  
  return { sql: str, alias: null };
}

function extractSubqueriesFromString(text: string): { subquerySql: string; startIndex: number; endIndex: number }[] {
  const tokens = tokenizeSql(text);
  const results: { subquerySql: string; startIndex: number; endIndex: number }[] = [];
  let i = 0;

  while (i < tokens.length) {
    if (tokens[i].type === 'symbol' && tokens[i].value === '(') {
      let j = i + 1;
      while (j < tokens.length && (tokens[j].type === 'whitespace' || tokens[j].type === 'comment')) j++;
      
      if (j < tokens.length && tokens[j].type === 'word') {
        const nextWord = tokens[j].value.toUpperCase();
        // Теперь ловим и SELECT, и WITH (CTE)
        if (nextWord === 'SELECT' || nextWord === 'WITH') {
          let depth = 1;
          let k = i + 1;
          while (k < tokens.length && depth > 0) {
            if (tokens[k].type === 'symbol') {
              if (tokens[k].value === '(') depth++;
              else if (tokens[k].value === ')') depth--;
            }
            k++;
          }
          if (depth === 0) {
            const startOffset = tokens[i].start;
            const endOffset = tokens[k - 1].start;
            results.push({
              subquerySql: text.substring(startOffset + 1, endOffset).trim(),
              startIndex: startOffset,
              endIndex: endOffset
            });
            i = k - 1; 
          }
        }
      }
    }
    i++;
  }
  return results;
}

function splitByTopLevelCommas(text: string): string[] {
  const tokens = tokenizeSql(text);
  const parts: string[] = [];
  let currentStart = 0;
  let parenDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'symbol') {
      if (t.value === '(') parenDepth++;
      else if (t.value === ')') parenDepth = Math.max(0, parenDepth - 1);
      else if (t.value === '[') bracketDepth++;
      else if (t.value === ']') bracketDepth = Math.max(0, bracketDepth - 1);
      else if (t.value === ',' && parenDepth === 0 && bracketDepth === 0) {
        parts.push(text.substring(currentStart, t.start).trim());
        currentStart = t.end;
      }
    }
  }
  if (currentStart < text.length) {
    parts.push(text.substring(currentStart).trim());
  }
  return parts.filter(Boolean);
}

function parseHeuristicColumn(colStr: string): any {
  const cleanCol = colStr.trim();
  const tokens = tokenizeSql(cleanCol);
  
  let parenDepth = 0;
  let bracketDepth = 0;
  let lastAsIndex = -1;
  let lastSpaceIndex = -1;
  
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'symbol') {
      if (t.value === '(') parenDepth++;
      else if (t.value === ')') parenDepth = Math.max(0, parenDepth - 1);
      else if (t.value === '[') bracketDepth++;
      else if (t.value === ']') bracketDepth = Math.max(0, bracketDepth - 1);
    } else if (parenDepth === 0 && bracketDepth === 0) {
      if (t.type === 'word' && t.value.toUpperCase() === 'AS') {
        lastAsIndex = t.start;
      } else if (t.type === 'whitespace') {
        lastSpaceIndex = t.start;
      }
    }
  }
  
  let exprStr = cleanCol;
  let alias: string | null = null;
  
  if (lastAsIndex !== -1) {
    exprStr = cleanCol.substring(0, lastAsIndex).trim();
    const afterAs = cleanCol.substring(lastAsIndex).trim();
    const aliasPart = afterAs.replace(/^AS\s+/i, '').trim();
    if (aliasPart) {
      alias = aliasPart.replace(/^["'`]|["'`]$/g, '').trim();
    }
  } else if (lastSpaceIndex !== -1) {
    const potentialAlias = cleanCol.substring(lastSpaceIndex).trim();
    const potentialExpr = cleanCol.substring(0, lastSpaceIndex).trim();
    
    const isQuoted = /^["'`].*["'`]$/.test(potentialAlias);
    const isIdentifier = /^[A-Za-z0-9_\u0400-\u04FFёЁ]+$/.test(potentialAlias);
    
    if ((isQuoted || isIdentifier) && potentialExpr && !potentialAlias.includes(')') && !potentialAlias.includes(']')) {
      exprStr = potentialExpr;
      alias = potentialAlias.replace(/^["'`]|["'`]$/g, '').trim();
    }
  }
  
  return {
    expr: { type: 'column_ref', column: exprStr },
    as: alias
  };
}

function findTopLevelKeywordIndex(sql: string, keywordRegex: RegExp): number {
  const tokens = tokenizeSql(sql);
  let parenDepth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'symbol') {
      if (t.value === '(') parenDepth++;
      else if (t.value === ')') parenDepth = Math.max(0, parenDepth - 1);
    }
    if (parenDepth === 0 && t.type === 'word') {
      const match = sql.substring(t.start).match(keywordRegex);
      if (match && match.index === 0) {
        return t.start;
      }
    }
  }
  return -1;
}


// --- 4. PROCEDURES AND DML SPLITTERS ---

function splitProcedureStatements(bodyStr: string): string[] {
  const tokens = tokenizeSql(bodyStr);
  const statements: string[] = [];
  let currentStart = 0;
  let parenDepth = 0;
  let blockDepth = 0;
  let lastWord = '';

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'symbol') {
      if (t.value === '(') parenDepth++;
      else if (t.value === ')') parenDepth = Math.max(0, parenDepth - 1);
      else if (t.value === ';' && parenDepth === 0 && blockDepth === 0) {
        const stmt = bodyStr.substring(currentStart, t.start).trim();
        if (stmt) statements.push(stmt);
        currentStart = t.end;
        lastWord = '';
      }
    } else if (t.type === 'word') {
      const upper = t.value.toUpperCase();
      if (upper === 'BEGIN' || upper === 'CASE' || upper === 'LOOP') {
         blockDepth++;
      } else if (upper === 'IF' && lastWord !== 'END') {
         blockDepth++;
      } else if (upper === 'END') {
         blockDepth = Math.max(0, blockDepth - 1);
      }
      lastWord = upper;
    }
  }

  const finalStmt = bodyStr.substring(currentStart).trim();
  if (finalStmt) statements.push(finalStmt);
  return statements;
}

export function splitQueries(sql: string): string[] {
  const tokens = tokenizeSql(sql);
  const queries: string[] = [];
  let currentStart = 0;
  let parenDepth = 0;
  let blockDepth = 0;
  let lastWord = '';
  let isProc = false;
  let hasSeenBegin = false;

  const getNextSignificantToken = (startIndex: number) => {
    for (let i = startIndex + 1; i < tokens.length; i++) {
      if (tokens[i].type !== 'whitespace' && tokens[i].type !== 'comment') {
        return tokens[i];
      }
    }
    return null;
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    
    if (t.type === 'symbol') {
      if (t.value === '(') parenDepth++;
      else if (t.value === ')') parenDepth = Math.max(0, parenDepth - 1);
      
      // Обработка ; и Oracle-специфичного /
      else if (t.value === ';' || (t.value === '/' && parenDepth === 0 && blockDepth === 0)) {
        // Защита от деления (только если / идет как терминатор)
        const isDivision = t.value === '/' && lastWord !== 'END' && !isProc && currentStart !== t.start;
        
        if (parenDepth === 0 && !isDivision) {
          if (!isProc || (isProc && blockDepth === 0 && hasSeenBegin)) {
            const stmt = sql.substring(currentStart, t.start).trim();
            if (stmt) queries.push(stmt);
            currentStart = t.end;
            lastWord = '';
            isProc = false;
            hasSeenBegin = false;
            blockDepth = 0;
          }
        }
      }
    } else if (t.type === 'word') {
      const upper = t.value.toUpperCase();
      
      if (upper === 'PROCEDURE' || upper === 'FUNCTION' || upper === 'TRIGGER' || upper === 'PACKAGE' || upper === 'DECLARE') {
        isProc = true;
      }
      
      if (upper === 'BEGIN') {
        const nextToken = getNextSignificantToken(i);
        // Игнорируем транзакционные BEGIN; BEGIN TRANSACTION; BEGIN WORK;
        const isTransaction = nextToken && (nextToken.value === ';' || nextToken.value.toUpperCase() === 'TRANSACTION' || nextToken.value.toUpperCase() === 'WORK');
        
        if (!isTransaction) {
          blockDepth++;
          hasSeenBegin = true;
        }
      } else if (upper === 'CASE' || upper === 'LOOP') {
        blockDepth++;
      } else if (upper === 'IF' && lastWord !== 'END') {
        blockDepth++;
      } else if (upper === 'END') {
        blockDepth = Math.max(0, blockDepth - 1);
      }
      lastWord = upper;
    }
  }

  const finalQ = sql.substring(currentStart).trim();
  if (finalQ && finalQ !== '/') queries.push(finalQ);
  return queries;
}

function splitTopLevelUnion(sql: string): { parts: string[], ops: string[] } | null {
  const tokens = tokenizeSql(sql);
  const parts: string[] = [];
  const ops: string[] = [];
  let currentStart = 0;
  let parenDepth = 0;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'symbol') {
      if (t.value === '(') parenDepth++;
      else if (t.value === ')') parenDepth = Math.max(0, parenDepth - 1);
    } else if (t.type === 'word' && parenDepth === 0) {
      const upper = t.value.toUpperCase();
      if (upper === 'UNION' || upper === 'INTERSECT' || upper === 'EXCEPT') {
        let nextIdx = i + 1;
        while (nextIdx < tokens.length && (tokens[nextIdx].type === 'whitespace' || tokens[nextIdx].type === 'comment')) {
           nextIdx++;
        }

        let op = upper;
        let splitEnd = t.end;

        if (nextIdx < tokens.length && tokens[nextIdx].type === 'word' && tokens[nextIdx].value.toUpperCase() === 'ALL') {
          op += ' ALL';
          splitEnd = tokens[nextIdx].end;
          i = nextIdx; 
        }

        parts.push(sql.substring(currentStart, t.start).trim());
        ops.push(op);
        currentStart = splitEnd;
      }
    }
  }

  if (parts.length > 0) {
    parts.push(sql.substring(currentStart).trim());
    return { parts, ops };
  }
  return null;
}


// --- 5. PARSERS & AST GENERATORS ---

export function extractTablesFromAst(ast: any): string[] {
  if (!ast) return [];
  const tables: string[] = [];

  if (Array.isArray(ast)) {
    ast.forEach(item => { tables.push(...extractTablesFromAst(item)); });
    return Array.from(new Set(tables));
  }

  if (ast.type === 'select') {
    if (ast.from && Array.isArray(ast.from)) {
      ast.from.forEach((item: any) => {
        if (item.table) tables.push(item.table);
        if (item.expr && item.expr.ast) tables.push(...extractTablesFromAst(item.expr.ast));
      });
    }
    if (ast.ctes && Array.isArray(ast.ctes)) {
      ast.ctes.forEach((cte: any) => { tables.push(...extractTablesFromAst(cte.ast)); });
    }
  } else if (ast.type === 'union' && Array.isArray(ast.queries)) {
    ast.queries.forEach((q: any) => { tables.push(...extractTablesFromAst(q)); });
  } else if (ast.table) {
    tables.push(ast.table);
  }

  return Array.from(new Set(tables));
}

export function parseHeuristicDml(sql: string, dialect: string): any {
  const cleanSql = sql.trim(); // Уже очищен от комментариев в parseSqlToAst
  const upperSql = cleanSql.toUpperCase();
  
  if (upperSql.startsWith('INSERT')) {
    const selectOrValuesMatch = cleanSql.match(/\b(SELECT|VALUES|UNION|WITH)\b/i);
    const beforeSelectOrValues = selectOrValuesMatch ? cleanSql.substring(0, selectOrValuesMatch.index) : cleanSql;
    
    const insertIntoIndex = upperSql.indexOf('INSERT INTO');
    let tableName = 'TARGET_TABLE';
    let columns: string[] = [];
    
    if (insertIntoIndex !== -1) {
      const afterInsertInto = beforeSelectOrValues.substring(insertIntoIndex + 11).trim();
      const firstParen = afterInsertInto.indexOf('(');
      let rawTableName = '';
      if (firstParen !== -1) {
        rawTableName = afterInsertInto.substring(0, firstParen).trim();
        const lastParen = afterInsertInto.lastIndexOf(')');
        if (lastParen !== -1 && firstParen < lastParen) {
          const colStr = afterInsertInto.substring(firstParen + 1, lastParen);
          columns = colStr.split(',').map(c => c.trim()).filter(Boolean);
        }
      } else {
        rawTableName = afterInsertInto.trim();
      }
      if (rawTableName) tableName = rawTableName;
    } else {
      const tableMatch = cleanSql.match(/INSERT\s+INTO\s+([A-Za-z0-9_".\u0400-\u04FFёЁ]+)/i);
      tableName = tableMatch ? tableMatch[1] : 'TARGET_TABLE';
    }
    
    let onConflictStr = '';
    const onConflictMatch = upperSql.indexOf('ON CONFLICT');
    if (onConflictMatch !== -1) {
      onConflictStr = cleanSql.substring(onConflictMatch).trim();
    }

    let selectAst: any = null;
    if (selectOrValuesMatch && ['SELECT', 'UNION', 'WITH'].includes(selectOrValuesMatch[1].toUpperCase())) {
      let selectSql = cleanSql.substring(selectOrValuesMatch.index).trim();
      if (onConflictMatch !== -1 && onConflictMatch > selectOrValuesMatch.index) {
          selectSql = cleanSql.substring(selectOrValuesMatch.index, onConflictMatch).trim();
      }
      const parsedSelect = parseSingleSqlToAst(selectSql, dialect);
      if (parsedSelect && parsedSelect.ast) {
        selectAst = parsedSelect.ast;
      }
    }

    let valuesCount = 1;
    const valuesIdx = upperSql.indexOf('VALUES');
    if (valuesIdx !== -1) {
      const afterValues = cleanSql.substring(valuesIdx + 6).trim();
      const matches = afterValues.match(/\(([^)]+)\)/g);
      if (matches) valuesCount = matches.length;
    }
    
    return {
      type: 'insert',
      table: { table: tableName },
      columns: columns,
      values: selectAst ? selectAst : Array(valuesCount).fill({ value: 'val' }),
      on_conflict: onConflictStr
    };
  }
  
  if (upperSql.startsWith('UPDATE')) {
    const tableMatch = cleanSql.match(/UPDATE\s+([A-Za-z0-9_".\u0400-\u04FFёЁ]+)/i);
    const tableName = tableMatch ? tableMatch[1] : 'TARGET_TABLE';
    
    const setIdx = upperSql.indexOf('SET');
    const whereIdx = upperSql.indexOf('WHERE');
    
    let setStr = '';
    let whereStr = '';
    
    if (setIdx !== -1) {
      const setEnd = whereIdx !== -1 ? whereIdx : cleanSql.length;
      setStr = cleanSql.substring(setIdx + 3, setEnd).trim();
    }
    if (whereIdx !== -1) {
      whereStr = cleanSql.substring(whereIdx + 5).trim();
    }
    
    const setPairs: any[] = [];
    if (setStr) {
      const parts = splitByTopLevelCommas(setStr);
      parts.forEach(part => {
        const eqIdx = part.indexOf('=');
        if (eqIdx !== -1) {
          const colName = part.substring(0, eqIdx).trim();
          const valExpr = part.substring(eqIdx + 1).trim();
          setPairs.push({
            column: colName,
            value: { type: 'column_ref', column: valExpr }
          });
        }
      });
    }
    
    return {
      type: 'update',
      table: { table: tableName },
      set: setPairs,
      where: whereStr ? { type: 'column_ref', column: whereStr } : null
    };
  }
  
  if (upperSql.startsWith('DELETE')) {
    const tableMatch = cleanSql.match(/DELETE\s+FROM\s+([A-Za-z0-9_".\u0400-\u04FFёЁ]+)/i);
    const tableName = tableMatch ? tableMatch[1] : 'TARGET_TABLE';
    
    const whereIdx = upperSql.indexOf('WHERE');
    let whereStr = '';
    if (whereIdx !== -1) {
      whereStr = cleanSql.substring(whereIdx + 5).trim();
    }
    
    return {
      type: 'delete',
      table: { table: tableName },
      where: whereStr ? { type: 'column_ref', column: whereStr } : null
    };
  }

  if (upperSql.startsWith('MERGE')) {
      const mergeMatch = cleanSql.match(/MERGE\s+INTO\s+([A-Za-z0-9_".\u0400-\u04FFёЁ]+)/i);
      const tableName = mergeMatch ? mergeMatch[1] : 'TARGET_TABLE';
      return {
          type: 'merge',
          table: { table: tableName },
          text: cleanSql
      };
  }
  
  return null;
}

export function transformNodeSqlParserUnion(ast: any): any {
  if (!ast) return ast;
  if (Array.isArray(ast)) return ast.map(transformNodeSqlParserUnion);
  
  if (ast.type === 'select' && (ast._next || ast.union)) {
    const queries: any[] = [];
    const ops: string[] = [];
    
    let current = ast;
    while (current) {
      const { _next, union, ...rest } = current;
      queries.push(rest);
      
      if (union) {
        const opType = typeof union === 'string' ? `UNION ${union.toUpperCase()}` : 'UNION';
        ops.push(opType);
      } else if (_next) {
        ops.push('UNION');
      }
      current = _next;
    }
    
    return {
      type: 'union',
      queries: queries.map(transformNodeSqlParserUnion),
      ops: ops
    };
  }
  
  if (ast.from && Array.isArray(ast.from)) {
    ast.from = ast.from.map((item: any) => {
      if (item.expr && item.expr.ast) {
        item.expr.ast = transformNodeSqlParserUnion(item.expr.ast);
      }
      return item;
    });
  }
  
  return ast;
}

function parseTableOrSubquery(str: string, dialect: string): any {
  str = str.trim();
  if (!str) return null;

  if (str.startsWith('(')) {
    const closingIdx = findClosingParenthesis(str, 0);
    if (closingIdx !== -1) {
      const subquerySql = str.substring(1, closingIdx).trim();
      const afterSubquery = str.substring(closingIdx + 1).trim();

      const aliasMatch = afterSubquery.match(/^(?:AS\s+)?([A-Za-z0-9_\u0400-\u04FFёЁ]+)/i);
      const alias = aliasMatch ? aliasMatch[1] : `subquery`;

      return {
        expr: {
          ast: parseSingleSqlToAst(subquerySql, dialect).ast
        },
        as: alias
      };
    }
  }

  const asRegex = /\s+AS\s+([A-Za-z0-9_\u0400-\u04FFёЁ]+)/i;
  const match = str.match(asRegex);
  if (match) {
    const tableName = str.replace(asRegex, '').trim();
    return {
      table: tableName,
      as: match[1]
    };
  }

  const spaceParts = str.split(/\s+/);
  if (spaceParts.length > 1) {
    const lastPart = spaceParts[spaceParts.length - 1];
    if (/^[A-Za-z0-9_\u0400-\u04FFёЁ]+$/.test(lastPart)) {
      const tableName = str.substring(0, str.lastIndexOf(lastPart)).trim();
      return {
        table: tableName,
        as: lastPart
      };
    }
  }

  return { table: str, as: null };
}

function parseHeuristicFromAndJoins(fromBlock: string, dialect: string): any[] {
  const fromList: any[] = [];
  if (!fromBlock) return fromList;

  const joinRegex = /\b((?:GLOBAL\s+)?(?:LEFT\s+ARRAY\s+JOIN|ARRAY\s+JOIN|LEFT\s+OUTER\s+JOIN|RIGHT\s+OUTER\s+JOIN|FULL\s+OUTER\s+JOIN|INNER\s+JOIN|LEFT\s+JOIN|RIGHT\s+JOIN|FULL\s+JOIN|CROSS\s+JOIN|LATERAL\s+JOIN|JOIN))\b/i;
  const parts = fromBlock.split(joinRegex);
  
  const firstPart = parts[0].trim();
  const baseTable = parseTableOrSubquery(firstPart, dialect);
  if (baseTable) {
    fromList.push(baseTable);
  }

  for (let i = 1; i < parts.length; i += 2) {
    const joinKeyword = parts[i].trim().toUpperCase();
    const tableAndCondition = parts[i + 1]?.trim() || '';

    const onIndex = tableAndCondition.search(/\bON\b/i);
    let tablePart = tableAndCondition;
    let onCondition = '';

    if (onIndex !== -1) {
      tablePart = tableAndCondition.substring(0, onIndex).trim();
      onCondition = tableAndCondition.substring(onIndex + 2).trim();
    }

    const joinTable = parseTableOrSubquery(tablePart, dialect);
    if (joinTable) {
      joinTable.join = joinKeyword;
      joinTable.on = onCondition ? { type: 'column_ref', column: onCondition } : null;
      fromList.push(joinTable);
    }
  }

  return fromList;
}

function extractCtes(sql: string, dialect: string): { ctes: any[], mainSql: string } {
  const ctes: any[] = [];
  let workingSql = sql.trim();
  
  const withMatch = workingSql.match(/^\s*WITH\s+/i);
  if (!withMatch) {
    return { ctes, mainSql: workingSql };
  }

  workingSql = workingSql.substring(withMatch[0].length).trim();

  while (true) {
    const cteHeaderMatch = workingSql.match(/^([A-Za-z0-9_\u0400-\u04FFёЁ]+)(?:\s*\([^)]+\))?\s+AS\s*\(/i);
    if (!cteHeaderMatch) break;

    const cteName = cteHeaderMatch[1];
    const startIndex = cteHeaderMatch[0].length - 1;
    const closingIndex = findClosingParenthesis(workingSql, startIndex);
    
    if (closingIndex === -1) break;

    const cteBody = workingSql.substring(startIndex + 1, closingIndex).trim();
    const cteAst = parseSingleSqlToAst(cteBody, dialect).ast;
    ctes.push({
      name: cteName,
      ast: cteAst
    });

    workingSql = workingSql.substring(closingIndex + 1).trim();

    if (workingSql.startsWith(',')) {
      workingSql = workingSql.substring(1).trim();
    } else {
      break;
    }
  }

  return { ctes, mainSql: workingSql };
}

function parseHeuristicSelect(sql: string, dialect: string): any {
  const ast: any = {
    type: 'select', ctes: [], columns: [], from: [], prewhere: null, where: null,
    start_with: null, connect_by: null, groupby: null, having: null, orderby: null, limit: null
  };

  const { ctes, mainSql } = extractCtes(sql, dialect);
  ast.ctes = ctes;

  const lowerSql = mainSql.trim();

  const selectIdx = findTopLevelKeywordIndex(lowerSql, /^\bSELECT\b/i);
  const fromIdx = findTopLevelKeywordIndex(lowerSql, /^\bFROM\b/i);
  const prewhereIdx = findTopLevelKeywordIndex(lowerSql, /^\bPREWHERE\b/i);
  const whereIdx = findTopLevelKeywordIndex(lowerSql, /^\bWHERE\b/i);
  const startWithIdx = findTopLevelKeywordIndex(lowerSql, /^\bSTART\s+WITH\b/i);
  const connectByIdx = findTopLevelKeywordIndex(lowerSql, /^\bCONNECT\s+BY\b/i);
  const groupbyIdx = findTopLevelKeywordIndex(lowerSql, /^\bGROUP\s+BY\b/i);
  const havingIdx = findTopLevelKeywordIndex(lowerSql, /^\bHAVING\b/i);
  const orderbyIdx = findTopLevelKeywordIndex(lowerSql, /^\bORDER\s+BY\b/i); 
  const limitIdx = findTopLevelKeywordIndex(lowerSql, /^\bLIMIT\b/i);

  if (selectIdx === -1 && fromIdx === -1 && ctes.length === 0) {
    throw new Error("Not a SELECT query");
  }

  const getBlock = (start: number, end: number) => {
    if (start === -1) return '';
    const actualEnd = end === -1 ? lowerSql.length : end;
    return lowerSql.substring(start, actualEnd).trim();
  };

  const indices = [
    { type: 'select', idx: selectIdx }, { type: 'from', idx: fromIdx }, { type: 'prewhere', idx: prewhereIdx },
    { type: 'where', idx: whereIdx }, { type: 'start_with', idx: startWithIdx }, { type: 'connect_by', idx: connectByIdx },
    { type: 'groupby', idx: groupbyIdx }, { type: 'having', idx: havingIdx }, { type: 'orderby', idx: orderbyIdx },
    { type: 'limit', idx: limitIdx }
  ].filter(item => item.idx !== -1).sort((a, b) => a.idx - b.idx);

  const getNextIdx = (type: string) => {
    const currentPos = indices.findIndex(item => item.type === type);
    if (currentPos === -1 || currentPos === indices.length - 1) return -1;
    return indices[currentPos + 1].idx;
  };

  if (selectIdx !== -1) {
    const selectBlock = getBlock(selectIdx + 6, getNextIdx('select'));
    if (selectBlock.trim() === '*') {
      ast.columns = '*';
    } else {
      const colParts = splitByTopLevelCommas(selectBlock);
      ast.columns = colParts.map(parseHeuristicColumn);
    }
  }

  if (fromIdx !== -1) {
    const fromBlock = getBlock(fromIdx + 4, getNextIdx('from'));
    ast.from = parseHeuristicFromAndJoins(fromBlock, dialect);
  }

  if (prewhereIdx !== -1) {
    const prewhereBlock = getBlock(prewhereIdx + 8, getNextIdx('prewhere'));
    ast.prewhere = { type: 'column_ref', column: prewhereBlock };
  }

  if (whereIdx !== -1) {
    const whereBlock = getBlock(whereIdx + 5, getNextIdx('where'));
    ast.where = { type: 'column_ref', column: whereBlock };
  }

  if (startWithIdx !== -1) {
      const startWithBlock = getBlock(startWithIdx + 10, getNextIdx('start_with'));
      ast.start_with = { type: 'column_ref', column: startWithBlock };
  }

  if (connectByIdx !== -1) {
      const connectByBlock = getBlock(connectByIdx + 10, getNextIdx('connect_by'));
      ast.connect_by = { type: 'column_ref', column: connectByBlock };
  }

  if (groupbyIdx !== -1) {
    const groupbyBlock = getBlock(groupbyIdx + 8, getNextIdx('groupby'));
    const cols = splitByTopLevelCommas(groupbyBlock);
    ast.groupby = cols.map(c => ({ type: 'column_ref', column: c }));
  }

  if (havingIdx !== -1) {
    const havingBlock = getBlock(havingIdx + 6, getNextIdx('having'));
    ast.having = { type: 'column_ref', column: havingBlock };
  }

  if (orderbyIdx !== -1) {
    const orderbyBlock = getBlock(orderbyIdx + 8, getNextIdx('orderby'));
    const cols = splitByTopLevelCommas(orderbyBlock);
    ast.orderby = cols.map(c => {
      const parts = c.split(/\s+/);
      const isDesc = parts[parts.length - 1]?.toUpperCase() === 'DESC';
      const expr = isDesc ? c.replace(/\s+DESC/i, '') : c.replace(/\s+ASC/i, '');
      return { expr: { type: 'column_ref', column: expr.trim() }, type: isDesc ? 'DESC' : 'ASC' };
    });
  }

  if (limitIdx !== -1) {
    const limitBlock = getBlock(limitIdx + 5, getNextIdx('limit'));
    const parts = limitBlock.split(/\s*,|\s+OFFSET\s+/i);
    const limitVal = parts[0]?.trim() || '10';
    const offsetVal = parts[1]?.trim() || '0';
    ast.limit = {
      value: [ { type: 'number', value: parseInt(limitVal) || limitVal }, { type: 'number', value: parseInt(offsetVal) || offsetVal } ]
    };
  }

  return ast;
}

function parseHeuristicProcedure(sql: string, dialect: string): any {
  const ast: any = {
    type: 'procedure',
    name: 'Stored Procedure / Block',
    dialect: dialect,
    parameters: [],
    variables: [],
    steps: []
  };

  const nameMatch = sql.match(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:PROCEDURE|FUNCTION|PACKAGE|TYPE|TRIGGER)\s+(?:BODY\s+)?([A-Za-z0-9_.\u0400-\u04FFёЁ]+)/i);
  if (nameMatch) {
    ast.name = nameMatch[1];
    const firstParen = sql.indexOf('(');
    if (firstParen !== -1 && firstParen < sql.search(/\b(?:IS|AS|BEGIN|DECLARE)\b/i)) {
      const closingParen = findClosingParenthesis(sql, firstParen);
      if (closingParen !== -1) {
        const paramsStr = sql.substring(firstParen + 1, closingParen).trim();
        ast.parameters = paramsStr.split(',').map(p => p.trim()).filter(Boolean);
      }
    }
  }

  const declareMatch = sql.match(/\bDECLARE\b([\s\S]+?)\bBEGIN\b/i);
  const asBeginMatch = sql.match(/\b(?:IS|AS)\b([\s\S]+?)\bBEGIN\b/i);
  let varsSection = '';
  if (declareMatch) {
    varsSection = declareMatch[1];
  } else if (asBeginMatch && !sql.match(/CREATE\s+VIEW/i)) {
    varsSection = asBeginMatch[1];
  }

  if (varsSection) {
    ast.variables = varsSection
      .split(';')
      .map(v => v.trim())
      .filter(v => v && !v.toUpperCase().includes('BEGIN') && !v.toUpperCase().includes('PROCEDURE'));
  }

  const beginIdx = sql.search(/\bBEGIN\b/i);
  let bodyStr = sql;
  if (beginIdx !== -1) {
    const endMatch = [...sql.matchAll(/\\bEND\\b/gi)];
    const endIdx = endMatch.length > 0 ? endMatch[endMatch.length - 1].index : -1;
    bodyStr = sql.substring(beginIdx + 5, endIdx !== -1 ? endIdx : sql.length).trim();
  } else {
    const bodyStartMatch = sql.match(/\b(?:BEGIN|AS|IS)\b/i);
    if (bodyStartMatch) {
      bodyStr = sql.substring(sql.indexOf(bodyStartMatch[0]) + bodyStartMatch[0].length).trim();
    }
  }

  const rawSteps = splitProcedureStatements(bodyStr);
  
  ast.steps = rawSteps
    .map((step, idx) => {
      const text = step.trim();
      if (!text) return null;

      const cleanTextForType = text.toUpperCase();

      let stepType = 'statement';
      let parsedQuery: any = null;

      if (cleanTextForType.startsWith('SELECT')) {
        stepType = 'select_step';
        parsedQuery = parseSingleSqlToAst(text, dialect).ast;
      } else if (cleanTextForType.startsWith('UPDATE')) {
        stepType = 'update_step';
        parsedQuery = parseSingleSqlToAst(text, dialect).ast;
      } else if (cleanTextForType.startsWith('INSERT')) {
        stepType = 'insert_step';
        parsedQuery = parseSingleSqlToAst(text, dialect).ast;
      } else if (cleanTextForType.startsWith('DELETE')) {
        stepType = 'delete_step';
        parsedQuery = parseSingleSqlToAst(text, dialect).ast;
      } else if (cleanTextForType.startsWith('MERGE')) {
        stepType = 'merge_step';
        parsedQuery = parseSingleSqlToAst(text, dialect).ast;
      } else if (cleanTextForType.startsWith('IF')) {
        stepType = 'conditional_step';
      } else if (cleanTextForType.startsWith('FOR') || cleanTextForType.startsWith('WHILE') || cleanTextForType.startsWith('LOOP')) {
        stepType = 'loop_step';
      } else if (cleanTextForType.startsWith('EXCEPTION')) {
        stepType = 'exception_block';
      } else if (cleanTextForType.includes('=')) {
        stepType = 'assignment_step';
      }

      return {
        id: `step_${idx}`,
        title: `Step ${idx + 1}: ${stepType.replace('_', ' ').toUpperCase()}`,
        type: stepType,
        text: text,
        parsedQuery: parsedQuery
      };
    })
    .filter(Boolean);

  return ast;
}

export function parseSingleSqlToAst(sql: string, dialect: string): any {
  const cleanSql = sql.trim(); // Уже очищен в parseSqlToAst
  const upperSql = cleanSql.toUpperCase();
  const isProcedure = /CREATE\s+(?:OR\s+REPLACE\s+)?(?:PROCEDURE|FUNCTION|PACKAGE|TYPE|TRIGGER)|DECLARE\b|BEGIN\b/i.test(upperSql);
  if (isProcedure) {
    return { ast: parseHeuristicProcedure(cleanSql, dialect), error: null };
  }

  const truncateMatch = cleanSql.match(/^\s*TRUNCATE\s+(?:TABLE\s+)?([A-Za-z0-9_".\u0400-\u04FFёЁ\s,]+)/i);
  if (truncateMatch) {
    const rawTables = truncateMatch[1].split(',').map(t => t.trim()).filter(Boolean);
    const tables = rawTables.map(tableName => ({ table: tableName }));
    return {
      ast: { type: 'truncate', table: tables }, error: null
    };
  }

  const refreshMatch = cleanSql.match(/^\s*REFRESH\s+MATERIALIZED\s+VIEW\s+(?:CONCURRENTLY\s+)?([A-Za-z0-9_".\u0400-\u04FFёЁ\s]+)/i);
  if (refreshMatch) {
    return {
      ast: { type: 'refresh_view', table: [{ table: refreshMatch[1].trim() }] }, error: null
    };
  }

  const unionResult = splitTopLevelUnion(cleanSql);
  if (unionResult) {
    const asts = unionResult.parts.map(part => {
      const res = parseSingleSqlToAst(part, dialect);
      return res.ast;
    }).filter(Boolean);

    return {
      ast: { type: 'union', queries: asts, ops: unionResult.ops }, error: null
    };
  }

  const hasCte = /^\s*WITH\b/i.test(cleanSql);
  if (hasCte) {
    try {
      return { ast: parseHeuristicSelect(cleanSql, dialect), error: null };
    } catch (e: any) {
      return { ast: null, error: e.message || String(e) };
    }
  }

  const isDml = /^\s*(?:INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|MERGE\s+INTO)\b/i.test(cleanSql);

  let parserDialect = 'postgresql';
  const lowerDialect = dialect.toLowerCase();
  if (lowerDialect.includes('postgres')) {
    parserDialect = 'postgresql';
  } else if (lowerDialect.includes('oracle') || lowerDialect.includes('pl')) {
    parserDialect = 'oracle';
  } else if (lowerDialect.includes('clickhouse')) {
    parserDialect = 'postgresql';
  } else {
    parserDialect = lowerDialect;
  }

  try {
    let ast = parser.astify(cleanSql, { database: parserDialect });
    if (ast) {
      ast = transformNodeSqlParserUnion(ast);
      return { ast, error: null };
    }
  } catch (err: any) {
    // node-sql-parser failed, fall back gracefully
  }

  if (isDml) {
    try {
      const ast = parseHeuristicDml(cleanSql, dialect);
      if (ast) return { ast, error: null };
    } catch (err: any) {}
  }

  try {
    const ast = parseHeuristicSelect(cleanSql, dialect);
    return { ast, error: null };
  } catch (err: any) {
    return { ast: { type: 'statement', text: cleanSql }, error: err.message || String(err) };
  }
}

export function parseSqlToAst(sql: string, dialect: string): any {
  // На входе полностью очищаем скрипт от любых комментариев
  const cleanSql = stripCommentsSafely(sql).trim();

  // Разбиваем уже очищенный SQL (никаких проблем со строками)
  const queries = splitQueries(cleanSql);

  if (queries.length > 1) {
    const asts: any[] = [];
    for (const q of queries) {
      const res = parseSingleSqlToAst(q, dialect);
      if (res.ast) {
        asts.push(res.ast);
      }
    }
    return {
      ast: { type: 'multi_query', queries: asts },
      error: null
    };
  }

  return parseSingleSqlToAst(cleanSql, dialect);
}


// --- 6. GRAPH VISUALIZATION ENGINE ---

export function astToGraph(
  ast: any,
  prefix = 'main_',
  dialect = 'PostgreSQL',
  cteTableNodeIds: Record<string, string> = {},
  options: { showSort?: boolean; showLimit?: boolean; expandedQueries?: Set<string>; onToggleExpand?: (id: string) => void } = { showSort: true, showLimit: true }
): { nodes: any[]; edges: any[]; outputId: string } {
  let nodes: any[] = [];
  let edges: any[] = [];

  if (!ast) return { nodes, edges, outputId: '' };

  if (ast.type === 'multi_query') {
    let lastOutputId = '';
    ast.queries.forEach((qAst: any, qIdx: number) => {
      const qPrefix = `${prefix}q${qIdx}_`;
      const queryId = `${prefix}query_block_${qIdx}`;
      
      const isExpanded = options.expandedQueries && options.expandedQueries.has(queryId);
      
      if (!isExpanded) {
        const title = `Query ${qIdx + 1}`;
        let snippet = '';
        if (qAst.type === 'select') snippet = 'SELECT ...';
        else if (qAst.type === 'insert') snippet = 'INSERT INTO ...';
        else if (qAst.type === 'update') snippet = 'UPDATE ...';
        else if (qAst.type === 'delete') snippet = 'DELETE FROM ...';
        else if (qAst.type === 'merge') snippet = 'MERGE INTO ...';
        else if (qAst.type === 'statement') snippet = qAst.text || 'STATEMENT';
        
        nodes.push({
          id: queryId, type: 'queryGroupNode',
          data: { title, queryText: snippet, queryId, onToggle: options.onToggleExpand },
          position: { x: 0, y: 0 }
        });
        
        if (lastOutputId) {
          edges.push({
            id: `${prefix}multi_query_link_${qIdx}`, source: lastOutputId, target: queryId, animated: true,
            label: 'Next', style: { stroke: '#64748b', strokeDasharray: '5 5' }
          });
        }
        lastOutputId = queryId;
      } else {
        const qResult = astToGraph(qAst, qPrefix, dialect, cteTableNodeIds, options);
        nodes.push(...qResult.nodes);
        edges.push(...qResult.edges);
        
        const collapseId = `${queryId}_collapse`;
        nodes.push({
          id: collapseId, type: 'collapseNode',
          data: { title: `Hide Query ${qIdx + 1}`, queryId: queryId, onToggle: () => options.onToggleExpand?.(queryId) },
          position: { x: 0, y: 0 }
        });
        
        if (lastOutputId) {
          edges.push({
            id: `${prefix}multi_query_link_${qIdx}`, source: lastOutputId, target: collapseId, animated: true,
            label: 'Next', style: { stroke: '#64748b', strokeDasharray: '5 5' }
          });
        }
        
        if (qResult.nodes.length > 0) {
           const firstNode = qResult.nodes.find(n => n.type === 'tableNode' || n.type === 'constantNode') || qResult.nodes[0];
           edges.push({ id: `${prefix}collapse_link_${qIdx}`, source: collapseId, target: firstNode.id, animated: true });
        }
        
        if (qResult.outputId) {
          lastOutputId = qResult.outputId;
        } else if (qResult.nodes.length > 0) {
          lastOutputId = qResult.nodes[qResult.nodes.length - 1].id;
        } else {
          lastOutputId = collapseId;
        }
      }
    });
    return { nodes, edges, outputId: lastOutputId };
  }

  if (Array.isArray(ast)) ast = ast[0];
  if (!ast) return { nodes, edges, outputId: '' };

  if (ast.type === 'union') {
    let leftNodeId = '';
    const currentCteTableNodeIds = { ...cteTableNodeIds };

    ast.queries.forEach((qAst: any, qIdx: number) => {
      const qPrefix = `${prefix}union_q${qIdx}_`;
      const qResult = astToGraph(qAst, qPrefix, dialect, currentCteTableNodeIds, options);
      nodes.push(...qResult.nodes);
      edges.push(...qResult.edges);

      const subOutputId = qResult.outputId || (qResult.nodes.length > 0 ? qResult.nodes[qResult.nodes.length - 1].id : '');

      if (qIdx === 0) {
        leftNodeId = subOutputId;
      } else {
        const unionOpId = `${prefix}union_op_${qIdx}`;
        const opName = ast.ops[qIdx - 1] || 'UNION';

        nodes.push({
          id: unionOpId, type: 'joinNode',
          data: { joinType: opName, condition: 'ALL ROWS / CORRESPONDING' }, position: { x: 0, y: 0 }
        });
        if (leftNodeId) edges.push({ id: `${prefix}edge_union_left_${qIdx}`, source: leftNodeId, target: unionOpId, animated: true });
        if (subOutputId) edges.push({ id: `${prefix}edge_union_right_${qIdx}`, source: subOutputId, target: unionOpId, animated: true });
        leftNodeId = unionOpId;
      }
    });
    return { nodes, edges, outputId: leftNodeId };
  }

  const currentCteTableNodeIds = { ...cteTableNodeIds };

  if (ast.type === 'procedure') {
    const entryNodeId = `${prefix}proc_entry`;
    nodes.push({ id: entryNodeId, type: 'tableNode', data: { label: ast.name, alias: ast.dialect, title: 'PROCEDURE ENTRY POINT' }, position: { x: 0, y: 0 } });
    let lastStepId = entryNodeId;

    if (ast.variables && ast.variables.length > 0) {
      const varsNodeId = `${prefix}proc_vars`;
      nodes.push({ id: varsNodeId, type: 'constantNode', data: { title: 'LOCAL DECLARED VARIABLES', details: ast.variables.join('\n') }, position: { x: 0, y: 0 } });
      edges.push({ id: `${prefix}edge_proc_vars`, source: lastStepId, target: varsNodeId, animated: true, label: 'declares' });
      lastStepId = varsNodeId;
    }

    if (ast.parameters && ast.parameters.length > 0) {
      const paramsNodeId = `${prefix}proc_params`;
      nodes.push({ id: paramsNodeId, type: 'filterNode', data: { title: 'PARAMETERS / ARGUMENTS', condition: ast.parameters.join('\n'), iconType: 'edit' }, position: { x: 0, y: 0 } });
      edges.push({ id: `${prefix}edge_proc_params`, source: entryNodeId, target: paramsNodeId, animated: true });
    }

    const groupedSteps: any[] = [];
    let currentSimpleGroup: any[] = [];

    const isSimpleStep = (step: any) => {
      return !step.parsedQuery && (step.type === 'assignment_step' || step.type === 'statement' || step.type === 'exception_block');
    };

    ast.steps.forEach((step: any) => {
      if (isSimpleStep(step)) {
        currentSimpleGroup.push(step);
      } else {
        if (currentSimpleGroup.length > 0) {
          groupedSteps.push({ type: 'simple_group', steps: currentSimpleGroup });
          currentSimpleGroup = [];
        }
        groupedSteps.push(step);
      }
    });
    if (currentSimpleGroup.length > 0) groupedSteps.push({ type: 'simple_group', steps: currentSimpleGroup });

    groupedSteps.forEach((group: any, gIdx: number) => {
      if (group.type === 'simple_group') {
        const groupNodeId = `${prefix}proc_group_${gIdx}`;
        const details = group.steps.map((s: any) => s.text).join('\n\n');
        
        nodes.push({ id: groupNodeId, type: 'constantNode', data: { title: '⚙️ LOCAL OPERATIONS / STATE', details: details }, position: { x: 0, y: 0 } });
        edges.push({ id: `${prefix}edge_proc_group_${gIdx}`, source: lastStepId, target: groupNodeId, animated: true, label: 'Ops' });
        lastStepId = groupNodeId;
      } else {
        const step = group;
        const stepNodeId = `${prefix}proc_step_${gIdx}`;

        if (step.parsedQuery) {
          const queryId = `${prefix}proc_step_group_${gIdx}`;
          const stepPrefix = `${prefix}step_${gIdx}_`;
          const isExpanded = options.expandedQueries && options.expandedQueries.has(queryId);
          
          if (!isExpanded) {
            let snippet = '';
            if (step.parsedQuery.type === 'select') snippet = 'SELECT ...';
            else if (step.parsedQuery.type === 'insert') snippet = 'INSERT INTO ...';
            else if (step.parsedQuery.type === 'update') snippet = 'UPDATE ...';
            else if (step.parsedQuery.type === 'delete') snippet = 'DELETE FROM ...';
            else if (step.parsedQuery.type === 'merge') snippet = 'MERGE INTO ...';
            else if (step.parsedQuery.type === 'statement') snippet = step.parsedQuery.text || 'STATEMENT';
            
            nodes.push({ id: queryId, type: 'queryGroupNode', data: { title: step.title || `Step ${gIdx + 1}`, queryText: snippet || step.text, queryId: queryId, onToggle: options.onToggleExpand }, position: { x: 0, y: 0 } });
            edges.push({ id: `${prefix}edge_proc_group_step_${gIdx}`, source: lastStepId, target: queryId, animated: true, label: 'Flow' });
            lastStepId = queryId;
          } else {
            const subResult = astToGraph(step.parsedQuery, stepPrefix, dialect, currentCteTableNodeIds, options);
            nodes.push(...subResult.nodes);
            edges.push(...subResult.edges);

            const collapseId = `${queryId}_collapse`;
            nodes.push({ id: collapseId, type: 'collapseNode', data: { title: `Hide ${step.title || 'Step'}`, queryId: queryId, onToggle: options.onToggleExpand }, position: { x: 0, y: 0 } });
            edges.push({ id: `${prefix}edge_proc_collapse_step_${gIdx}`, source: lastStepId, target: collapseId, animated: true, label: 'Flow' });

            const firstNodes = subResult.nodes.filter(n => n.type === 'tableNode' && !n.id.includes('subquery_wrapper'));
            if (firstNodes.length > 0) {
              firstNodes.forEach((fn, fIdx) => { edges.push({ id: `${prefix}edge_step_link_${gIdx}_${fIdx}`, source: collapseId, target: fn.id, animated: true }); });
            } else if (subResult.nodes.length > 0) {
              edges.push({ id: `${prefix}edge_step_link_fb_${gIdx}`, source: collapseId, target: subResult.nodes[0].id, animated: true });
            }

            if (subResult.outputId) lastStepId = subResult.outputId;
            else if (subResult.nodes.length > 0) lastStepId = subResult.nodes[subResult.nodes.length - 1].id;
            else lastStepId = collapseId;
          }
        } else {
          let nodeType = 'filterNode';
          let title = step.title;
          let displayContent = step.text;

          if (step.type === 'conditional_step') { nodeType = 'filterNode'; title = `❓ ${step.title}`; } 
          else if (step.type === 'loop_step') { nodeType = 'groupByNode'; title = `🔄 ${step.title}`; }

          nodes.push({ id: stepNodeId, type: nodeType, data: { title: title, condition: displayContent, columns: displayContent }, position: { x: 0, y: 0 } });
          edges.push({ id: `${prefix}edge_proc_step_${gIdx}`, source: lastStepId, target: stepNodeId, animated: true, label: 'Flow' });
          lastStepId = stepNodeId;
        }
      }
    });

    const endId = `${prefix}proc_end`;
    nodes.push({ id: endId, type: 'resultNode', data: { title: 'PROCEDURE END / RETURN', columns: [{ name: 'Execution Completed Successfully' }] }, position: { x: 0, y: 0 } });
    edges.push({ id: `${prefix}edge_proc_end`, source: lastStepId, target: endId, animated: true });
    return { nodes, edges, outputId: endId };
  }

  if (ast.ctes && ast.ctes.length > 0) {
    ast.ctes.forEach((cte: any) => {
      const cteTableId = `${prefix}cte_table_${cte.name}`;
      currentCteTableNodeIds[cte.name.toLowerCase()] = cteTableId;
    });
  }

  if (ast.ctes && ast.ctes.length > 0) {
    ast.ctes.forEach((cte: any) => {
      const ctePrefix = `${prefix}cte_${cte.name}_`;
      const cteResult = astToGraph(cte.ast, ctePrefix, dialect, currentCteTableNodeIds, options);
      nodes.push(...cteResult.nodes);
      edges.push(...cteResult.edges);

      const cteTableId = currentCteTableNodeIds[cte.name.toLowerCase()];
      nodes.push({ id: cteTableId, type: 'tableNode', data: { label: cte.name, alias: '', title: 'Common Table Expression (CTE)', isSubquery: true }, position: { x: 0, y: 0 } });

      if (cteResult.outputId) {
        edges.push({ id: `${prefix}edge_cte_output_${cte.name}`, source: cteResult.outputId, target: cteTableId, animated: true, label: 'defines CTE', style: { strokeDasharray: '4 4' } });
      }
    });
  }

  const queryType = ast.type || 'select';

  if (['statement', 'conditional_step', 'assignment_step', 'loop_step', 'select_step', 'update_step', 'insert_step', 'delete_step', 'merge_step', 'exception_block'].includes(queryType)) {
    const stepId = `${prefix}${queryType}`;
    nodes.push({ id: stepId, type: 'filterNode', data: { title: queryType.replace('_', ' ').toUpperCase(), condition: ast.text || '' }, position: { x: 0, y: 0 } });
    return { nodes, edges, outputId: stepId };
  }

  if (queryType !== 'select') {
    const tableIds: string[] = [];
    const rawTables = ast.table ? (Array.isArray(ast.table) ? ast.table : [ast.table]) : [{ table: 'TARGET_TABLE' }];

    let targetColumns: any[] = [];
    if (queryType === 'insert') {
      if (ast.columns && ast.columns.length > 0) {
        targetColumns = ast.columns.map((col: any) => typeof col === 'string' ? col : formatExpr(col));
      } else if (ast.values && (ast.values.type === 'select' || ast.values.type === 'union')) {
        const selectAst = ast.values;
        if (selectAst.columns && Array.isArray(selectAst.columns)) {
          targetColumns = selectAst.columns.map((col: any) => {
            if (col.as) return typeof col.as === 'string' ? col.as : formatExpr(col.as);
            if (col.expr) return formatExpr(col.expr);
            return formatExpr(col);
          });
        }
      }
    }

    rawTables.forEach((targetTable: any, tIdx: number) => {
      const tableId = `${prefix}table_direct_${tIdx}`;
      const tableName = targetTable.table || 'TARGET_TABLE';
      const tableAlias = targetTable.as || '';
      
      const nodeData: any = { label: tableName, alias: tableAlias, title: `Target Table (${queryType.toUpperCase()})` };
      if (queryType === 'insert' && targetColumns.length > 0) {
        nodeData.columns = targetColumns.map((c: any) => typeof c === 'string' ? { name: c } : c);
      }

      nodes.push({ id: tableId, type: 'tableNode', data: nodeData, position: { x: 0, y: 0 } });
      tableIds.push(tableId);
    });

    let lastActiveId = tableIds[0] || '';

    if (queryType === 'insert') {
      const isSelectSource = ast.values && (ast.values.type === 'select' || ast.values.type === 'union' || ast.values.type === 'multi_query');

      if (isSelectSource) {
        const subResult = astToGraph(ast.values, `${prefix}insert_src_`, dialect, currentCteTableNodeIds, options);
        nodes.push(...subResult.nodes);
        edges.push(...subResult.edges);

        if (subResult.outputId) {
          tableIds.forEach(tableId => { edges.push({ id: `${prefix}edge_insert_select_${tableId}`, source: subResult.outputId, target: tableId, animated: true, label: 'INSERT INTO' }); });
        }
        lastActiveId = tableIds[0];
      } else {
        const sourceId = `${prefix}insert_source`;
        let columnsStr = '';
        if (ast.columns) columnsStr = `Columns: ${ast.columns.join(', ')}`;
        let valuesStr = '';
        if (ast.values && Array.isArray(ast.values)) valuesStr = `Values Count: ${ast.values.length}`;
        
        nodes.push({ id: sourceId, type: 'constantNode', data: { title: 'Insert Source Data', details: [columnsStr, valuesStr].filter(Boolean).join('\n') }, position: { x: 0, y: 0 } });
        tableIds.forEach(tableId => { edges.push({ id: `${prefix}edge_insert_source_${tableId}`, source: sourceId, target: tableId, animated: true, label: 'INSERT INTO' }); });
        lastActiveId = tableIds[0];
      }
      
      if (ast.on_conflict) {
          const conflictId = `${prefix}on_conflict`;
          nodes.push({ id: conflictId, type: 'filterNode', data: { title: 'ON CONFLICT', condition: ast.on_conflict }, position: { x: 0, y: 0 } });
          edges.push({ id: `${prefix}edge_on_conflict`, source: lastActiveId, target: conflictId, animated: true });
          lastActiveId = conflictId;
      }
    } else if (queryType === 'update') {
      const updateId = `${prefix}update_set`;
      const setDetails = ast.set ? ast.set.map((item: any) => `${item.column} = ${formatExpr(item.value)}`).join(', ') : '';
      nodes.push({ id: updateId, type: 'filterNode', data: { title: 'SET Actions', condition: setDetails, iconType: 'edit' }, position: { x: 0, y: 0 } });
      tableIds.forEach(tableId => { edges.push({ id: `${prefix}edge_update_set_${tableId}`, source: tableId, target: updateId, animated: true }); });
      lastActiveId = updateId;

      if (ast.where) {
        const filterId = `${prefix}filter_where`;
        nodes.push({ id: filterId, type: 'filterNode', data: { title: 'WHERE Filter', condition: formatExpr(ast.where) }, position: { x: 0, y: 0 } });
        edges.push({ id: `${prefix}edge_update_filter`, source: lastActiveId, target: filterId, animated: true });
        lastActiveId = filterId;
      }
    } else if (queryType === 'delete') {
      if (ast.where) {
        const filterId = `${prefix}filter_where`;
        nodes.push({ id: filterId, type: 'filterNode', data: { title: 'Delete Criteria (WHERE)', condition: formatExpr(ast.where) }, position: { x: 0, y: 0 } });
        tableIds.forEach(tableId => { edges.push({ id: `${prefix}edge_delete_filter_${tableId}`, source: tableId, target: filterId, animated: true }); });
        lastActiveId = filterId;
      }
    } else if (queryType === 'merge') {
      const mergeId = `${prefix}merge_action`;
      nodes.push({ id: mergeId, type: 'filterNode', data: { title: 'MERGE ACTION', condition: ast.text || 'Merge Clauses' }, position: { x: 0, y: 0 } });
      tableIds.forEach(tableId => { edges.push({ id: `${prefix}edge_merge_set_${tableId}`, source: tableId, target: mergeId, animated: true }); });
      lastActiveId = mergeId;
    }

    const resultId = `${prefix}result`;
    let resCols = [{ name: `Operation: ${queryType.toUpperCase()}` }, { name: 'Affected / Targeted Records' }];
    if (queryType === 'insert' && ast.columns && Array.isArray(ast.columns)) {
      resCols = [ { name: `Operation: INSERT` }, { name: 'Target Columns:' }, ...ast.columns.map((col: any) => ({ name: typeof col === 'string' ? col : formatExpr(col) })) ];
    } else if (queryType === 'truncate') {
      resCols = [ { name: `Operation: TRUNCATE` } ];
    } else if (queryType === 'refresh_view') {
      resCols = [ { name: `Operation: REFRESH MAT VIEW` } ];
    } else if (queryType === 'update' || queryType === 'delete' || queryType === 'merge') {
      resCols = [ { name: `Operation: ${queryType.toUpperCase()}` } ];
    }

    nodes.push({ id: resultId, type: 'resultNode', data: { title: 'Execution Completion', columns: resCols }, position: { x: 0, y: 0 } });

    if (queryType === 'insert') {
      edges.push({ id: `${prefix}edge_final_result_ins`, source: lastActiveId, target: resultId, animated: true });
    } else if (queryType === 'truncate' || queryType === 'refresh_view') {
      tableIds.forEach((tableId, tIdx) => { edges.push({ id: `${prefix}edge_final_result_${tIdx}`, source: tableId, target: resultId, animated: true }); });
    } else {
      edges.push({ id: `${prefix}edge_final_result`, source: lastActiveId, target: resultId, animated: true });
    }

    return { nodes, edges, outputId: resultId };
  }

  let lastActiveId = '';

  if ((!ast.from || ast.from.length === 0) && (!ast.columns || ast.columns.length === 0 || ast.columns === '*')) {
    return { nodes, edges, outputId: '' };
  }

  if (ast.from && Array.isArray(ast.from) && ast.from.length > 0) {
    for (let i = 0; i < ast.from.length; i++) {
      const fromItem = ast.from[i];
      
      if (!fromItem.expr && fromItem.table) {
        const trimmedTable = fromItem.table.trim();
        const hasSelect = /\bSELECT\b/i.test(trimmedTable);
        if (hasSelect) {
          const { sql: subSql, alias: extractedAlias } = extractCleanSubquerySql(trimmedTable);
          try {
            const parsed = parseSingleSqlToAst(subSql, dialect);
            if (parsed && parsed.ast) {
              fromItem.expr = { ast: parsed.ast };
              if (extractedAlias && !fromItem.as) {
                fromItem.as = extractedAlias;
              }
              delete fromItem.table;
            }
          } catch (e) {
             // Игнорируем и оставляем как есть
          }
        }
      }

      let currentTableOutputId = '';

      if (fromItem.expr && fromItem.expr.ast) {
        const subqueryAlias = fromItem.as || `subquery_${i}`;
        const subqueryPrefix = `${prefix}sub_${subqueryAlias}_`;

        const subResult = astToGraph(fromItem.expr.ast, subqueryPrefix, dialect, currentCteTableNodeIds, options);
        nodes.push(...subResult.nodes);
        edges.push(...subResult.edges);

        const subquerySrcTables = extractTablesFromAst(fromItem.expr.ast);

        const wrapperNodeId = `${prefix}subquery_wrapper_${i}`;
        nodes.push({ id: wrapperNodeId, type: 'tableNode', data: { label: `Subquery: ${subqueryAlias}`, alias: subqueryAlias, title: 'Derived Table View', isSubquery: true, subqueryTables: subquerySrcTables }, position: { x: 0, y: 0 } });

        if (subResult.outputId) edges.push({ id: `${prefix}edge_subquery_wrap_${i}`, source: subResult.outputId, target: wrapperNodeId, animated: true, style: { strokeDasharray: '4 4' } });
        currentTableOutputId = wrapperNodeId;
      } else {
        const tableName = fromItem.table || 'UNKNOWN_TABLE';
        const tableAlias = fromItem.as || '';
        const lowerName = tableName.toLowerCase();
        const cteTableId = currentCteTableNodeIds[lowerName];

        if (cteTableId) {
          currentTableOutputId = cteTableId;
        } else {
          const tableId = `${prefix}table_${i}`;
          nodes.push({ id: tableId, type: 'tableNode', data: { label: tableName, alias: tableAlias, title: 'Base Table' }, position: { x: 0, y: 0 } });
          currentTableOutputId = tableId;
        }
      }

      if (i === 0) {
        lastActiveId = currentTableOutputId;
      } else {
        const joinId = `${prefix}join_${i}`;
        const joinType = fromItem.join || 'INNER JOIN';
        const joinOn = fromItem.on ? formatExpr(fromItem.on) : 'NATURAL JOIN';

        nodes.push({ id: joinId, type: 'joinNode', data: { joinType: joinType, condition: joinOn }, position: { x: 0, y: 0 } });
        edges.push({ id: `${prefix}edge_join_left_${i}`, source: lastActiveId, target: joinId, animated: true });
        edges.push({ id: `${prefix}edge_join_right_${i}`, source: currentTableOutputId, target: joinId, animated: true });
        lastActiveId = joinId;
      }
    }
  } else {
    const constantId = `${prefix}constant_expr`;
    nodes.push({ id: constantId, type: 'constantNode', data: { title: 'Constant Source', details: 'Evaluated expressions' }, position: { x: 0, y: 0 } });
    lastActiveId = constantId;
  }
  
  if (ast.prewhere) {
      const prewhereId = `${prefix}filter_prewhere`;
      const conditionText = formatExpr(ast.prewhere);
      nodes.push({ id: prewhereId, type: 'filterNode', data: { title: 'PREWHERE Filter', condition: conditionText }, position: { x: 0, y: 0 } });
      edges.push({ id: `${prefix}edge_prewhere`, source: lastActiveId, target: prewhereId, animated: true });
      lastActiveId = prewhereId;
  }

  if (ast.where) {
    const filterId = `${prefix}filter_where`;
    const conditionText = formatExpr(ast.where);
    nodes.push({ id: filterId, type: 'filterNode', data: { title: 'WHERE Filter', condition: conditionText }, position: { x: 0, y: 0 } });
    edges.push({ id: `${prefix}edge_where`, source: lastActiveId, target: filterId, animated: true });
    lastActiveId = filterId;

    const nestedQueries = extractSubqueriesFromString(conditionText);
    nestedQueries.forEach((item, subIdx) => {
      try {
        const nestedPrefix = `${prefix}nested_where_${subIdx}_`;
        const parsedSub = parseSingleSqlToAst(item.subquerySql, dialect).ast;
        const subResult = astToGraph(parsedSub, nestedPrefix, dialect, currentCteTableNodeIds, options);
        nodes.push(...subResult.nodes);
        edges.push(...subResult.edges);

        if (subResult.outputId) {
          edges.push({ id: `${prefix}edge_nested_where_link_${subIdx}`, source: subResult.outputId, target: filterId, animated: true, label: 'subquery constraint', style: { strokeDasharray: '4 4' } });
        }
      } catch (e) {}
    });
  }

  if (ast.start_with || ast.connect_by) {
      const hierarchyId = `${prefix}hierarchy_connect`;
      let details = '';
      if (ast.start_with) details += `START WITH: ${formatExpr(ast.start_with)}\n`;
      if (ast.connect_by) details += `CONNECT BY: ${formatExpr(ast.connect_by)}`;
      nodes.push({ id: hierarchyId, type: 'filterNode', data: { title: 'Hierarchical Query', condition: details }, position: { x: 0, y: 0 } });
      edges.push({ id: `${prefix}edge_hierarchy`, source: lastActiveId, target: hierarchyId, animated: true });
      lastActiveId = hierarchyId;
  }

  if (ast.groupby && Array.isArray(ast.groupby) && ast.groupby.length > 0) {
    const groupbyId = `${prefix}groupby`;
    const groupedColumns = ast.groupby.map((col: any) => formatExpr(col)).join(', ');
    nodes.push({ id: groupbyId, type: 'groupByNode', data: { columns: groupedColumns }, position: { x: 0, y: 0 } });
    edges.push({ id: `${prefix}edge_groupby`, source: lastActiveId, target: groupbyId, animated: true });
    lastActiveId = groupbyId;
  }

  if (ast.having) {
    const havingId = `${prefix}having`;
    const conditionText = formatExpr(ast.having);
    nodes.push({ id: havingId, type: 'havingNode', data: { condition: conditionText }, position: { x: 0, y: 0 } });
    edges.push({ id: `${prefix}edge_having`, source: lastActiveId, target: havingId, animated: true });
    lastActiveId = havingId;

    const nestedQueries = extractSubqueriesFromString(conditionText);
    nestedQueries.forEach((item, subIdx) => {
      try {
        const nestedPrefix = `${prefix}nested_having_${subIdx}_`;
        const parsedSub = parseSingleSqlToAst(item.subquerySql, dialect).ast;
        const subResult = astToGraph(parsedSub, nestedPrefix, dialect, currentCteTableNodeIds, options);
        nodes.push(...subResult.nodes);
        edges.push(...subResult.edges);

        if (subResult.outputId) {
          edges.push({ id: `${prefix}edge_nested_having_link_${subIdx}`, source: subResult.outputId, target: havingId, animated: true, label: 'subquery constraint', style: { strokeDasharray: '4 4' } });
        }
      } catch (e) {}
    });
  }

  if (ast.orderby && Array.isArray(ast.orderby) && ast.orderby.length > 0 && options.showSort !== false) {
    const orderbyId = `${prefix}orderby`;
    const sortingDetails = ast.orderby.map((item: any) => `${formatExpr(item.expr)} ${item.type || 'ASC'}`).join(', ');
    nodes.push({ id: orderbyId, type: 'sortNode', data: { details: sortingDetails }, position: { x: 0, y: 0 } });
    edges.push({ id: `${prefix}edge_orderby`, source: lastActiveId, target: orderbyId, animated: true });
    lastActiveId = orderbyId;
  }

  if (ast.limit && ast.limit.value && Array.isArray(ast.limit.value) && options.showLimit !== false) {
    const limitId = `${prefix}limit`;
    const limitVal = ast.limit.value[0]?.value ?? '0';
    const offsetVal = ast.limit.value[1]?.value ?? '0';
    const limitText = `Limit: ${limitVal}` + (offsetVal !== '0' && offsetVal !== undefined ? `, Offset: ${offsetVal}` : '');
    nodes.push({ id: limitId, type: 'limitNode', data: { details: limitText }, position: { x: 0, y: 0 } });
    edges.push({ id: `${prefix}edge_limit`, source: lastActiveId, target: limitId, animated: true });
    lastActiveId = limitId;
  }

  const resultId = `${prefix}result`;
  const resultCols = ast.columns === '*' ? [{ name: '*' }] : (
    Array.isArray(ast.columns) ? ast.columns.map((col: any) => {
      return { name: formatExpr(col.expr), alias: col.as };
    }) : [{ name: '*' }]
  );

  nodes.push({ id: resultId, type: 'resultNode', data: { title: 'SELECT Output Columns', columns: resultCols }, position: { x: 0, y: 0 } });
  if (lastActiveId) edges.push({ id: `${prefix}edge_result`, source: lastActiveId, target: resultId, animated: true });

  if (Array.isArray(ast.columns)) {
    ast.columns.forEach((col: any, colIdx: number) => {
      const colExprStr = formatExpr(col.expr);
      const nestedQueries = extractSubqueriesFromString(colExprStr);
      nestedQueries.forEach((item, subIdx) => {
        try {
          const nestedPrefix = `${prefix}nested_select_${colIdx}_${subIdx}_`;
          const parsedSub = parseSingleSqlToAst(item.subquerySql, dialect).ast;
          const subResult = astToGraph(parsedSub, nestedPrefix, dialect, currentCteTableNodeIds, options);
          nodes.push(...subResult.nodes);
          edges.push(...subResult.edges);

          if (subResult.outputId) {
            edges.push({ id: `${prefix}edge_nested_select_link_${colIdx}_${subIdx}`, source: subResult.outputId, target: resultId, animated: true, label: 'scalar value', style: { strokeDasharray: '4 4' } });
          }
        } catch (e) {}
      });
    });
  }

  return { nodes, edges, outputId: resultId };
}

export function getLayoutedElements(nodes: GraphNode[], edges: GraphEdge[], direction = 'LR') {
  const isHorizontal = direction === 'LR';
  
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: direction, nodesep: 50, ranksep: 80 });

  const nodeWidth = 280;
  const nodeHeight = 150;

  nodes.forEach((node) => {
    let height = nodeHeight;
    if (node.type === 'resultNode' && node.data?.columns) {
      height = Math.max(nodeHeight, 80 + node.data.columns.length * 28);
    }
    dagreGraph.setNode(node.id, { width: nodeWidth, height });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const newNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    let height = nodeHeight;
    if (node.type === 'resultNode' && node.data?.columns) {
      height = Math.max(nodeHeight, 80 + node.data.columns.length * 28);
    }
    
    return {
      ...node,
      targetPosition: isHorizontal ? 'left' as const : 'top' as const,
      sourcePosition: isHorizontal ? 'right' as const : 'bottom' as const,
      position: {
        x: nodeWithPosition.x - nodeWidth / 2,
        y: nodeWithPosition.y - height / 2,
      },
    };
  });

  return { nodes: newNodes, edges };
}
