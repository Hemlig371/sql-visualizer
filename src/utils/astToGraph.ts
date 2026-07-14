// @ts-nocheck
import { Parser } from 'node-sql-parser';
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

export function formatExpr(expr: any): string {
  if (expr === null || expr === undefined) return '';
  if (typeof expr === 'string') return expr;
  if (typeof expr === 'number') return String(expr);
  if (typeof expr === 'boolean') return expr ? 'TRUE' : 'FALSE';

  if (expr.ast !== undefined) {
    return formatExpr(expr.ast);
  }

  if (expr.expr !== undefined) {
    return formatExpr(expr.expr);
  }

  if (Array.isArray(expr)) {
    return expr.map(formatExpr).join(', ');
  }

  // Handle over clause if present
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
    const innerOver = [partitionStr, orderStr].filter(Boolean).join(' ');
    overStr = ` OVER (${innerOver})`;
  }

  // Handle select / union statements directly to prevent JSON stringification
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

  // Handle distinct
  let prefix = '';
  if (expr.distinct) {
    prefix = 'DISTINCT ';
  }

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
      return `${aggrName}(${prefix}${aggrArgs})${overStr}`;
    case 'function':
      const funcName = typeof expr.name === 'object' ? formatExpr(expr.name) : expr.name;
      const funcArgs = Array.isArray(expr.args) ? expr.args.map(formatExpr).join(', ') : (expr.args ? formatExpr(expr.args) : '');
      return `${funcName}(${funcArgs})${overStr}`;
    case 'expr_list':
      if (Array.isArray(expr.value)) {
        return expr.value.map(formatExpr).join(', ');
      }
      return formatExpr(expr.value);
    case 'star':
      return '*';
    case 'interval':
      return `INTERVAL ${expr.value} ${expr.unit}`;
    case 'case':
      const cases = expr.args?.map((arg: any) => {
        if (!arg) return '';
        if (arg.type === 'when') {
          return `WHEN ${formatExpr(arg.cond)} THEN ${formatExpr(arg.result)}`;
        }
        if (arg.type === 'else') {
          return `ELSE ${formatExpr(arg.result)}`;
        }
        return '';
      }).filter(Boolean).join(' ');
      return `CASE ${cases} END`;
    default:
      if (expr.value !== undefined) {
        if (typeof expr.value === 'object' && expr.value !== null) {
          return formatExpr(expr.value);
        }
        return String(expr.value);
      }
      if (expr.column !== undefined) {
        return typeof expr.column === 'object' ? formatExpr(expr.column) : String(expr.column);
      }
      if (expr.name !== undefined) {
        return typeof expr.name === 'object' ? formatExpr(expr.name) : String(expr.name);
      }
      // If it looks like a subquery but doesn't have type "select" / "union" explicitly
      if (expr.from !== undefined || expr.columns !== undefined) {
        return '(SELECT ...)';
      }
      return '';
  }
}

function findClosingParenthesis(text: string, openIndex: number): number {
  let depth = 1;
  for (let i = openIndex + 1; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') {
      depth--;
      if (depth === 0) return i;
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
  const results: { subquerySql: string; startIndex: number; endIndex: number }[] = [];
  let searchIdx = 0;
  while (true) {
    const selectMatch = text.substring(searchIdx).match(/\(\s*SELECT\b/i);
    if (!selectMatch) break;
    
    const matchOffset = selectMatch.index!;
    const openParenIdx = searchIdx + matchOffset;
    const closeParenIdx = findClosingParenthesis(text, openParenIdx);
    if (closeParenIdx === -1) {
      break;
    }
    
    const subquerySql = text.substring(openParenIdx + 1, closeParenIdx).trim();
    results.push({
      subquerySql,
      startIndex: openParenIdx,
      endIndex: closeParenIdx
    });
    
    searchIdx = closeParenIdx + 1;
  }
  return results;
}

function splitByTopLevelCommas(text: string): string[] {
  const parts: string[] = [];
  let current = '';
  let parenDepth = 0;
  let bracketDepth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const prevChar = i > 0 ? text[i - 1] : '';

    if (inSingleQuote) {
      if (char === "'") {
        inSingleQuote = false;
      }
      current += char;
      continue;
    }
    if (inDoubleQuote) {
      if (char === '"') {
        inDoubleQuote = false;
      }
      current += char;
      continue;
    }
    if (inBacktick) {
      if (char === '`') {
        inBacktick = false;
      }
      current += char;
      continue;
    }

    if (char === "'") {
      inSingleQuote = true;
      current += char;
      continue;
    }
    if (char === '"') {
      inDoubleQuote = true;
      current += char;
      continue;
    }
    if (char === '`') {
      inBacktick = true;
      current += char;
      continue;
    }

    if (char === '(') {
      parenDepth++;
    } else if (char === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
    } else if (char === '[') {
      bracketDepth++;
    } else if (char === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1);
    }

    if (char === ',' && parenDepth === 0 && bracketDepth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    parts.push(current.trim());
  }
  return parts;
}

function parseHeuristicColumn(colStr: string): any {
  colStr = colStr.trim();
  
  let parenDepth = 0;
  let bracketDepth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  
  let lastAsIndex = -1;
  let lastSpaceIndex = -1;
  
  for (let i = 0; i < colStr.length; i++) {
    const char = colStr[i];
    const prevChar = i > 0 ? colStr[i - 1] : '';
    
    if (inSingleQuote) {
      if (char === "'") inSingleQuote = false;
      continue;
    }
    if (inDoubleQuote) {
      if (char === '"') inDoubleQuote = false;
      continue;
    }
    if (inBacktick) {
      if (char === '`') inBacktick = false;
      continue;
    }
    
    if (char === "'") { inSingleQuote = true; continue; }
    if (char === '"') { inDoubleQuote = true; continue; }
    if (char === '`') { inBacktick = true; continue; }
    
    if (char === '(') { parenDepth++; continue; }
    if (char === ')') { parenDepth = Math.max(0, parenDepth - 1); continue; }
    if (char === '[') { bracketDepth++; continue; }
    if (char === ']') { bracketDepth = Math.max(0, bracketDepth - 1); continue; }
    
    if (parenDepth === 0 && bracketDepth === 0) {
      if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
        const remaining = colStr.substring(i).trim();
        if (/^as\b/i.test(remaining)) {
          lastAsIndex = i;
        } else {
          lastSpaceIndex = i;
        }
      }
    }
  }
  
  let exprStr = colStr;
  let alias: string | null = null;
  
  if (lastAsIndex !== -1) {
    exprStr = colStr.substring(0, lastAsIndex).trim();
    const afterAs = colStr.substring(lastAsIndex).trim();
    const aliasPart = afterAs.replace(/^as\s+/i, '').trim();
    if (aliasPart) {
      alias = aliasPart.replace(/^["'`]|["'`]$/g, '').trim();
    }
  } else if (lastSpaceIndex !== -1) {
    const potentialAlias = colStr.substring(lastSpaceIndex).trim();
    const potentialExpr = colStr.substring(0, lastSpaceIndex).trim();
    
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

export function extractTablesFromAst(ast: any): string[] {
  if (!ast) return [];
  const tables: string[] = [];

  if (Array.isArray(ast)) {
    ast.forEach(item => {
      tables.push(...extractTablesFromAst(item));
    });
    return Array.from(new Set(tables));
  }

  if (ast.type === 'select') {
    if (ast.from && Array.isArray(ast.from)) {
      ast.from.forEach((item: any) => {
        if (item.table) {
          tables.push(item.table);
        }
        if (item.expr && item.expr.ast) {
          tables.push(...extractTablesFromAst(item.expr.ast));
        }
      });
    }
    if (ast.ctes && Array.isArray(ast.ctes)) {
      ast.ctes.forEach((cte: any) => {
        tables.push(...extractTablesFromAst(cte.ast));
      });
    }
  } else if (ast.type === 'union' && Array.isArray(ast.queries)) {
    ast.queries.forEach((q: any) => {
      tables.push(...extractTablesFromAst(q));
    });
  } else if (ast.table) {
    tables.push(ast.table);
  }

  return Array.from(new Set(tables));
}

export function parseHeuristicDml(sql: string, dialect: string): any {
  const cleanSql = sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
  const upperSql = cleanSql.toUpperCase();
  
  if (upperSql.startsWith('INSERT')) {
    // Находим индекс SELECT, VALUES, UNION, WITH
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
      if (rawTableName) {
        tableName = rawTableName;
      }
    } else {
      // fallback
      const tableMatch = cleanSql.match(/INSERT\s+INTO\s+([A-Za-z0-9_".\u0400-\u04FFёЁ]+)/i);
      tableName = tableMatch ? tableMatch[1] : 'TARGET_TABLE';
    }
    
    let selectAst: any = null;
    if (selectOrValuesMatch && ['SELECT', 'UNION', 'WITH'].includes(selectOrValuesMatch[1].toUpperCase())) {
      const selectSql = cleanSql.substring(selectOrValuesMatch.index).trim();
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
      if (matches) {
        valuesCount = matches.length;
      }
    }
    
    return {
      type: 'insert',
      table: { table: tableName },
      columns: columns,
      values: selectAst ? selectAst : Array(valuesCount).fill({ value: 'val' })
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
  
  return null;
}

export function transformNodeSqlParserUnion(ast: any): any {
  if (!ast) return ast;
  
  if (Array.isArray(ast)) {
    return ast.map(transformNodeSqlParserUnion);
  }
  
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

  return {
    table: str,
    as: null
  };
}

function parseHeuristicFromAndJoins(fromBlock: string, dialect: string): any[] {
  const fromList: any[] = [];
  if (!fromBlock) return fromList;

  const joinRegex = /\b(LEFT\s+OUTER\s+JOIN|RIGHT\s+OUTER\s+JOIN|FULL\s+OUTER\s+JOIN|INNER\s+JOIN|LEFT\s+JOIN|RIGHT\s+JOIN|FULL\s+JOIN|CROSS\s+JOIN|JOIN)\b/i;
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
    const cteHeaderMatch = workingSql.match(/^([A-Za-z0-9_\u0400-\u04FFёЁ]+)\s+AS\s*\(/i);
    if (!cteHeaderMatch) {
      break;
    }

    const cteName = cteHeaderMatch[1];
    const startIndex = cteHeaderMatch[0].length - 1;
    const closingIndex = findClosingParenthesis(workingSql, startIndex);
    
    if (closingIndex === -1) {
      break;
    }

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

function findTopLevelKeywordIndex(sql: string, keywordRegex: RegExp): number {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let inSingleLineComment = false;
  let inMultiLineComment = false;
  let parenDepth = 0;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const nextChar = sql[i + 1];

    if (inSingleLineComment) {
      if (char === '\n' || char === '\r') {
        inSingleLineComment = false;
      }
      continue;
    }
    if (inMultiLineComment) {
      if (char === '*' && nextChar === '/') {
        inMultiLineComment = false;
        i++;
      }
      continue;
    }

    if (inSingleQuote) {
      if (char === "'") inSingleQuote = false;
      continue;
    }
    if (inDoubleQuote) {
      if (char === '"') inDoubleQuote = false;
      continue;
    }
    if (inBacktick) {
      if (char === '`') inBacktick = false;
      continue;
    }

    if (char === '-' && nextChar === '-') {
      inSingleLineComment = true;
      i++;
      continue;
    }
    if (char === '/' && nextChar === '*') {
      inMultiLineComment = true;
      i++;
      continue;
    }

    if (char === '(') parenDepth++;
    if (char === ')') parenDepth--;

    if (parenDepth === 0 && !inSingleQuote && !inDoubleQuote && !inBacktick && !inSingleLineComment && !inMultiLineComment) {
      // check if it matches the keyword regex starting at this point
      const match = sql.substring(i).match(keywordRegex);
      if (match && match.index === 0) {
        return i;
      }
    }
  }

  return -1;
}

function parseHeuristicSelect(sql: string, dialect: string): any {
  const ast: any = {
    type: 'select',
    ctes: [],
    columns: [],
    from: [],
    where: null,
    groupby: null,
    having: null,
    orderby: null,
    limit: null
  };

  const { ctes, mainSql } = extractCtes(sql, dialect);
  ast.ctes = ctes;

  const lowerSql = mainSql.trim();

  const selectIdx = findTopLevelKeywordIndex(lowerSql, /^\bSELECT\b/i);
  const fromIdx = findTopLevelKeywordIndex(lowerSql, /^\bFROM\b/i);
  const whereIdx = findTopLevelKeywordIndex(lowerSql, /^\bWHERE\b/i);
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
    { type: 'select', idx: selectIdx },
    { type: 'from', idx: fromIdx },
    { type: 'where', idx: whereIdx },
    { type: 'groupby', idx: groupbyIdx },
    { type: 'having', idx: havingIdx },
    { type: 'orderby', idx: orderbyIdx },
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

  if (whereIdx !== -1) {
    const whereBlock = getBlock(whereIdx + 5, getNextIdx('where'));
    ast.where = { type: 'column_ref', column: whereBlock };
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
      return {
        expr: { type: 'column_ref', column: expr.trim() },
        type: isDesc ? 'DESC' : 'ASC'
      };
    });
  }

  if (limitIdx !== -1) {
    const limitBlock = getBlock(limitIdx + 5, getNextIdx('limit'));
    const parts = limitBlock.split(/\s*,|\s+OFFSET\s+/i);
    const limitVal = parts[0]?.trim() || '10';
    const offsetVal = parts[1]?.trim() || '0';
    ast.limit = {
      value: [
        { type: 'number', value: parseInt(limitVal) || limitVal },
        { type: 'number', value: parseInt(offsetVal) || offsetVal }
      ]
    };
  }

  return ast;
}

function splitProcedureStatements(bodyStr: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let inSingleLineComment = false;
  let inMultiLineComment = false;
  let parenDepth = 0;
  let blockDepth = 0;
  
  for (let i = 0; i < bodyStr.length; i++) {
    const char = bodyStr[i];
    const nextChar = bodyStr[i + 1];

    if (inSingleLineComment) {
      current += char;
      if (char === '\n' || char === '\r') {
        inSingleLineComment = false;
      }
      continue;
    }

    if (inMultiLineComment) {
      current += char;
      if (char === '*' && nextChar === '/') {
        current += '/';
        inMultiLineComment = false;
        i++;
      }
      continue;
    }
    
    if (inSingleQuote) {
      if (char === "'") inSingleQuote = false;
      current += char;
      continue;
    }
    if (inDoubleQuote) {
      if (char === '"') inDoubleQuote = false;
      current += char;
      continue;
    }
    if (inBacktick) {
      if (char === '`') inBacktick = false;
      current += char;
      continue;
    }

    // Check comments
    if (char === '-' && nextChar === '-') {
      inSingleLineComment = true;
      current += '--';
      i++;
      continue;
    }
    if (char === '#') {
      inSingleLineComment = true;
      current += '#';
      continue;
    }
    if (char === '/' && nextChar === '*') {
      inMultiLineComment = true;
      current += '/*';
      i++;
      continue;
    }

    if (char === "'") {
      inSingleQuote = true;
      current += char;
      continue;
    }
    if (char === '"') {
      inDoubleQuote = true;
      current += char;
      continue;
    }
    if (char === '`') {
      inBacktick = true;
      current += char;
      continue;
    }
    if (char === '(') {
      parenDepth++;
      current += char;
      continue;
    }
    if (char === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
      current += char;
      continue;
    }

    current += char;

    if (char === ';' && parenDepth === 0) {
      const tempUpper = current.toUpperCase();
      const openers = (tempUpper.match(/(?<!\bEND\s+)\b(IF|CASE|LOOP|BEGIN)\b/g) || []).length;
      const closers = (tempUpper.match(/\bEND\b/g) || []).length;
      
      blockDepth = openers - closers;
      if (blockDepth < 0) blockDepth = 0;

      if (blockDepth === 0) {
        if (current.trim()) {
          statements.push(current.trim());
        }
        current = '';
      }
    }
  }

  if (current.trim()) {
    statements.push(current.trim());
  }

  return statements;
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

      // Remove comments to check the actual statement type
      const cleanTextForType = text.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').trim().toUpperCase();

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
      } else if (cleanTextForType.startsWith('IF')) {
        stepType = 'conditional_step';
      } else if (cleanTextForType.startsWith('FOR') || cleanTextForType.startsWith('WHILE') || cleanTextForType.startsWith('LOOP')) {
        stepType = 'loop_step';
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

export function splitQueries(sql: string): string[] {
  const queries: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let dollarQuoteTag: string | null = null;
  let parenDepth = 0;
  let inSingleLineComment = false;
  let inMultiLineComment = false;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const nextChar = sql[i + 1];

    if (inSingleLineComment) {
      current += char;
      if (char === '\n' || char === '\r') {
        inSingleLineComment = false;
      }
      continue;
    }

    if (inMultiLineComment) {
      current += char;
      if (char === '*' && nextChar === '/') {
        current += '/';
        inMultiLineComment = false;
        i++; // skip /
      }
      continue;
    }

    if (inSingleQuote) {
      if (char === "'") {
        inSingleQuote = false;
      }
      current += char;
    } else if (inDoubleQuote) {
      if (char === '"') {
        inDoubleQuote = false;
      }
      current += char;
    } else if (inBacktick) {
      if (char === '`') {
        inBacktick = false;
      }
      current += char;
    } else if (dollarQuoteTag !== null) {
      current += char;
      if (char === '$' && sql.substring(i - dollarQuoteTag.length + 1, i + 1) === dollarQuoteTag) {
        dollarQuoteTag = null;
      }
    } else {
      // Check for start of comments
      if (char === '-' && nextChar === '-') {
        inSingleLineComment = true;
        i++; // skip second -
        continue;
      }
      if (char === '#') {
        inSingleLineComment = true;
        current += '#';
        continue;
      }
      if (char === '/' && nextChar === '*') {
        inMultiLineComment = true;
        current += '/*';
        i++; // skip *
        continue;
      }

      if (char === '$' && nextChar) {
        const remaining = sql.substring(i);
        const match = remaining.match(/^(\$[a-zA-Z0-9_]*\$)/);
        if (match) {
          dollarQuoteTag = match[1];
          current += dollarQuoteTag;
          i += dollarQuoteTag.length - 1;
          continue;
        }
      }

      if (char === "'") {
        inSingleQuote = true;
        current += char;
      } else if (char === '"') {
        inDoubleQuote = true;
        current += char;
      } else if (char === '`') {
        inBacktick = true;
        current += char;
      } else if (char === '(') {
        parenDepth++;
        current += char;
      } else if (char === ')') {
        parenDepth = Math.max(0, parenDepth - 1);
        current += char;
      } else if (char === ';') {
        const upperCurrent = current.toUpperCase();
        const isProc = /\b(?:CREATE\s+(?:OR\s+REPLACE\s+)?)?(?:PROCEDURE|FUNCTION|PACKAGE|TYPE|TRIGGER)\b/.test(upperCurrent);
        
        let blockDepth = 0;
        if (isProc) {
          const openers = (upperCurrent.match(/(?<!\bEND\s+)\b(IF|CASE|LOOP|BEGIN)\b/g) || []).length;
          const closers = (upperCurrent.match(/\bEND\b/g) || []).length;
          blockDepth = openers - closers;
          if (openers === 0) blockDepth = 1; // Wait until we see at least one BEGIN
        } else {
          const hasUnbalancedBegin = (upperCurrent.match(/\bBEGIN\b/g) || []).length > (upperCurrent.match(/\bEND\b/g) || []).length;
          if (hasUnbalancedBegin) blockDepth = 1;
        }
        
        if (parenDepth === 0 && blockDepth <= 0) {
          if (current.trim()) {
            queries.push(current.trim());
          }
          current = '';
        } else {
          current += char;
        }
      } else {
        current += char;
      }
    }
  }

  if (current.trim()) {
    queries.push(current.trim());
  }

  return queries;
}

function splitTopLevelUnion(sql: string): { parts: string[], ops: string[] } | null {
  const parts: string[] = [];
  const ops: string[] = [];
  
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let inSingleLineComment = false;
  let inMultiLineComment = false;
  let parenDepth = 0;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const nextChar = sql[i + 1];

    if (inSingleLineComment) {
      current += char;
      if (char === '\n' || char === '\r') {
        inSingleLineComment = false;
      }
      continue;
    }

    if (inMultiLineComment) {
      current += char;
      if (char === '*' && nextChar === '/') {
        current += '/';
        inMultiLineComment = false;
        i++;
      }
      continue;
    }

    if (inSingleQuote) {
      if (char === "'") inSingleQuote = false;
      current += char;
      continue;
    }
    if (inDoubleQuote) {
      if (char === '"') inDoubleQuote = false;
      current += char;
      continue;
    }
    if (inBacktick) {
      if (char === '`') inBacktick = false;
      current += char;
      continue;
    }

    // Check comments
    if (char === '-' && nextChar === '-') {
      inSingleLineComment = true;
      current += '--';
      i++;
      continue;
    }
    if (char === '#') {
      inSingleLineComment = true;
      current += '#';
      continue;
    }
    if (char === '/' && nextChar === '*') {
      inMultiLineComment = true;
      current += '/*';
      i++;
      continue;
    }

    if (char === "'") {
      inSingleQuote = true;
      current += char;
      continue;
    }
    if (char === '"') {
      inDoubleQuote = true;
      current += char;
      continue;
    }
    if (char === '`') {
      inBacktick = true;
      current += char;
      continue;
    }

    if (char === '(') {
      parenDepth++;
      current += char;
      continue;
    }
    if (char === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
      current += char;
      continue;
    }

    // Look for UNION / INTERSECT / EXCEPT
    if (parenDepth === 0) {
      const remaining = sql.substring(i);
      const unionAllMatch = remaining.match(/^(UNION\s+ALL)\b/i);
      const unionMatch = remaining.match(/^(UNION)\b/i);
      const intersectAllMatch = remaining.match(/^(INTERSECT\s+ALL)\b/i);
      const intersectMatch = remaining.match(/^(INTERSECT)\b/i);
      const exceptAllMatch = remaining.match(/^(EXCEPT\s+ALL)\b/i);
      const exceptMatch = remaining.match(/^(EXCEPT)\b/i);

      let foundOp: string | null = null;
      let opLength = 0;

      if (unionAllMatch) { foundOp = 'UNION ALL'; opLength = unionAllMatch[1].length; }
      else if (unionMatch) { foundOp = 'UNION'; opLength = unionMatch[1].length; }
      else if (intersectAllMatch) { foundOp = 'INTERSECT ALL'; opLength = intersectAllMatch[1].length; }
      else if (intersectMatch) { foundOp = 'INTERSECT'; opLength = intersectMatch[1].length; }
      else if (exceptAllMatch) { foundOp = 'EXCEPT ALL'; opLength = exceptAllMatch[1].length; }
      else if (exceptMatch) { foundOp = 'EXCEPT'; opLength = exceptMatch[1].length; }

      if (foundOp) {
        parts.push(current.trim());
        ops.push(foundOp);
        current = '';
        i += opLength - 1; // skip the operator characters
        continue;
      }
    }

    current += char;
  }

  if (parts.length > 0) {
    parts.push(current.trim());
    return { parts, ops };
  }

  return null;
}

export function parseSingleSqlToAst(sql: string, dialect: string): any {
  const cleanSql = sql.trim();
  const cleanSqlNoComments = cleanSql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
  const isProcedure = /CREATE\s+(?:OR\s+REPLACE\s+)?(?:PROCEDURE|FUNCTION|PACKAGE|TYPE|TRIGGER)|DECLARE\b|BEGIN\b/i.test(cleanSqlNoComments);

  if (isProcedure) {
    return { ast: parseHeuristicProcedure(cleanSql, dialect), error: null };
  }

  // TRUNCATE query check
  const truncateMatch = cleanSqlNoComments.match(/^\s*TRUNCATE\s+(?:TABLE\s+)?([A-Za-z0-9_".\u0400-\u04FFёЁ\s,]+)/i);
  if (truncateMatch) {
    const rawTables = truncateMatch[1].split(',').map(t => t.trim()).filter(Boolean);
    const tables = rawTables.map(tableName => ({ table: tableName }));
    return {
      ast: {
        type: 'truncate',
        table: tables
      },
      error: null
    };
  }

  // REFRESH MATERIALIZED VIEW check
  const refreshMatch = cleanSqlNoComments.match(/^\s*REFRESH\s+MATERIALIZED\s+VIEW\s+(?:CONCURRENTLY\s+)?([A-Za-z0-9_".\u0400-\u04FFёЁ\s]+)/i);
  if (refreshMatch) {
    return {
      ast: {
        type: 'refresh_view',
        table: [{ table: refreshMatch[1].trim() }]
      },
      error: null
    };
  }

  // Check for top-level set operations (UNION / INTERSECT / EXCEPT)
  const unionResult = splitTopLevelUnion(cleanSql);
  if (unionResult) {
    const asts = unionResult.parts.map(part => {
      const res = parseSingleSqlToAst(part, dialect);
      return res.ast;
    }).filter(Boolean);

    return {
      ast: {
        type: 'union',
        queries: asts,
        ops: unionResult.ops
      },
      error: null
    };
  }

  const hasCte = /^\s*WITH\b/i.test(cleanSqlNoComments);
  if (hasCte) {
    try {
      return { ast: parseHeuristicSelect(cleanSql, dialect), error: null };
    } catch (e: any) {
      return { ast: null, error: e.message || String(e) };
    }
  }

  const upperSql = cleanSqlNoComments.toUpperCase();
  const isDml = /^\s*(?:INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM)\b/i.test(cleanSqlNoComments);

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
      if (ast) {
        return { ast, error: null };
      }
    } catch (err: any) {
      // fallback
    }
  }

  try {
    const ast = parseHeuristicSelect(cleanSql, dialect);
    return { ast, error: null };
  } catch (err: any) {
    return { ast: { type: 'statement', text: cleanSql }, error: err.message || String(err) };
  }
}


export function stripCommentsSafely(sql: string): string {
  let result = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inSingleLineComment = false;
  let inMultiLineComment = false;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const nextChar = sql[i + 1] || '';

    if (inSingleLineComment) {
      if (char === '\n' || char === '\r') {
        inSingleLineComment = false;
        result += char;
      }
      continue;
    }

    if (inMultiLineComment) {
      if (char === '*' && nextChar === '/') {
        inMultiLineComment = false;
        result += ' ';
        i++;
      }
      continue;
    }

    if (inSingleQuote) {
      if (char === "'" && sql[i-1] !== '\\') inSingleQuote = false;
      result += char;
      continue;
    }

    if (inDoubleQuote) {
      if (char === '"' && sql[i-1] !== '\\') inDoubleQuote = false;
      result += char;
      continue;
    }

    if (char === '-' && nextChar === '-') {
      inSingleLineComment = true;
      i++;
      continue;
    }

    if (char === '/' && nextChar === '*') {
      inMultiLineComment = true;
      i++;
      continue;
    }

    if (char === "'") inSingleQuote = true;
    if (char === '"') inDoubleQuote = true;

    result += char;
  }
  return result.trim();
}

export function parseSqlToAst(sql: string, dialect: string): any {
  const cleanSql = stripCommentsSafely(sql).trim();

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
      ast: {
        type: 'multi_query',
        queries: asts
      },
      error: null
    };
  }

  return parseSingleSqlToAst(cleanSql, dialect);
}

export function astToGraph(
  ast: any,
  prefix = 'main_',
  dialect = 'PostgreSQL',
  cteTableNodeIds: Record<string, string> = {},
  options: { showSort?: boolean; showLimit?: boolean; expandedQueries?: Set<string>; onToggleExpand?: (id: string) => void } = { showSort: true, showLimit: true }
): { nodes: any[]; edges: any[]; outputId: string } {
  let nodes: any[] = [];
  let edges: any[] = [];

  if (!ast) {
    return { nodes, edges, outputId: '' };
  }

  
  if (ast.type === 'multi_query') {
    let lastOutputId = '';
    ast.queries.forEach((qAst: any, qIdx: number) => {
      const qPrefix = `${prefix}q${qIdx}_`;
      const queryId = `${prefix}query_block_${qIdx}`;
      
      const isExpanded = options.expandedQueries && options.expandedQueries.has(queryId);
      
      if (!isExpanded) {
        // Collapsed state
        const title = `Query ${qIdx + 1}`;
        let snippet = '';
        if (qAst.type === 'select') snippet = 'SELECT ...';
        else if (qAst.type === 'insert') snippet = 'INSERT INTO ...';
        else if (qAst.type === 'update') snippet = 'UPDATE ...';
        else if (qAst.type === 'delete') snippet = 'DELETE FROM ...';
        else if (qAst.type === 'statement') snippet = qAst.text || 'STATEMENT';
        
        nodes.push({
          id: queryId,
          type: 'queryGroupNode',
          data: {
            title,
            queryText: snippet,
            queryId,
            onToggle: options.onToggleExpand
          },
          position: { x: 0, y: 0 }
        });
        
        if (lastOutputId) {
          edges.push({
            id: `${prefix}multi_query_link_${qIdx}`,
            source: lastOutputId,
            target: queryId,
            animated: true,
            label: 'Next',
            style: { stroke: '#64748b', strokeDasharray: '5 5' }
          });
        }
        lastOutputId = queryId;
      } else {
        // Expanded state
        const qResult = astToGraph(qAst, qPrefix, dialect, cteTableNodeIds, options);
        nodes.push(...qResult.nodes);
        edges.push(...qResult.edges);
        
        // Add a "Collapse" button node or something? Actually, we can just use the first node
        // or wrap it. But let's just render the nodes and maybe add a "Collapse" node at the start?
        // Actually, just render normally for now, user can't collapse easily unless we add a button.
        // Wait, let's add a Collapse node at the start of the query!
        const collapseId = `${queryId}_collapse`;
        nodes.push({
          id: collapseId,
          type: 'collapseNode',
          data: {
            title: `Hide Query ${qIdx + 1}`,
            queryId: queryId,
            onToggle: () => options.onToggleExpand?.(queryId)
          },
          position: { x: 0, y: 0 }
        });
        
        if (lastOutputId) {
          edges.push({
            id: `${prefix}multi_query_link_${qIdx}`,
            source: lastOutputId,
            target: collapseId,
            animated: true,
            label: 'Next',
            style: { stroke: '#64748b', strokeDasharray: '5 5' }
          });
        }
        
        if (qResult.nodes.length > 0) {
           const firstNode = qResult.nodes.find(n => n.type === 'tableNode' || n.type === 'constantNode') || qResult.nodes[0];
           edges.push({
             id: `${prefix}collapse_link_${qIdx}`,
             source: collapseId,
             target: firstNode.id,
             animated: true
           });
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


  if (Array.isArray(ast)) {
    ast = ast[0];
  }

  if (!ast) {
    return { nodes, edges, outputId: '' };
  }

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
          id: unionOpId,
          type: 'joinNode',
          data: {
            joinType: opName,
            condition: 'ALL ROWS / CORRESPONDING'
          },
          position: { x: 0, y: 0 }
        });

        if (leftNodeId) {
          edges.push({
            id: `${prefix}edge_union_left_${qIdx}`,
            source: leftNodeId,
            target: unionOpId,
            animated: true
          });
        }

        if (subOutputId) {
          edges.push({
            id: `${prefix}edge_union_right_${qIdx}`,
            source: subOutputId,
            target: unionOpId,
            animated: true
          });
        }

        leftNodeId = unionOpId;
      }
    });

    return { nodes, edges, outputId: leftNodeId };
  }

  const currentCteTableNodeIds = { ...cteTableNodeIds };

  // Handle PL/SQL Procedure AST
  if (ast.type === 'procedure') {
    const entryNodeId = `${prefix}proc_entry`;
    nodes.push({
      id: entryNodeId,
      type: 'tableNode',
      data: {
        label: ast.name,
        alias: ast.dialect,
        title: 'PROCEDURE ENTRY POINT'
      },
      position: { x: 0, y: 0 }
    });

    let lastStepId = entryNodeId;

    if (ast.variables && ast.variables.length > 0) {
      const varsNodeId = `${prefix}proc_vars`;
      nodes.push({
        id: varsNodeId,
        type: 'constantNode',
        data: {
          title: 'LOCAL DECLARED VARIABLES',
          details: ast.variables.join('\n')
        },
        position: { x: 0, y: 0 }
      });
      edges.push({
        id: `${prefix}edge_proc_vars`,
        source: lastStepId,
        target: varsNodeId,
        animated: true,
        label: 'declares'
      });
      lastStepId = varsNodeId;
    }

    if (ast.parameters && ast.parameters.length > 0) {
      const paramsNodeId = `${prefix}proc_params`;
      nodes.push({
        id: paramsNodeId,
        type: 'filterNode',
        data: {
          title: 'PARAMETERS / ARGUMENTS',
          condition: ast.parameters.join('\n'),
          iconType: 'edit'
        },
        position: { x: 0, y: 0 }
      });
      edges.push({
        id: `${prefix}edge_proc_params`,
        source: entryNodeId,
        target: paramsNodeId,
        animated: true
      });
    }

    // Group consecutive simple steps to reduce flowchart clutter (assignments, transaction control, simple variables, etc.)
    const groupedSteps: any[] = [];
    let currentSimpleGroup: any[] = [];

    const isSimpleStep = (step: any) => {
      return !step.parsedQuery && (step.type === 'assignment_step' || step.type === 'statement');
    };

    ast.steps.forEach((step: any) => {
      if (isSimpleStep(step)) {
        currentSimpleGroup.push(step);
      } else {
        if (currentSimpleGroup.length > 0) {
          groupedSteps.push({
            type: 'simple_group',
            steps: currentSimpleGroup
          });
          currentSimpleGroup = [];
        }
        groupedSteps.push(step);
      }
    });

    if (currentSimpleGroup.length > 0) {
      groupedSteps.push({
        type: 'simple_group',
        steps: currentSimpleGroup
      });
    }

    groupedSteps.forEach((group: any, gIdx: number) => {
      if (group.type === 'simple_group') {
        const groupNodeId = `${prefix}proc_group_${gIdx}`;
        const details = group.steps.map((s: any) => s.text).join('\n\n');
        
        nodes.push({
          id: groupNodeId,
          type: 'constantNode',
          data: {
            title: '⚙️ LOCAL OPERATIONS / STATE',
            details: details
          },
          position: { x: 0, y: 0 }
        });

        edges.push({
          id: `${prefix}edge_proc_group_${gIdx}`,
          source: lastStepId,
          target: groupNodeId,
          animated: true,
          label: 'Ops'
        });

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
            else if (step.parsedQuery.type === 'statement') snippet = step.parsedQuery.text || 'STATEMENT';
            
            nodes.push({
              id: queryId,
              type: 'queryGroupNode',
              data: {
                title: step.title || `Step ${gIdx + 1}`,
                queryText: snippet || step.text,
                queryId: queryId,
                onToggle: options.onToggleExpand
              },
              position: { x: 0, y: 0 }
            });
            
            edges.push({
              id: `${prefix}edge_proc_group_step_${gIdx}`,
              source: lastStepId,
              target: queryId,
              animated: true,
              label: 'Flow'
            });
            lastStepId = queryId;
          } else {
            const subResult = astToGraph(step.parsedQuery, stepPrefix, dialect, currentCteTableNodeIds, options);
            nodes.push(...subResult.nodes);
            edges.push(...subResult.edges);

            const collapseId = `${queryId}_collapse`;
            nodes.push({
              id: collapseId,
              type: 'collapseNode',
              data: {
                title: `Hide ${step.title || 'Step'}`,
                queryId: queryId,
                onToggle: options.onToggleExpand
              },
              position: { x: 0, y: 0 }
            });

            edges.push({
              id: `${prefix}edge_proc_collapse_step_${gIdx}`,
              source: lastStepId,
              target: collapseId,
              animated: true,
              label: 'Flow'
            });

            const firstNodes = subResult.nodes.filter(n => n.type === 'tableNode' && !n.id.includes('subquery_wrapper'));
            if (firstNodes.length > 0) {
              firstNodes.forEach((fn, fIdx) => {
                edges.push({
                  id: `${prefix}edge_step_link_${gIdx}_${fIdx}`,
                  source: collapseId,
                  target: fn.id,
                  animated: true
                });
              });
            } else if (subResult.nodes.length > 0) {
              edges.push({
                id: `${prefix}edge_step_link_fb_${gIdx}`,
                source: collapseId,
                target: subResult.nodes[0].id,
                animated: true
              });
            }

            if (subResult.outputId) {
              lastStepId = subResult.outputId;
            } else if (subResult.nodes.length > 0) {
              lastStepId = subResult.nodes[subResult.nodes.length - 1].id;
            } else {
              lastStepId = collapseId;
            }
          }
        } else {

          let nodeType = 'filterNode';
          let title = step.title;
          let displayContent = step.text;

          if (step.type === 'conditional_step') {
            nodeType = 'filterNode';
            title = `❓ ${step.title}`;
          } else if (step.type === 'loop_step') {
            nodeType = 'groupByNode';
            title = `🔄 ${step.title}`;
          }

          nodes.push({
            id: stepNodeId,
            type: nodeType,
            data: {
              title: title,
              condition: displayContent,
              columns: displayContent
            },
            position: { x: 0, y: 0 }
          });

          edges.push({
            id: `${prefix}edge_proc_step_${gIdx}`,
            source: lastStepId,
            target: stepNodeId,
            animated: true,
            label: 'Flow'
          });

          lastStepId = stepNodeId;
        }
      }
    });

    const endId = `${prefix}proc_end`;
    nodes.push({
      id: endId,
      type: 'resultNode',
      data: {
        title: 'PROCEDURE END / RETURN',
        columns: [{ name: 'Execution Completed Successfully' }]
      },
      position: { x: 0, y: 0 }
    });

    edges.push({
      id: `${prefix}edge_proc_end`,
      source: lastStepId,
      target: endId,
      animated: true
    });

    return { nodes, edges, outputId: endId };
  }

  // Pre-register all CTE node IDs defined at this query block level to allow references
  if (ast.ctes && ast.ctes.length > 0) {
    ast.ctes.forEach((cte: any) => {
      const cteTableId = `${prefix}cte_table_${cte.name}`;
      currentCteTableNodeIds[cte.name.toLowerCase()] = cteTableId;
    });
  }

  // Parse CTE subgraphs
  if (ast.ctes && ast.ctes.length > 0) {
    ast.ctes.forEach((cte: any) => {
      const ctePrefix = `${prefix}cte_${cte.name}_`;
      const cteResult = astToGraph(cte.ast, ctePrefix, dialect, currentCteTableNodeIds, options);
      nodes.push(...cteResult.nodes);
      edges.push(...cteResult.edges);

      const cteTableId = currentCteTableNodeIds[cte.name.toLowerCase()];
      nodes.push({
        id: cteTableId,
        type: 'tableNode',
        data: {
          label: cte.name,
          alias: '',
          title: 'Common Table Expression (CTE)',
          isSubquery: true
        },
        position: { x: 0, y: 0 }
      });

      if (cteResult.outputId) {
        edges.push({
          id: `${prefix}edge_cte_output_${cte.name}`,
          source: cteResult.outputId,
          target: cteTableId,
          animated: true,
          label: 'defines CTE',
          style: { strokeDasharray: '4 4' }
        });
      }
    });
  }

  
  const queryType = ast.type || 'select';

  if (queryType === 'statement' || queryType === 'conditional_step' || queryType === 'assignment_step' || queryType === 'loop_step' || queryType === 'select_step' || queryType === 'update_step' || queryType === 'insert_step' || queryType === 'delete_step') {
    const stepId = `${prefix}${queryType}`;
    nodes.push({
      id: stepId,
      type: 'filterNode',
      data: {
        title: queryType.replace('_', ' ').toUpperCase(),
        condition: ast.text || ''
      },
      position: { x: 0, y: 0 }
    });
    return { nodes, edges, outputId: stepId };
  }

  if (queryType !== 'select') {
    const tableNodes: any[] = [];
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
            if (col.expr) {
              return formatExpr(col.expr);
            }
            return formatExpr(col);
          });
        }
      }
    }

    rawTables.forEach((targetTable: any, tIdx: number) => {
      const tableId = `${prefix}table_direct_${tIdx}`;
      const tableName = targetTable.table || 'TARGET_TABLE';
      const tableAlias = targetTable.as || '';
      
      const nodeData: any = {
        label: tableName,
        alias: tableAlias,
        title: `Target Table (${queryType.toUpperCase()})`
      };

      if (queryType === 'insert' && targetColumns.length > 0) {
        nodeData.columns = targetColumns.map((c: any) => typeof c === 'string' ? { name: c } : c);
      }

      nodes.push({
        id: tableId,
        type: 'tableNode',
        data: nodeData,
        position: { x: 0, y: 0 }
      });
      tableIds.push(tableId);
    });

    let lastActiveId = tableIds[0] || '';

    if (queryType === 'insert') {
      const isSelectSource = ast.values && (ast.values.type === 'select' || ast.values.type === 'union' || ast.values.type === 'multi_query');

      if (isSelectSource) {
        // Build nested select query flow recursively
        const subResult = astToGraph(ast.values, `${prefix}insert_src_`, dialect, currentCteTableNodeIds, options);
        nodes.push(...subResult.nodes);
        edges.push(...subResult.edges);

        if (subResult.outputId) {
          tableIds.forEach(tableId => {
            edges.push({
              id: `${prefix}edge_insert_select_${tableId}`,
              source: subResult.outputId,
              target: tableId,
              animated: true,
              label: 'INSERT INTO'
            });
          });
        }
        lastActiveId = tableIds[0];
      } else {
        const sourceId = `${prefix}insert_source`;
        let columnsStr = '';
        if (ast.columns) columnsStr = `Columns: ${ast.columns.join(', ')}`;
        let valuesStr = '';
        if (ast.values && Array.isArray(ast.values)) {
          valuesStr = `Values Count: ${ast.values.length}`;
        }
        nodes.push({
          id: sourceId,
          type: 'constantNode',
          data: {
            title: 'Insert Source Data',
            details: [columnsStr, valuesStr].filter(Boolean).join('\n')
          },
          position: { x: 0, y: 0 }
        });
        tableIds.forEach(tableId => {
          edges.push({
            id: `${prefix}edge_insert_source_${tableId}`,
            source: sourceId,
            target: tableId,
            animated: true,
            label: 'INSERT INTO'
          });
        });
        lastActiveId = tableIds[0];
      }
    } else if (queryType === 'update') {
      const updateId = `${prefix}update_set`;
      const setDetails = ast.set ? ast.set.map((item: any) => `${item.column} = ${formatExpr(item.value)}`).join(', ') : '';
      nodes.push({
        id: updateId,
        type: 'filterNode',
        data: {
          title: 'SET Actions',
          condition: setDetails,
          iconType: 'edit'
        },
        position: { x: 0, y: 0 }
      });
      tableIds.forEach(tableId => {
        edges.push({
          id: `${prefix}edge_update_set_${tableId}`,
          source: tableId,
          target: updateId,
          animated: true
        });
      });
      lastActiveId = updateId;

      if (ast.where) {
        const filterId = `${prefix}filter_where`;
        nodes.push({
          id: filterId,
          type: 'filterNode',
          data: {
            title: 'WHERE Filter',
            condition: formatExpr(ast.where)
          },
          position: { x: 0, y: 0 }
        });
        edges.push({
          id: `${prefix}edge_update_filter`,
          source: lastActiveId,
          target: filterId,
          animated: true
        });
        lastActiveId = filterId;
      }
    } else if (queryType === 'delete') {
      if (ast.where) {
        const filterId = `${prefix}filter_where`;
        nodes.push({
          id: filterId,
          type: 'filterNode',
          data: {
            title: 'Delete Criteria (WHERE)',
            condition: formatExpr(ast.where)
          },
          position: { x: 0, y: 0 }
        });
        tableIds.forEach(tableId => {
          edges.push({
            id: `${prefix}edge_delete_filter_${tableId}`,
            source: tableId,
            target: filterId,
            animated: true
          });
        });
        lastActiveId = filterId;
      }
    }

    const resultId = `${prefix}result`;
    let resCols = [{ name: `Operation: ${queryType.toUpperCase()}` }, { name: 'Affected / Targeted Records' }];
    if (queryType === 'insert' && ast.columns && Array.isArray(ast.columns)) {
      resCols = [
        { name: `Operation: INSERT` },
        { name: 'Target Columns:' },
        ...ast.columns.map((col: any) => ({ name: typeof col === 'string' ? col : formatExpr(col) }))
      ];
    } else if (queryType === 'truncate') {
      resCols = [
        { name: `Operation: TRUNCATE` }
      ];
    } else if (queryType === 'refresh_view') {
      resCols = [
        { name: `Operation: REFRESH MAT VIEW` }
      ];
    } else if (queryType === 'update' || queryType === 'delete') {
      resCols = [
        { name: `Operation: ${queryType.toUpperCase()}` }
      ];
    }

    nodes.push({
      id: resultId,
      type: 'resultNode',
      data: {
        title: 'Execution Completion',
        columns: resCols
      },
      position: { x: 0, y: 0 }
    });

    if (queryType === 'insert') {
      tableIds.forEach((tableId, tIdx) => {
        edges.push({
          id: `${prefix}edge_final_result_${tIdx}`,
          source: tableId,
          target: resultId,
          animated: true
        });
      });
    } else if (queryType === 'truncate' || queryType === 'refresh_view') {
      tableIds.forEach((tableId, tIdx) => {
        edges.push({
          id: `${prefix}edge_final_result_${tIdx}`,
          source: tableId,
          target: resultId,
          animated: true
        });
      });
    } else {
      edges.push({
        id: `${prefix}edge_final_result`,
        source: lastActiveId,
        target: resultId,
        animated: true
      });
    }

    return { nodes, edges, outputId: resultId };
  }

  // Standard SELECT query logic
  let lastActiveId = '';

  if ((!ast.from || ast.from.length === 0) && (!ast.columns || ast.columns.length === 0 || ast.columns === '*')) {
    // Empty select block, usually unsupported syntax parsed badly
    return { nodes, edges, outputId: '' };
  }

  if (ast.from && Array.isArray(ast.from) && ast.from.length > 0) {
    for (let i = 0; i < ast.from.length; i++) {
      const fromItem = ast.from[i];
      
      // Предобработка: если в fromItem.table содержится подзапрос, попробуем его распарсить
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
        nodes.push({
          id: wrapperNodeId,
          type: 'tableNode',
          data: {
            label: `Subquery: ${subqueryAlias}`,
            alias: subqueryAlias,
            title: 'Derived Table View',
            isSubquery: true,
            subqueryTables: subquerySrcTables
          },
          position: { x: 0, y: 0 }
        });

        if (subResult.outputId) {
          edges.push({
            id: `${prefix}edge_subquery_wrap_${i}`,
            source: subResult.outputId,
            target: wrapperNodeId,
            animated: true,
            style: { strokeDasharray: '4 4' }
          });
        }

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
          nodes.push({
            id: tableId,
            type: 'tableNode',
            data: {
              label: tableName,
              alias: tableAlias,
              title: 'Base Table'
            },
            position: { x: 0, y: 0 }
          });
          currentTableOutputId = tableId;
        }
      }

      if (i === 0) {
        lastActiveId = currentTableOutputId;
      } else {
        const joinId = `${prefix}join_${i}`;
        const joinType = fromItem.join || 'INNER JOIN';
        const joinOn = fromItem.on ? formatExpr(fromItem.on) : 'NATURAL JOIN';

        nodes.push({
          id: joinId,
          type: 'joinNode',
          data: {
            joinType: joinType,
            condition: joinOn
          },
          position: { x: 0, y: 0 }
        });

        edges.push({
          id: `${prefix}edge_join_left_${i}`,
          source: lastActiveId,
          target: joinId,
          animated: true
        });

        edges.push({
          id: `${prefix}edge_join_right_${i}`,
          source: currentTableOutputId,
          target: joinId,
          animated: true
        });

        lastActiveId = joinId;
      }
    }
  } else {
    const constantId = `${prefix}constant_expr`;
    nodes.push({
      id: constantId,
      type: 'constantNode',
      data: {
        title: 'Constant Source',
        details: 'Evaluated expressions'
      },
      position: { x: 0, y: 0 }
    });
    lastActiveId = constantId;
  }

  // Filter (WHERE)
  if (ast.where) {
    const filterId = `${prefix}filter_where`;
    const conditionText = formatExpr(ast.where);
    nodes.push({
      id: filterId,
      type: 'filterNode',
      data: {
        title: 'WHERE Filter',
        condition: conditionText
      },
      position: { x: 0, y: 0 }
    });

    edges.push({
      id: `${prefix}edge_where`,
      source: lastActiveId,
      target: filterId,
      animated: true
    });

    lastActiveId = filterId;

    // Process nested subqueries inside the WHERE clause
    const nestedQueries = extractSubqueriesFromString(conditionText);
    nestedQueries.forEach((item, subIdx) => {
      try {
        const nestedPrefix = `${prefix}nested_where_${subIdx}_`;
        const parsedSub = parseSingleSqlToAst(item.subquerySql, dialect).ast;
        const subResult = astToGraph(parsedSub, nestedPrefix, dialect, currentCteTableNodeIds, options);
        nodes.push(...subResult.nodes);
        edges.push(...subResult.edges);

        if (subResult.outputId) {
          edges.push({
            id: `${prefix}edge_nested_where_link_${subIdx}`,
            source: subResult.outputId,
            target: filterId,
            animated: true,
            label: 'subquery constraint',
            style: { strokeDasharray: '4 4' }
          });
        }
      } catch (e) {
        // Gracefully ignore
      }
    });
  }

  // GROUP BY
  if (ast.groupby && Array.isArray(ast.groupby) && ast.groupby.length > 0) {
    const groupbyId = `${prefix}groupby`;
    const groupedColumns = ast.groupby.map((col: any) => formatExpr(col)).join(', ');

    nodes.push({
      id: groupbyId,
      type: 'groupByNode',
      data: {
        columns: groupedColumns
      },
      position: { x: 0, y: 0 }
    });

    edges.push({
      id: `${prefix}edge_groupby`,
      source: lastActiveId,
      target: groupbyId,
      animated: true
    });

    lastActiveId = groupbyId;
  }

  // HAVING
  if (ast.having) {
    const havingId = `${prefix}having`;
    const conditionText = formatExpr(ast.having);
    nodes.push({
      id: havingId,
      type: 'havingNode',
      data: {
        condition: conditionText
      },
      position: { x: 0, y: 0 }
    });

    edges.push({
      id: `${prefix}edge_having`,
      source: lastActiveId,
      target: havingId,
      animated: true
    });

    lastActiveId = havingId;

    // Process nested subqueries inside the HAVING clause
    const nestedQueries = extractSubqueriesFromString(conditionText);
    nestedQueries.forEach((item, subIdx) => {
      try {
        const nestedPrefix = `${prefix}nested_having_${subIdx}_`;
        const parsedSub = parseSingleSqlToAst(item.subquerySql, dialect).ast;
        const subResult = astToGraph(parsedSub, nestedPrefix, dialect, currentCteTableNodeIds, options);
        nodes.push(...subResult.nodes);
        edges.push(...subResult.edges);

        if (subResult.outputId) {
          edges.push({
            id: `${prefix}edge_nested_having_link_${subIdx}`,
            source: subResult.outputId,
            target: havingId,
            animated: true,
            label: 'subquery constraint',
            style: { strokeDasharray: '4 4' }
          });
        }
      } catch (e) {
        // Gracefully ignore
      }
    });
  }

  // ORDER BY
  if (ast.orderby && Array.isArray(ast.orderby) && ast.orderby.length > 0 && options.showSort !== false) {
    const orderbyId = `${prefix}orderby`;
    const sortingDetails = ast.orderby.map((item: any) => `${formatExpr(item.expr)} ${item.type || 'ASC'}`).join(', ');

    nodes.push({
      id: orderbyId,
      type: 'sortNode',
      data: {
        details: sortingDetails
      },
      position: { x: 0, y: 0 }
    });

    edges.push({
      id: `${prefix}edge_orderby`,
      source: lastActiveId,
      target: orderbyId,
      animated: true
    });

    lastActiveId = orderbyId;
  }

  // LIMIT
  if (ast.limit && ast.limit.value && Array.isArray(ast.limit.value) && options.showLimit !== false) {
    const limitId = `${prefix}limit`;
    const limitVal = ast.limit.value[0]?.value ?? '0';
    const offsetVal = ast.limit.value[1]?.value ?? '0';
    const limitText = `Limit: ${limitVal}` + (offsetVal !== '0' && offsetVal !== undefined ? `, Offset: ${offsetVal}` : '');

    nodes.push({
      id: limitId,
      type: 'limitNode',
      data: {
        details: limitText
      },
      position: { x: 0, y: 0 }
    });

    edges.push({
      id: `${prefix}edge_limit`,
      source: lastActiveId,
      target: limitId,
      animated: true
    });

    lastActiveId = limitId;
  }

  // Output (SELECT result)
  const resultId = `${prefix}result`;
  const resultCols = ast.columns === '*' ? [{ name: '*' }] : (
    Array.isArray(ast.columns) ? ast.columns.map((col: any) => {
      const colName = formatExpr(col.expr);
      const colAlias = col.as;
      return {
        name: colName,
        alias: colAlias
      };
    }) : [{ name: '*' }]
  );

  nodes.push({
    id: resultId,
    type: 'resultNode',
    data: {
      title: 'SELECT Output Columns',
      columns: resultCols
    },
    position: { x: 0, y: 0 }
  });

  if (lastActiveId) {
    edges.push({
      id: `${prefix}edge_result`,
      source: lastActiveId,
      target: resultId,
      animated: true
    });
  }

  // Process scalar subqueries in SELECT projection columns
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
            edges.push({
              id: `${prefix}edge_nested_select_link_${colIdx}_${subIdx}`,
              source: subResult.outputId,
              target: resultId,
              animated: true,
              label: 'scalar value',
              style: { strokeDasharray: '4 4' }
            });
          }
        } catch (e) {
          // Gracefully ignore
        }
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
    // Some nodes like resultNode might be tall, let's calculate height based on children or keep standard
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
