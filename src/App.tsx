// @ts-nocheck
import React, { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { 
  ReactFlow, 
  Background, 
  Controls, 
  MiniMap,
  useNodesState, 
  useEdgesState, 
  BackgroundVariant,
  getNodesBounds,
  getViewportForBounds
} from '@xyflow/react';
import { toPng, toSvg, toJpeg } from 'html-to-image';
import { 
  Play, 
  Code, 
  Database, 
  FileText, 
  Terminal, 
  Copy, 
  Check, 
  X, 
  HelpCircle, 
  Layout, 
  Layers, 
  Settings, 
  ChevronRight, 
  Activity,
  Maximize2,
  Minimize2,
  RefreshCw,
  Sparkles,
  Info,
  Sun,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Map,
  Download,
  Image as ImageIcon,
  Loader2,
  ChevronDown,
  WrapText,
  FolderOpen,
  FileDown,
  FileJson,
  FileCode,
  Workflow,
  History
} from 'lucide-react';

import { parseSqlToAst, astToGraph, getLayoutedElements } from './utils/astToGraph';
import { nodeTypes } from './components/CustomNodes';
import { sqlPresets, SQLPreset } from './components/SQLPresets';
import { SqlSnippetsManager } from './components/SqlSnippetsManager';
import { SqlEditor, highlightSqlHtml } from './components/SqlEditor';
import { SettingsModal, getSavedHotkeys } from './components/SettingsModal';
import { VersionHistoryModal } from './components/VersionHistoryModal';
import { saveVersion } from './utils/versionHistory';

export default function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>('light');
  const [sql, setSql] = useState<string>(sqlPresets[0].sql);
  const [dialect, setDialect] = useState<'PostgreSQL' | 'Oracle' | 'Clickhouse'>('PostgreSQL');
  const [direction, setDirection] = useState<'LR' | 'TB'>('LR');
  const [activePresetId, setActivePresetId] = useState<string>(sqlPresets[0].id);
  const [showSortNodes, setShowSortNodes] = useState<boolean>(false);
  const [showLimitNodes, setShowLimitNodes] = useState<boolean>(false);
  const [isWrapSql, setIsWrapSql] = useState<boolean>(false);
  const [isMaximizedSql, setIsMaximizedSql] = useState<boolean>(false);
  const [showSnippetsModal, setShowSnippetsModal] = useState<boolean>(false);
  const [showPresetsDropdown, setShowPresetsDropdown] = useState<boolean>(false);
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
  const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false);
  const [lineageHighlightMode, setLineageHighlightMode] = useState<boolean>(false);
  const [hotkeys, setHotkeys] = useState<Record<string, string>>(() => getSavedHotkeys());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastSavedSqlRef = useRef<string>('');

  // 30-minute auto-save interval into IndexedDB
  useEffect(() => {
    const AUTO_SAVE_MS = 30 * 60 * 1000;
    const timer = setInterval(() => {
      if (sql.trim() && sql !== lastSavedSqlRef.current) {
        saveVersion(sql, dialect, 'Автосохранение (30 мин)', true)
          .then(() => {
            lastSavedSqlRef.current = sql;
          })
          .catch((err) => console.warn('Auto-save error:', err));
      }
    }, AUTO_SAVE_MS);

    return () => clearInterval(timer);
  }, [sql, dialect]);

  const handleOpenFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        if (typeof content === 'string') {
          setSql(content);
          handleVisualize(content, dialect, direction);
        }
      };
      reader.readAsText(file);
    }
    e.target.value = '';
  };

  const handleSaveSqlFile = () => {
    if (!sql.trim()) return;
    const blob = new Blob([sql], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'query.sql';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleInsertSnippet = (snippetSql: string, replaceMode?: boolean) => {
    if (replaceMode || !sql.trim()) {
      setSql(snippetSql);
    } else {
      setSql(prev => prev + '\n\n' + snippetSql);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsMaximizedSql(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const [expandedQueries, setExpandedQueries] = useState<Set<string>>(new Set());

  
  
  const [nodes, setNodes, onNodesChange] = useNodesState<any>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<any>([]);
  const [error, setError] = useState<string | null>(null);
  const [astResult, setAstResult] = useState<any>(null);

  const handleExpandAll = useCallback(() => {
    const getAllIds = (ast: any, prefix = 'main_'): string[] => {
      let ids: string[] = [];
      if (!ast) return ids;
      if (ast.type === 'multi_query') {
        ast.queries.forEach((qAst: any, qIdx: number) => {
          const queryId = `${prefix}query_block_${qIdx}`;
          ids.push(queryId);
          ids.push(...getAllIds(qAst, `${prefix}q${qIdx}_`));
        });
      } else if (ast.type === 'procedure') {
        ast.steps.forEach((step: any, gIdx: number) => {
          if (step.parsedQuery) {
            const queryId = `${prefix}proc_step_group_${gIdx}`;
            ids.push(queryId);
            ids.push(...getAllIds(step.parsedQuery, `${prefix}step_${gIdx}_`));
          }
        });
      }
      return ids;
    };
    
    if (astResult) {
      const allIds = getAllIds(astResult);
      setExpandedQueries(new Set(allIds));
    }
  }, [astResult]);

  const handleToggleExpand = useCallback((queryId: string) => {
    setExpandedQueries(prev => {
      const next = new Set(prev);
      if (next.has(queryId)) {
        next.delete(queryId);
      } else {
        next.add(queryId);
      }
      return next;
    });
  }, []);

  
  const [selectedNode, setSelectedNode] = useState<any | null>(null);

  // DATA LINEAGE HIGHLIGHT CALCULATIONS
  const getLineageElements = useCallback((selectedNodeId: string | null, allNodes: any[], allEdges: any[]) => {
    if (!selectedNodeId) return { nodeIds: null, edgeIds: null };

    const connectedNodes = new Set<string>([selectedNodeId]);
    const connectedEdges = new Set<string>();

    const queueUp = [selectedNodeId];
    const visitedUp = new Set<string>([selectedNodeId]);
    while (queueUp.length > 0) {
      const curr = queueUp.shift()!;
      allEdges.forEach(e => {
        if (e.target === curr) {
          connectedEdges.add(e.id);
          if (!visitedUp.has(e.source)) {
            visitedUp.add(e.source);
            connectedNodes.add(e.source);
            queueUp.push(e.source);
          }
        }
      });
    }

    const queueDown = [selectedNodeId];
    const visitedDown = new Set<string>([selectedNodeId]);
    while (queueDown.length > 0) {
      const curr = queueDown.shift()!;
      allEdges.forEach(e => {
        if (e.source === curr) {
          connectedEdges.add(e.id);
          if (!visitedDown.has(e.target)) {
            visitedDown.add(e.target);
            connectedNodes.add(e.target);
            queueDown.push(e.target);
          }
        }
      });
    }

    return { nodeIds: connectedNodes, edgeIds: connectedEdges };
  }, []);

  const { nodeIds: lineageNodeIds, edgeIds: lineageEdgeIds } = React.useMemo(() => {
    if (!lineageHighlightMode || !selectedNode) return { nodeIds: null, edgeIds: null };
    return getLineageElements(selectedNode.id, nodes, edges);
  }, [lineageHighlightMode, selectedNode, nodes, edges, getLineageElements]);

  const processedNodes = React.useMemo(() => {
    if (!lineageHighlightMode || !lineageNodeIds) return nodes;
    return nodes.map((n) => {
      const isLineage = lineageNodeIds.has(n.id);
      return {
        ...n,
        style: {
          ...(n.style || {}),
          opacity: isLineage ? 1 : 0.2,
          transition: 'opacity 0.2s ease-in-out'
        }
      };
    });
  }, [nodes, lineageHighlightMode, lineageNodeIds]);

  const processedEdges = React.useMemo(() => {
    if (!lineageHighlightMode || !lineageEdgeIds) return edges;
    return edges.map((e) => {
      const isLineage = lineageEdgeIds.has(e.id);
      return {
        ...e,
        animated: isLineage ? true : e.animated,
        style: {
          ...(e.style || {}),
          opacity: isLineage ? 1 : 0.15,
          strokeWidth: isLineage ? 2.5 : 1,
          stroke: isLineage ? '#3b82f6' : (e.style?.stroke || '#94a3b8'),
          transition: 'opacity 0.2s ease-in-out'
        }
      };
    });
  }, [edges, lineageHighlightMode, lineageEdgeIds]);
  const [showAstPreview, setShowAstPreview] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [showLeftPanel, setShowLeftPanel] = useState<boolean>(true);
  const [showMiniMap, setShowMiniMap] = useState<boolean>(true);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [showExportMenu, setShowExportMenu] = useState<boolean>(false);

  const exportGraph = async (format: 'png' | 'svg' | 'jpeg', transparent: boolean = false) => {
    if (!nodes || nodes.length === 0) return;
    setIsExporting(true);
    setShowExportMenu(false);

    try {
      const viewportElement = document.querySelector('.react-flow__viewport') as HTMLElement;
      if (!viewportElement) {
        throw new Error('Graph canvas element not found');
      }

      const nodesBounds = getNodesBounds(nodes);
      const padding = 80;
      const width = Math.max(1200, Math.ceil(nodesBounds.width + padding * 2));
      const height = Math.max(800, Math.ceil(nodesBounds.height + padding * 2));

      const viewport = getViewportForBounds(
        nodesBounds,
        width,
        height,
        0.1,
        4,
        0.1
      );

      const defaultBgColor = theme === 'dark' ? '#172033' : '#263345';
      const bgColor = transparent ? undefined : defaultBgColor;

      const options: any = {
        width: width,
        height: height,
        style: {
          width: `${width}px`,
          height: `${height}px`,
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
        },
        pixelRatio: 2,
        filter: (node: Element) => {
          if (!node) return true;
          const className = typeof node.className === 'string'
            ? node.className
            : (node.className && typeof (node.className as any).baseVal === 'string' ? (node.className as any).baseVal : '');

          if (className) {
            if (
              className.includes('react-flow__handle') ||
              className.includes('react-flow__controls') ||
              className.includes('react-flow__minimap') ||
              className.includes('react-flow__attribution') ||
              className.includes('react-flow__panel')
            ) {
              return false;
            }
          }
          return true;
        }
      };

      if (bgColor) {
        options.backgroundColor = bgColor;
      }

      // Inline styles & attributes for SVG element export rendering
      const cleanupTasks: Array<() => void> = [];

      // 1. Hide scrollbars and arrows in nodes during capture
      const styleEl = document.createElement('style');
      styleEl.id = 'export-hide-scrollbars-style';
      styleEl.innerHTML = `
        ::-webkit-scrollbar {
          display: none !important;
          width: 0 !important;
          height: 0 !important;
          opacity: 0 !important;
        }
        ::-webkit-scrollbar-button {
          display: none !important;
          width: 0 !important;
          height: 0 !important;
          opacity: 0 !important;
        }
        ::-webkit-scrollbar-thumb {
          display: none !important;
        }
        ::-webkit-scrollbar-track {
          display: none !important;
        }
        * {
          scrollbar-width: none !important;
          -ms-overflow-style: none !important;
        }
      `;
      document.head.appendChild(styleEl);
      cleanupTasks.push(() => styleEl.remove());

      // 2. Prepare edge paths (<path class="react-flow__edge-path">)
      const edgePaths = viewportElement.querySelectorAll('.react-flow__edges path, .react-flow__edge-path, .react-flow__edge path');
      edgePaths.forEach((path) => {
        const computed = window.getComputedStyle(path);
        const origStroke = path.getAttribute('stroke');
        const origStrokeWidth = path.getAttribute('stroke-width');
        const origStrokeDasharray = path.getAttribute('stroke-dasharray');
        const origFill = path.getAttribute('fill');

        let stroke = computed.stroke;
        if (!stroke || stroke === 'none' || stroke === 'rgba(0, 0, 0, 0)') {
          stroke = '#94a3b8';
        }
        let strokeWidth = computed.strokeWidth;
        if (!strokeWidth || strokeWidth === '0px') {
          strokeWidth = '1.5px';
        }

        path.setAttribute('stroke', stroke);
        path.setAttribute('stroke-width', strokeWidth.replace('px', ''));
        path.setAttribute('fill', 'none');

        const dashArray = path.style.strokeDasharray || computed.strokeDasharray;
        if (dashArray && dashArray !== 'none') {
          path.setAttribute('stroke-dasharray', dashArray);
        }

        cleanupTasks.push(() => {
          if (origStroke !== null) path.setAttribute('stroke', origStroke); else path.removeAttribute('stroke');
          if (origStrokeWidth !== null) path.setAttribute('stroke-width', origStrokeWidth); else path.removeAttribute('stroke-width');
          if (origStrokeDasharray !== null) path.setAttribute('stroke-dasharray', origStrokeDasharray); else path.removeAttribute('stroke-dasharray');
          if (origFill !== null) path.setAttribute('fill', origFill); else path.removeAttribute('fill');
        });
      });

      // 3. Prepare edge label background rects (<rect class="react-flow__edge-textbg">)
      const edgeRects = viewportElement.querySelectorAll('.react-flow__edge-textbg, .react-flow__edge rect');
      edgeRects.forEach((rect) => {
        const origFill = rect.getAttribute('fill');
        const origFillOpacity = rect.getAttribute('fill-opacity');
        const origStroke = rect.getAttribute('stroke');
        const origRx = rect.getAttribute('rx');
        const origRy = rect.getAttribute('ry');

        rect.setAttribute('fill', '#ffffff');
        rect.setAttribute('fill-opacity', '1');
        rect.setAttribute('stroke', '#cbd5e1');
        rect.setAttribute('stroke-width', '1');
        rect.setAttribute('rx', '4');
        rect.setAttribute('ry', '4');

        cleanupTasks.push(() => {
          if (origFill !== null) rect.setAttribute('fill', origFill); else rect.removeAttribute('fill');
          if (origFillOpacity !== null) rect.setAttribute('fill-opacity', origFillOpacity); else rect.removeAttribute('fill-opacity');
          if (origStroke !== null) rect.setAttribute('stroke', origStroke); else rect.removeAttribute('stroke');
          if (origRx !== null) rect.setAttribute('rx', origRx); else rect.removeAttribute('rx');
          if (origRy !== null) rect.setAttribute('ry', origRy); else rect.removeAttribute('ry');
        });
      });

      // 4. Prepare edge label text (<text class="react-flow__edge-text">)
      const edgeTexts = viewportElement.querySelectorAll('.react-flow__edge-text, .react-flow__edge text');
      edgeTexts.forEach((text) => {
        const origFill = text.getAttribute('fill');
        const origFontSize = text.getAttribute('font-size');
        const origFontWeight = text.getAttribute('font-weight');

        text.setAttribute('fill', '#0f172a');
        text.setAttribute('font-size', '10px');
        text.setAttribute('font-family', 'ui-sans-serif, system-ui, sans-serif');
        text.setAttribute('font-weight', '600');

        cleanupTasks.push(() => {
          if (origFill !== null) text.setAttribute('fill', origFill); else text.removeAttribute('fill');
          if (origFontSize !== null) text.setAttribute('font-size', origFontSize); else text.removeAttribute('font-size');
          if (origFontWeight !== null) text.setAttribute('font-weight', origFontWeight); else text.removeAttribute('font-weight');
        });
      });

      // 5. HTML edge labels if present
      const htmlEdgeLabels = viewportElement.querySelectorAll('.react-flow__edge-label, .react-flow__edge-text-wrapper');
      htmlEdgeLabels.forEach((el) => {
        const htmlEl = el as HTMLElement;
        const origBg = htmlEl.style.backgroundColor;
        const origColor = htmlEl.style.color;

        htmlEl.style.backgroundColor = '#ffffff';
        htmlEl.style.color = '#0f172a';

        cleanupTasks.push(() => {
          htmlEl.style.backgroundColor = origBg;
          htmlEl.style.color = origColor;
        });
      });

      let dataUrl = '';
      try {
        if (format === 'png') {
          dataUrl = await toPng(viewportElement, options);
        } else if (format === 'svg') {
          dataUrl = await toSvg(viewportElement, options);
        } else if (format === 'jpeg') {
          dataUrl = await toJpeg(viewportElement, { ...options, quality: 0.95 });
        }
      } finally {
        cleanupTasks.forEach(cb => cb());
      }

      if (dataUrl) {
        const link = document.createElement('a');
        const suffix = transparent ? '-transparent' : '';
        link.download = `sql-graph-export${suffix}.${format}`;
        link.href = dataUrl;
        link.click();
      }
    } catch (err: any) {
      console.error('Export graph failed:', err);
      setError(`Failed to export graph: ${err.message || String(err)}`);
    } finally {
      setIsExporting(false);
    }
  };

  const exportGraphText = (format: 'json' | 'xml' | 'mermaid' | 'drawio') => {
    if (nodes.length === 0) return;
    setShowExportMenu(false);

    let content = '';
    let filename = '';
    let mimeType = 'text/plain;charset=utf-8';

    if (format === 'json') {
      const exportData = {
        metadata: {
          exportedAt: new Date().toISOString(),
          dialect,
          nodeCount: nodes.length,
          edgeCount: edges.length,
        },
        sql,
        nodes: nodes.map((n: any) => ({
          id: n.id,
          type: n.type,
          label: n.data?.label || n.data?.title || '',
          data: n.data,
          position: n.position
        })),
        edges: edges.map((e: any) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          label: e.label || '',
          type: e.type
        }))
      };
      content = JSON.stringify(exportData, null, 2);
      filename = 'sql-graph-export.json';
      mimeType = 'application/json;charset=utf-8';
    } else if (format === 'xml') {
      const escapeXml = (str: any) => {
        return String(str || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&apos;');
      };

      let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
      xml += `<sqlGraph dialect="${escapeXml(dialect)}" exportedAt="${new Date().toISOString()}">\n`;
      xml += `  <query><![CDATA[${sql}]]></query>\n`;
      xml += `  <nodes count="${nodes.length}">\n`;
      nodes.forEach((n: any) => {
        const title = n.data?.title || n.data?.label || n.id;
        const nodeType = n.data?.type || n.type || 'node';
        xml += `    <node id="${escapeXml(n.id)}" type="${escapeXml(nodeType)}">\n`;
        xml += `      <title>${escapeXml(title)}</title>\n`;
        if (n.data?.tableName) xml += `      <tableName>${escapeXml(n.data.tableName)}</tableName>\n`;
        if (n.data?.condition) xml += `      <condition>${escapeXml(n.data.condition)}</condition>\n`;
        if (n.data?.columns && Array.isArray(n.data.columns)) {
          xml += `      <columns>\n`;
          n.data.columns.forEach((col: any) => {
            const colName = typeof col === 'string' ? col : col.name || String(col);
            xml += `        <column>${escapeXml(colName)}</column>\n`;
          });
          xml += `      </columns>\n`;
        }
        xml += `    </node>\n`;
      });
      xml += `  </nodes>\n`;
      xml += `  <edges count="${edges.length}">\n`;
      edges.forEach((e: any) => {
        xml += `    <edge id="${escapeXml(e.id)}" source="${escapeXml(e.source)}" target="${escapeXml(e.target)}">\n`;
        if (e.label) xml += `      <label>${escapeXml(String(e.label))}</label>\n`;
        xml += `    </edge>\n`;
      });
      xml += `  </edges>\n`;
      xml += `</sqlGraph>`;
      content = xml;
      filename = 'sql-graph-export.xml';
      mimeType = 'application/xml;charset=utf-8';
    } else if (format === 'drawio') {
      const escapeXml = (str: any) => {
        return String(str || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&apos;');
      };

      const escapeHtmlText = (str: any) => {
        return String(str || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
      };

      let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
      xml += `<mxfile host="SQL Flow Visualizer" modified="${new Date().toISOString()}" agent="SQL Visualizer" version="21.0.0" type="device">\n`;
      xml += `  <diagram id="sql-data-flow" name="SQL Data Flow">\n`;
      xml += `    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="827" math="0" shadow="0">\n`;
      xml += `      <root>\n`;
      xml += `        <mxCell id="0" />\n`;
      xml += `        <mxCell id="1" parent="0" />\n`;

      nodes.forEach((n: any, idx: number) => {
        const title = n.data?.title || n.data?.label || n.id;
        const nodeType = n.data?.type || n.type || 'table';
        const posX = Math.round(n.position?.x ?? (idx * 220));
        const posY = Math.round(n.position?.y ?? 100);

        let labelHtml = `<b>${escapeHtmlText(title)}</b>`;
        if (n.data?.tableName) {
          labelHtml += `<br/><font color="#64748b">Table: ${escapeHtmlText(n.data.tableName)}</font>`;
        }
        if (n.data?.condition) {
          labelHtml += `<br/><font color="#3b82f6">ON: ${escapeHtmlText(n.data.condition)}</font>`;
        }
        if (n.data?.columns && Array.isArray(n.data.columns) && n.data.columns.length > 0) {
          const colList = n.data.columns.map((col: any) => typeof col === 'string' ? col : col.name || String(col)).join(', ');
          labelHtml += `<br/><font color="#10b981">Cols: ${escapeHtmlText(colList)}</font>`;
        }

        let fillColor = '#f8fafc';
        let strokeColor = '#94a3b8';
        if (nodeType === 'source' || nodeType === 'table') {
          fillColor = '#eff6ff';
          strokeColor = '#3b82f6';
        } else if (nodeType === 'cte') {
          fillColor = '#faf5ff';
          strokeColor = '#a855f7';
        } else if (nodeType === 'join') {
          fillColor = '#fff7ed';
          strokeColor = '#f97316';
        } else if (nodeType === 'select' || nodeType === 'output') {
          fillColor = '#ecfdf5';
          strokeColor = '#10b981';
        }

        const style = `rounded=1;whiteSpace=wrap;html=1;fillColor=${fillColor};strokeColor=${strokeColor};strokeWidth=2;shadow=1;fontFamily=Helvetica;fontSize=12;align=center;verticalAlign=middle;`;
        const width = 200;
        const height = 90;

        xml += `        <mxCell id="${escapeXml(n.id)}" value="${escapeXml(labelHtml)}" style="${style}" vertex="1" parent="1">\n`;
        xml += `          <mxGeometry x="${posX}" y="${posY}" width="${width}" height="${height}" as="geometry" />\n`;
        xml += `        </mxCell>\n`;
      });

      edges.forEach((e: any) => {
        const edgeLabel = e.label ? escapeXml(String(e.label)) : '';
        const style = `edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#64748b;strokeWidth=2;endArrow=classic;endSize=6;`;

        xml += `        <mxCell id="${escapeXml(e.id)}" value="${edgeLabel}" style="${style}" edge="1" parent="1" source="${escapeXml(e.source)}" target="${escapeXml(e.target)}">\n`;
        xml += `          <mxGeometry relative="1" as="geometry" />\n`;
        xml += `        </mxCell>\n`;
      });

      xml += `      </root>\n`;
      xml += `    </mxGraphModel>\n`;
      xml += `  </diagram>\n`;
      xml += `</mxfile>`;

      content = xml;
      filename = 'sql-graph-export.drawio.xml';
      mimeType = 'application/xml;charset=utf-8';
    } else if (format === 'mermaid') {
      const dir = direction === 'LR' ? 'LR' : 'TD';
      const lines: string[] = [`graph ${dir}`];

      const sanitize = (text: any) => {
        return String(text || '')
          .replace(/"/g, "'")
          .replace(/[\r\n]+/g, ' ')
          .replace(/[<>]/g, '');
      };

      nodes.forEach((node: any) => {
        const data = node.data || {};
        const label = data.label || node.id;
        const title = data.title || label;
        
        let detail = '';
        if (data.tableName) detail = `Table: ${data.tableName}`;
        else if (data.alias) detail = `Alias: ${data.alias}`;
        else if (data.condition) detail = `Cond: ${data.condition}`;

        const display = detail ? `${title} [${detail}]` : title;
        const cleanId = node.id.replace(/[^a-zA-Z0-9_]/g, '_');
        lines.push(`  ${cleanId}["${sanitize(display)}"]`);
      });

      edges.forEach((edge: any) => {
        const source = edge.source.replace(/[^a-zA-Z0-9_]/g, '_');
        const target = edge.target.replace(/[^a-zA-Z0-9_]/g, '_');
        const label = edge.label ? `|"${sanitize(String(edge.label))}"|` : '';
        lines.push(`  ${source} -->${label} ${target}`);
      });

      content = lines.join('\n');
      filename = 'sql-graph-export.mmd';
      mimeType = 'text/plain;charset=utf-8';
    }

    if (content) {
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    }
  };

  // Sync document.documentElement with theme
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  // Global hotkeys listener
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const parts: string[] = [];
      if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');

      let keyName = e.key.toUpperCase();
      if (e.code && e.code.startsWith('Key')) {
        keyName = e.code.slice(3).toUpperCase();
      } else if (e.code && e.code.startsWith('Digit')) {
        keyName = e.code.slice(5);
      } else if (e.code === 'Space' || e.key === ' ') {
        keyName = 'Space';
      } else if (e.code === 'Enter' || e.key === 'Enter') {
        keyName = 'Enter';
      } else if (e.code === 'Escape' || e.key === 'Escape') {
        keyName = 'Esc';
      }

      const combo = parts.length > 0 ? `${parts.join('+')}+${keyName}` : keyName;

      if (combo === (hotkeys.visualize || 'Ctrl+Enter')) {
        e.preventDefault();
        e.stopPropagation();
        handleVisualize();
      } else if (combo === (hotkeys.saveFile || 'Ctrl+S')) {
        e.preventDefault();
        e.stopPropagation();
        handleSaveSqlFile();
      } else if (combo === (hotkeys.openFile || 'Ctrl+O')) {
        e.preventDefault();
        e.stopPropagation();
        fileInputRef.current?.click();
      } else if (combo === (hotkeys.copySql || 'Ctrl+Shift+C')) {
        e.preventDefault();
        e.stopPropagation();
        handleCopySql();
      } else if (combo === (hotkeys.toggleWrap || 'Alt+W')) {
        e.preventDefault();
        e.stopPropagation();
        setIsWrapSql((prev) => !prev);
      } else if (combo === (hotkeys.openSnippets || 'Ctrl+K')) {
        e.preventDefault();
        e.stopPropagation();
        setShowSnippetsModal(true);
      } else if (combo === (hotkeys.toggleMaximized || 'Alt+F')) {
        e.preventDefault();
        e.stopPropagation();
        setIsMaximizedSql((prev) => !prev);
      } else if (combo === (hotkeys.toggleTheme || 'Alt+T')) {
        e.preventDefault();
        e.stopPropagation();
        setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
      } else if (combo === (hotkeys.toggleMiniMap || 'Alt+M')) {
        e.preventDefault();
        e.stopPropagation();
        setShowMiniMap((prev) => !prev);
      } else if (combo === (hotkeys.exportGraph || 'Ctrl+E')) {
        e.preventDefault();
        e.stopPropagation();
        setShowExportMenu((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown, true);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown, true);
  }, [hotkeys, sql, dialect, direction]);

  // Initial load
  useEffect(() => {
    handleVisualize(sqlPresets[0].sql, 'PostgreSQL', 'LR', true, true);
  }, []);

  const handleVisualize = (
    queryText = sql,
    currentDialect = dialect,
    currentDir = direction
  ) => {
    if (!queryText.trim()) {
      setError(null);
      setAstResult(null);
      setNodes([]);
      setEdges([]);
      setSelectedNode(null);
      return;
    }

    const result = parseSqlToAst(queryText, currentDialect);
    if (result.error) {
      setError(result.error);
      setAstResult(null);
      return;
    }

    setError(null);
    setAstResult(result.ast);
  };

    useEffect(() => {
    if (astResult) {
      try {
        const graphData = astToGraph(
          astResult,
          'main_',
          dialect,
          {},
          {
            showSort: showSortNodes,
            showLimit: showLimitNodes,
            expandedQueries,
            onToggleExpand: handleToggleExpand
          }
        );
        const layouted = getLayoutedElements(graphData.nodes, graphData.edges, direction);
        setNodes(layouted.nodes);
        setEdges(layouted.edges);
        
        // Select the result node as default if available and no selected node
        if (!selectedNode) {
          const resultNode = layouted.nodes.find(n => n.id.endsWith('result'));
          if (resultNode) {
            setSelectedNode(resultNode);
          } else if (layouted.nodes.length > 0) {
            setSelectedNode(layouted.nodes[0]);
          }
        }
      } catch (err: any) {
        setError(`Layout / AST Mapping error: ${err.message || String(err)}`);
      }
    }
  }, [astResult, dialect, direction, showSortNodes, showLimitNodes, expandedQueries, handleToggleExpand, setNodes, setEdges]);

  const handlePresetChange = (presetId: string) => {
    const preset = sqlPresets.find(p => p.id === presetId);
    if (preset) {
      setActivePresetId(presetId);
      setSql(preset.sql);
      setDialect(preset.dialect);
      handleVisualize(preset.sql, preset.dialect, direction);
    }
  };

  const handleDialectChange = (newDialect: 'PostgreSQL' | 'Oracle' | 'Clickhouse') => {
    setDialect(newDialect);
    handleVisualize(sql, newDialect, direction);
  };

  const handleSortToggle = () => {
    const newVal = !showSortNodes;
    setShowSortNodes(newVal);
    handleVisualize(sql, dialect, direction, newVal, showLimitNodes);
  };

  const handleLimitToggle = () => {
    const newVal = !showLimitNodes;
    setShowLimitNodes(newVal);
    handleVisualize(sql, dialect, direction, showSortNodes, newVal);
  };

  const handleDirectionChange = (newDir: 'LR' | 'TB') => {
    setDirection(newDir);
    if (nodes.length > 0) {
      const layouted = getLayoutedElements(nodes, edges, newDir);
      setNodes(layouted.nodes);
      setEdges(layouted.edges);
    }
  };

  const handleCopySql = () => {
    navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleNodeClick = (_event: any, node: any) => {
    setSelectedNode(node);
  };

  return (
    <div className={`flex flex-col h-screen ${theme === 'dark' ? 'dark bg-slate-850 text-slate-200' : 'bg-slate-200 text-slate-800'} font-sans select-none overflow-hidden`}>
      
      {/* CORE WORKSPACE */}
      <main className="flex flex-1 overflow-hidden relative">
        
        {/* LEFT PANEL: INPUT & CONFIG (30% WIDTH) */}
        {showLeftPanel && (
        <aside id="control-panel" className={`w-[30%] min-w-[340px] max-w-[480px] border-r flex flex-col p-4 space-y-4 shrink-0 transition-colors ${
          theme === 'dark' ? 'bg-slate-750/50 border-slate-600' : 'bg-slate-300/80 border-slate-400/60'
        }`}>
          
          {/* CODE EDITOR WORKSPACE */}
          <div className="flex-1 flex flex-col space-y-1.5 min-h-0 relative">
            <div className="flex items-center justify-between">
              <label className={`text-[10px] font-bold uppercase tracking-widest ${theme === 'dark' ? 'text-slate-200' : 'text-slate-700'}`}>SQL Query</label>
              <div className="flex items-center gap-1.5 relative">
                {/* HIDDEN FILE INPUT FOR OPEN SQL FILE */}
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  accept=".sql,.txt,text/plain" 
                  onChange={handleOpenFile} 
                  className="hidden" 
                />

                {/* OPEN FILE BUTTON */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-semibold transition-colors ${
                    theme === 'dark' 
                      ? 'text-amber-300 hover:text-amber-100 bg-amber-950/40 hover:bg-amber-900/60 border border-amber-500/30' 
                      : 'text-amber-700 hover:text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200 shadow-2xs'
                  }`}
                  title="Открыть SQL файл с диска"
                >
                  <FolderOpen className="w-3 h-3 text-amber-500" />
                  <span>Открыть</span>
                </button>

                {/* SAVE FILE BUTTON */}
                <button
                  onClick={handleSaveSqlFile}
                  className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-semibold transition-colors ${
                    theme === 'dark' 
                      ? 'text-emerald-300 hover:text-emerald-100 bg-emerald-950/40 hover:bg-emerald-900/60 border border-emerald-500/30' 
                      : 'text-emerald-700 hover:text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 shadow-2xs'
                  }`}
                  title="Сохранить SQL в .sql файл"
                >
                  <FileDown className="w-3 h-3 text-emerald-500" />
                  <span>Сохранить</span>
                </button>

                <button
                  onClick={() => setShowSnippetsModal(true)}
                  className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-semibold transition-colors ${
                    theme === 'dark' 
                      ? 'text-blue-300 hover:text-blue-100 bg-blue-900/40 hover:bg-blue-800/60 border border-blue-500/40' 
                      : 'text-blue-700 hover:text-blue-900 bg-blue-50 hover:bg-blue-100 border border-blue-200 shadow-2xs'
                  }`}
                  title="Конструктор и библиотека сниппетов SQL"
                >
                  <Layers className="w-3 h-3 text-blue-500" />
                  <span>Сниппеты</span>
                </button>

                <button
                  onClick={() => setIsMaximizedSql(true)}
                  className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-semibold transition-colors ${
                    theme === 'dark' 
                      ? 'text-slate-300 hover:text-slate-100 bg-slate-700/60 hover:bg-slate-700 border border-slate-600' 
                      : 'text-slate-700 hover:text-slate-900 bg-slate-200/80 hover:bg-slate-300 border border-slate-300'
                  }`}
                  title="Развернуть на весь экран"
                >
                  <Maximize2 className="w-3 h-3" />
                  <span>Развернуть</span>
                </button>
              </div>
            </div>

            {/* SYNTAX HIGHLIGHTED SQL EDITOR */}
            <SqlEditor
              value={sql}
              onChange={setSql}
              isWrapSql={isWrapSql}
              theme={theme}
            />

            {/* SYNTAX ERROR LOG PANEL */}
            {error && (
              <div className={`p-3 border rounded-md shadow-lg absolute bottom-1.5 left-1.5 right-1.5 max-h-40 overflow-y-auto backdrop-blur-md transition-all ${
                theme === 'dark' ? 'bg-red-950/80 border-red-500/30 text-slate-200' : 'bg-red-50/95 border-red-200 text-red-900 shadow-md'
              }`}>
                <div className="flex items-start gap-2">
                  <X className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <div className="text-xs">
                    <div className="font-bold text-red-600 dark:text-red-300">Parser Syntax Error</div>
                    <div className="font-mono text-[10px] mt-1 break-words leading-normal select-text text-red-700 dark:text-red-400/95">
                      {error}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* VISUALIZE ACTION BAR */}
          <div className="flex items-center gap-1.5 relative">
            {/* PRESETS BUTTON & POPOVER */}
            <div className="relative">
              <button
                onClick={() => setShowPresetsDropdown(!showPresetsDropdown)}
                className={`text-[10px] px-2 py-1.5 rounded-md border transition-colors shrink-0 font-medium ${
                  showPresetsDropdown
                    ? (theme === 'dark' ? 'bg-slate-700 border-slate-600 text-slate-200' : 'bg-slate-200 border-slate-300 text-slate-800')
                    : (theme === 'dark' 
                        ? 'bg-slate-800/60 hover:bg-slate-700/60 border-slate-700/80 text-slate-400 hover:text-slate-300' 
                        : 'bg-slate-200/50 hover:bg-slate-200 border-slate-300/80 text-slate-500 hover:text-slate-700')
                }`}
                title="Готовые шаблоны и примеры SQL"
              >
                Пресеты
              </button>

              {/* PRESETS DROPDOWN POPOVER */}
              {showPresetsDropdown && (
                <>
                  <div 
                    className="fixed inset-0 z-30" 
                    onClick={() => setShowPresetsDropdown(false)} 
                  />
                  <div className={`absolute bottom-full mb-1.5 left-0 z-40 rounded-lg border shadow-xl p-2 w-72 backdrop-blur-md animate-in fade-in duration-150 ${
                    theme === 'dark' ? 'bg-slate-800/95 border-slate-600 text-slate-200' : 'bg-white/95 border-slate-300 text-slate-800'
                  }`}>
                    <div className="flex items-center justify-between pb-1.5 border-b border-slate-600/40 mb-1.5">
                      <span className="text-[10px] uppercase font-bold text-slate-400">Готовые SQL пресеты</span>
                      <button 
                        onClick={() => setShowPresetsDropdown(false)}
                        className="p-0.5 rounded hover:bg-slate-700/50 text-slate-400 hover:text-slate-200"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="space-y-1 max-h-60 overflow-y-auto pr-1">
                      {sqlPresets.map((preset) => (
                        <button
                          key={preset.id}
                          onClick={() => {
                            handlePresetChange(preset.id);
                            setShowPresetsDropdown(false);
                          }}
                          className={`w-full text-left p-1.5 rounded transition-all text-xs flex flex-col gap-0.5 border ${
                            activePresetId === preset.id
                              ? theme === 'dark' ? 'bg-amber-950/40 border-amber-500/50 text-amber-200 font-semibold' : 'bg-amber-50 border-amber-300 text-amber-900 font-semibold'
                              : theme === 'dark' ? 'hover:bg-slate-700/60 border-transparent text-slate-300' : 'hover:bg-slate-100 border-transparent text-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="truncate pr-1 font-medium">{preset.title}</span>
                            <span className="text-[9px] px-1 py-0.2 rounded bg-slate-700/40 text-slate-300 font-mono shrink-0">
                              {preset.dialect}
                            </span>
                          </div>
                          {preset.description && (
                            <span className="text-[10px] text-slate-400 line-clamp-1 leading-tight font-normal">
                              {preset.description}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* WRAP TEXT BUTTON */}
            <button
              onClick={() => setIsWrapSql(!isWrapSql)}
              className={`flex items-center gap-1 text-[10px] px-1.5 py-1.5 rounded-md transition-colors shrink-0 ${
                isWrapSql
                  ? 'bg-blue-600/30 text-blue-300 border border-blue-500/40 font-medium'
                  : theme === 'dark' ? 'text-slate-400 hover:text-slate-200 border border-transparent' : 'text-slate-600 hover:text-slate-900 border border-transparent'
              }`}
              title="Перенос строки"
            >
              <WrapText className="w-3 h-3" />
              <span>Перенос</span>
            </button>

            {/* COPY SQL BUTTON */}
            <button
              onClick={handleCopySql}
              className={`flex items-center gap-1 text-[10px] px-1.5 py-1.5 transition-colors shrink-0 ${theme === 'dark' ? 'text-slate-300 hover:text-slate-100' : 'text-slate-600 hover:text-slate-900'}`}
              title="Copy SQL"
            >
              {copied ? (
                <>
                  <Check className="w-3 h-3 text-emerald-500" />
                  <span className="text-emerald-500 font-medium">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  <span>Copy</span>
                </>
              )}
            </button>

            <button
              onClick={() => handleVisualize()}
              className="flex-1 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-md shadow-md shadow-blue-900/20 active:scale-[0.98] transition-transform flex items-center justify-center gap-1.5"
            >
              <Play className="w-3 h-3 fill-white" />
              <span>Visualize</span>
            </button>
          </div>
        </aside>
        )}

        {/* RIGHT PANEL: INTERACTIVE CANVAS (70% WIDTH) */}
        <section className={`flex-1 flex flex-col h-full relative transition-colors ${
          theme === 'dark' ? 'bg-slate-850 text-slate-200' : 'bg-slate-200 text-slate-800'
        }`}>
          
          {/* CANVAS CONTROLS HEADER */}
          <div className={`flex items-center justify-between px-4 h-11 border-b z-10 select-none transition-colors ${
            theme === 'dark' ? 'bg-slate-750 border-slate-600 text-slate-200' : 'bg-slate-300/80 border-slate-400/60 text-slate-800'
          }`}>
            <div className="flex items-center gap-3 text-xs">
              <div className="flex items-center gap-1.5 font-medium">
                <Layout className="w-3.5 h-3.5 text-blue-500" />
                <span className={theme === 'dark' ? 'text-slate-100' : 'text-slate-800 font-semibold'}>Layout:</span>
              </div>
              <div className={`flex p-0.5 rounded-md border ${
                theme === 'dark' ? 'bg-slate-850 border-slate-600' : 'bg-slate-100 border-slate-300 shadow-sm'
              }`}>
                <button
                  onClick={() => handleDirectionChange('LR')}
                  className={`px-2.5 py-1 rounded text-[10px] font-mono transition-all ${
                    direction === 'LR' 
                      ? 'bg-blue-600 text-white font-bold' 
                      : theme === 'dark' ? 'text-slate-300 hover:text-slate-100' : 'text-slate-700 hover:text-slate-900'
                  }`}
                >
                  Left-Right
                </button>
                <button
                  onClick={() => handleDirectionChange('TB')}
                  className={`px-2.5 py-1 rounded text-[10px] font-mono transition-all ${
                    direction === 'TB' 
                      ? 'bg-blue-600 text-white font-bold' 
                      : theme === 'dark' ? 'text-slate-300 hover:text-slate-100' : 'text-slate-700 hover:text-slate-900'
                  }`}
                >
                  Top-Bottom
                </button>
              </div>

              <div className={`h-4 w-px ${theme === 'dark' ? 'bg-slate-600' : 'bg-slate-300'}`} />

              <div className={`flex p-0.5 rounded-md border ${
                theme === 'dark' ? 'bg-slate-850 border-slate-600' : 'bg-slate-100 border-slate-300 shadow-sm'
              }`}>
                <button
                  onClick={handleSortToggle}
                  className={`px-2.5 py-1 rounded text-[10px] font-mono transition-all ${
                    showSortNodes 
                      ? 'bg-emerald-600 text-white font-bold' 
                      : theme === 'dark' ? 'text-slate-300 hover:text-slate-100' : 'text-slate-700 hover:text-slate-900'
                  }`}
                  title="Toggle visualization of ORDER BY (Sort) nodes"
                >
                  Sort Nodes
                </button>
                <button
                  onClick={handleLimitToggle}
                  className={`px-2.5 py-1 rounded text-[10px] font-mono transition-all ${
                    showLimitNodes 
                      ? 'bg-emerald-600 text-white font-bold' 
                      : theme === 'dark' ? 'text-slate-300 hover:text-slate-100' : 'text-slate-700 hover:text-slate-900'
                  }`}
                  title="Toggle visualization of LIMIT / OFFSET nodes"
                >
                  Limit Nodes
                </button>
                <button
                  onClick={() => setLineageHighlightMode(!lineageHighlightMode)}
                  className={`px-2.5 py-1 rounded text-[10px] font-mono transition-all flex items-center gap-1 ${
                    lineageHighlightMode 
                      ? 'bg-purple-600 text-white font-bold shadow-xs' 
                      : theme === 'dark' ? 'text-slate-300 hover:text-slate-100' : 'text-slate-700 hover:text-slate-900'
                  }`}
                  title="Подсветка взаимосвязей (Data Lineage) выделенного узла"
                >
                  <Workflow className="w-3 h-3" />
                  <span>Lineage Focus</span>
                </button>
              </div>
            </div>

            {/* AST Preview toggle and Info labels */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowLeftPanel(!showLeftPanel)}
                className={`p-1.5 rounded-lg border transition-all ${
                  theme === 'dark' 
                    ? 'bg-slate-850 border-slate-600 text-slate-200 hover:text-slate-100' 
                    : 'bg-slate-100 border-slate-300 text-slate-700 hover:text-slate-900 shadow-sm'
                }`}
                title={showLeftPanel ? 'Hide Editor Panel' : 'Show Editor Panel'}
              >
                {showLeftPanel ? <PanelLeftClose className="w-3.5 h-3.5" /> : <PanelLeftOpen className="w-3.5 h-3.5" />}
              </button>

              <button
                onClick={() => setShowMiniMap(!showMiniMap)}
                className={`p-1.5 rounded-lg border transition-all ${
                  !showMiniMap
                    ? (theme === 'dark' ? 'bg-slate-750 border-slate-500 text-slate-200' : 'bg-slate-200 border-slate-300 text-slate-700')
                    : (theme === 'dark' ? 'bg-slate-850 border-slate-600 text-slate-200 hover:text-slate-100' : 'bg-slate-100 border-slate-300 text-slate-700 hover:text-slate-900 shadow-sm')
                }`}
                title={showMiniMap ? 'Hide MiniMap' : 'Show MiniMap'}
              >
                <Map className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className={`p-1.5 rounded-lg border transition-all ${
                  theme === 'dark' 
                    ? 'bg-slate-850 border-slate-600 text-slate-200 hover:text-slate-100' 
                    : 'bg-slate-100 border-slate-300 text-slate-700 hover:text-slate-900 shadow-sm'
                }`}
                title={theme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
              >
                {theme === 'dark' ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5 text-blue-500" />}
              </button>

              <button
                onClick={() => setShowSettingsModal(true)}
                className={`p-1.5 rounded-lg border transition-all ${
                  theme === 'dark' 
                    ? 'bg-slate-850 border-slate-600 text-slate-200 hover:text-slate-100' 
                    : 'bg-slate-100 border-slate-300 text-slate-700 hover:text-slate-900 shadow-sm'
                }`}
                title="Настройки и горячие клавиши"
              >
                <Settings className="w-3.5 h-3.5" />
              </button>

              {/* EXPORT GRAPH DROPDOWN */}
              <div className="relative">
                <button
                  onClick={() => setShowExportMenu(!showExportMenu)}
                  disabled={isExporting || nodes.length === 0}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition-all bg-blue-600 hover:bg-blue-500 border-blue-500 text-white shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Export entire graph as image/vector scheme"
                >
                  {isExporting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                  <span>Export</span>
                  <ChevronDown className="w-3 h-3 opacity-80" />
                </button>

                {showExportMenu && (
                  <>
                    <div 
                      className="fixed inset-0 z-20" 
                      onClick={() => setShowExportMenu(false)} 
                    />
                    <div className={`absolute right-0 mt-1 w-52 rounded-lg border shadow-xl z-30 overflow-hidden py-1 text-xs ${
                      theme === 'dark' ? 'bg-slate-750 border-slate-600 text-slate-100' : 'bg-slate-100 border-slate-300 text-slate-800'
                    }`}>
                      <button
                        onClick={() => exportGraph('png', false)}
                        className={`w-full px-3 py-2 text-left flex items-center justify-between transition-colors ${
                          theme === 'dark' ? 'hover:bg-blue-600/30' : 'hover:bg-blue-50'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <ImageIcon className="w-3.5 h-3.5 text-blue-500" />
                          <span className="font-semibold">PNG Image</span>
                        </div>
                        <span className="text-[10px] opacity-70 font-mono">With Bg</span>
                      </button>

                      <button
                        onClick={() => exportGraph('png', true)}
                        className={`w-full px-3 py-2 text-left flex items-center justify-between transition-colors border-t ${
                          theme === 'dark' ? 'hover:bg-blue-600/30 border-slate-600/30' : 'hover:bg-blue-50 border-slate-200'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <ImageIcon className="w-3.5 h-3.5 text-cyan-500" />
                          <span className="font-semibold">PNG Transparent</span>
                        </div>
                        <span className={`text-[10px] font-mono ${theme === 'dark' ? 'text-cyan-300' : 'text-cyan-600'}`}>No Bg</span>
                      </button>
                      
                      <button
                        onClick={() => exportGraph('svg', false)}
                        className={`w-full px-3 py-2 text-left flex items-center justify-between transition-colors border-t ${
                          theme === 'dark' ? 'hover:bg-blue-600/30 border-slate-600/50' : 'hover:bg-blue-50 border-slate-200'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <Code className="w-3.5 h-3.5 text-emerald-500" />
                          <span className="font-semibold">SVG Vector</span>
                        </div>
                        <span className="text-[10px] opacity-70 font-mono">With Bg</span>
                      </button>

                      <button
                        onClick={() => exportGraph('svg', true)}
                        className={`w-full px-3 py-2 text-left flex items-center justify-between transition-colors border-t ${
                          theme === 'dark' ? 'hover:bg-blue-600/30 border-slate-600/30' : 'hover:bg-blue-50 border-slate-200'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <Code className="w-3.5 h-3.5 text-teal-500" />
                          <span className="font-semibold">SVG Transparent</span>
                        </div>
                        <span className={`text-[10px] font-mono ${theme === 'dark' ? 'text-teal-300' : 'text-teal-600'}`}>No Bg</span>
                      </button>

                      <button
                        onClick={() => exportGraph('jpeg', false)}
                        className={`w-full px-3 py-2 text-left flex items-center justify-between transition-colors border-t ${
                          theme === 'dark' ? 'hover:bg-blue-600/30 border-slate-600/50' : 'hover:bg-blue-50 border-slate-200'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <ImageIcon className="w-3.5 h-3.5 text-amber-500" />
                          <span className="font-semibold">JPEG Image</span>
                        </div>
                        <span className="text-[10px] opacity-70 font-mono">With Bg</span>
                      </button>

                      <div className="my-1 border-t border-slate-600/30 dark:border-slate-600/50" />

                      <button
                        onClick={() => exportGraphText('json')}
                        className={`w-full px-3 py-2 text-left flex items-center justify-between transition-colors ${
                          theme === 'dark' ? 'hover:bg-blue-600/30' : 'hover:bg-blue-50'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <FileJson className="w-3.5 h-3.5 text-amber-400" />
                          <span className="font-semibold">JSON Data</span>
                        </div>
                        <span className="text-[10px] opacity-70 font-mono">.json</span>
                      </button>

                      <button
                        onClick={() => exportGraphText('xml')}
                        className={`w-full px-3 py-2 text-left flex items-center justify-between transition-colors border-t ${
                          theme === 'dark' ? 'hover:bg-blue-600/30 border-slate-600/30' : 'hover:bg-blue-50 border-slate-200'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <FileCode className="w-3.5 h-3.5 text-purple-400" />
                          <span className="font-semibold">XML Schema</span>
                        </div>
                        <span className="text-[10px] opacity-70 font-mono">.xml</span>
                      </button>

                      <button
                        onClick={() => exportGraphText('mermaid')}
                        className={`w-full px-3 py-2 text-left flex items-center justify-between transition-colors border-t ${
                          theme === 'dark' ? 'hover:bg-blue-600/30 border-slate-600/30' : 'hover:bg-blue-50 border-slate-200'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <Workflow className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="font-semibold">Mermaid Diagram</span>
                        </div>
                        <span className="text-[10px] opacity-70 font-mono">.mmd</span>
                      </button>

                      <button
                        onClick={() => exportGraphText('drawio')}
                        className={`w-full px-3 py-2 text-left flex items-center justify-between transition-colors border-t ${
                          theme === 'dark' ? 'hover:bg-blue-600/30 border-slate-600/30' : 'hover:bg-blue-50 border-slate-200'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <Workflow className="w-3.5 h-3.5 text-cyan-400" />
                          <span className="font-semibold">Draw.io Diagram</span>
                        </div>
                        <span className="text-[10px] opacity-70 font-mono">.drawio.xml</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
                            

            </div>
          </div>

          {/* REACT FLOW CANVAS CONTAINER */}
          <div className={`flex-1 w-full relative min-h-0 ${theme === 'dark' ? 'bg-slate-850' : 'bg-slate-200'}`}>
            {/* Grid Pattern Background styled specifically to match the design style */}
            <div className={`absolute inset-0 pointer-events-none opacity-[0.07] dark:opacity-10`} style={{ backgroundImage: 'radial-gradient(#64748b 1px, transparent 1px)', backgroundSize: '24px 24px' }}></div>
            
            {nodes.length > 0 ? (
              <ReactFlow
                nodes={processedNodes}
                edges={processedEdges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={handleNodeClick}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 0.2 }}
                minZoom={0.2}
                maxZoom={2}
                className="sql-flow-canvas"
                onlyRenderVisibleElements={true}
                proOptions={{ hideAttribution: true }}
              >
                <Background 
                  color={theme === 'dark' ? "#64748b" : "#94a3b8"} 
                  gap={24} 
                  size={1} 
                  variant={BackgroundVariant.Dots} 
                  className="opacity-15"
                />
                <Controls className={`!shadow-md ${
                  theme === 'dark' 
                    ? '!bg-slate-750 !border-slate-600 !text-slate-100 [&_button]:!bg-slate-750 [&_button]:!border-slate-600 [&_button]:!text-slate-200 [&_button:hover]:!text-slate-200' 
                    : '!bg-slate-100 !border-slate-300 !text-slate-700 [&_button]:!bg-slate-100 [&_button]:!border-slate-300 [&_button]:!text-slate-700 [&_button:hover]:!bg-slate-200'
                }`} />
                {showMiniMap && (
                  <MiniMap 
                    className={`!shadow-lg !rounded-lg border ${
                      theme === 'dark' ? '!bg-slate-750 !border-slate-600' : '!bg-slate-100 !border-slate-300'
                    }`}
                    nodeColor={(n: any) => {
                      if (n.type === 'tableNode') return theme === 'dark' ? '#3b82f6' : '#2563eb';
                      if (n.type === 'resultNode') return theme === 'dark' ? '#10b981' : '#059669';
                      if (n.type === 'filterNode') return theme === 'dark' ? '#f59e0b' : '#d97706';
                      return theme === 'dark' ? '#475569' : '#94a3b8';
                    }}
                    maskColor={theme === 'dark' ? 'rgba(15, 23, 42, 0.7)' : 'rgba(226, 232, 240, 0.6)'}
                  />
                )}
              </ReactFlow>
            ) : (
              <div className={`absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-transparent ${theme === 'dark' ? 'text-slate-300' : 'text-slate-600'}`}>
                <div className={`w-12 h-12 rounded-full border flex items-center justify-center mb-3 ${theme === 'dark' ? 'border-slate-600 text-slate-300' : 'border-slate-300 text-slate-600 bg-slate-100 shadow-sm'}`}>
                  <Database className="w-6 h-6" />
                </div>
                <div className={`text-sm font-semibold mb-1 ${theme === 'dark' ? 'text-slate-200' : 'text-slate-800'}`}>Песочница пуста</div>
                <div className={`text-xs max-w-xs leading-normal ${theme === 'dark' ? 'text-slate-300' : 'text-slate-600'}`}>
                  Введите ваш SQL-запрос в редактор слева и нажмите <strong className={theme === 'dark' ? 'text-slate-200' : 'text-slate-800'}>Visualize Data Flow</strong> для построения интерактивного логического графа.
                </div>
              </div>
            )}

            {/* RAW AST OVERLAY SIDEBAR */}
            {showAstPreview && (
              <div className={`absolute right-0 top-0 bottom-0 w-80 border-l z-20 flex flex-col shadow-2xl backdrop-blur-md animate-in slide-in-from-right duration-200 ${
                theme === 'dark' ? 'bg-[#172033]/95 border-slate-600 text-slate-200' : 'bg-slate-100/95 border-slate-300 text-slate-800'
              }`}>
                <div className={`flex items-center justify-between p-3 border-b ${
                  theme === 'dark' ? 'border-slate-600 bg-slate-850/40' : 'border-slate-200 bg-slate-50'
                }`}>
                  <div className="flex items-center gap-1.5 text-xs font-mono text-amber-500 font-bold">
                    <Terminal className="w-3.5 h-3.5" />
                    <span>Parsed AST Tree</span>
                  </div>
                  <button
                    onClick={() => setShowAstPreview(false)}
                    className={`p-1 rounded transition-colors ${
                      theme === 'dark' ? 'hover:bg-slate-600 text-slate-200' : 'hover:bg-slate-200 text-slate-700'
                    }`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex-1 p-3 overflow-y-auto text-[11px] font-mono select-text">
                  {astResult ? (
                    <pre className={`p-3 rounded-lg border overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-full ${
                      theme === 'dark' ? 'bg-[#172033] border-slate-750 text-slate-100' : 'bg-slate-50 border-slate-200 text-slate-800'
                    }`}>
                      {JSON.stringify(astResult, null, 2)}
                    </pre>
                  ) : (
                    <div className="text-slate-400 italic text-center mt-10">
                      No AST available. Parse a valid query to inspect its syntax tree.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* FLOATING SELECTED NODE DRAWER / BOTTOM DETAILS BAR */}
          {selectedNode && (
            <div className={`border-t p-4 shrink-0 shadow-2xl animate-in slide-in-from-bottom duration-200 ${
              theme === 'dark' ? 'bg-slate-750 border-slate-600 text-slate-200' : 'bg-white border-slate-300 text-slate-800'
            }`}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`w-2.5 h-2.5 rounded-full ${
                      selectedNode.type === 'tableNode' ? 'bg-blue-500' :
                      selectedNode.type === 'joinNode' ? 'bg-purple-500' :
                      selectedNode.type === 'filterNode' ? 'bg-amber-500' :
                      selectedNode.type === 'groupByNode' || selectedNode.type === 'havingNode' ? 'bg-pink-500' :
                      selectedNode.type === 'resultNode' ? 'bg-emerald-500' : 'bg-cyan-500'
                    }`} />
                    <span className={`text-[10px] tracking-wider uppercase font-mono ${theme === 'dark' ? 'text-slate-300' : 'text-slate-600'}`}>
                      Logical Execution Node: {selectedNode.type}
                    </span>
                    <span className={`text-[10px] font-mono ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>ID: {selectedNode.id}</span>
                  </div>
                  
                  <h4 className={`text-sm font-bold flex items-center gap-2 ${theme === 'dark' ? 'text-slate-100' : 'text-slate-900'}`}>
                    {selectedNode.data.title || selectedNode.data.label || 'Details'}
                  </h4>

                  {/* Dynamic description of execution */}
                  <div className="mt-2 text-xs leading-relaxed font-mono select-text">
                    {selectedNode.type === 'tableNode' && (
                      <div className="flex flex-col gap-1">
                        <div>
                          <span className={theme === 'dark' ? 'text-slate-300' : 'text-slate-600'}>Source relation:</span>{' '}
                          <span className={theme === 'dark' ? 'text-blue-300 font-bold' : 'text-blue-600 font-bold'}>{selectedNode.data.label}</span>
                          {selectedNode.data.alias && (
                            <> as <span className={theme === 'dark' ? 'text-blue-400 font-semibold' : 'text-blue-500 font-semibold'}>"{selectedNode.data.alias}"</span></>
                          )}
                        </div>
                        
                      </div>
                    )}

                    {selectedNode.type === 'joinNode' && (
                      <div className="space-y-1">
                        <div>
                          <span className={theme === 'dark' ? 'text-slate-300' : 'text-slate-600'}>Operation:</span>{' '}
                          <span className="text-purple-500 font-bold">{selectedNode.data.joinType}</span>
                        </div>
                        <div className={`p-2 rounded border mt-1 max-h-24 overflow-y-auto ${
                          theme === 'dark' ? 'bg-slate-850 border-slate-700 text-slate-200' : 'bg-slate-50 border-slate-200 text-slate-800'
                        }`}>
                          <span className="text-purple-500 font-medium">ON Condition:</span>{' '}
                          <code>{selectedNode.data.condition}</code>
                        </div>
                        
                      </div>
                    )}

                    {selectedNode.type === 'filterNode' && (
                      <div className="space-y-1">
                        <div className={`p-2 rounded border max-h-24 overflow-y-auto ${
                          theme === 'dark' ? 'bg-slate-850 border-slate-700 text-slate-200' : 'bg-slate-50 border-slate-200 text-slate-800'
                        }`}>
                          <span className="text-amber-500 font-semibold">Condition:</span>{' '}
                          <code>{selectedNode.data.condition}</code>
                        </div>
                        
                      </div>
                    )}

                    {selectedNode.type === 'groupByNode' && (
                      <div>
                        <div>
                          <span className={theme === 'dark' ? 'text-slate-300' : 'text-slate-600'}>Grouping Columns:</span>{' '}
                          <span className="text-pink-500 font-bold">{selectedNode.data.columns}</span>
                        </div>
                        
                      </div>
                    )}

                    {selectedNode.type === 'havingNode' && (
                      <div className="space-y-1">
                        <div className={`p-2 rounded border ${
                          theme === 'dark' ? 'bg-slate-850 border-slate-700 text-slate-200' : 'bg-slate-50 border-slate-200 text-slate-800'
                        }`}>
                          <span className="text-rose-500 font-semibold">HAVING Expression:</span>{' '}
                          <code>{selectedNode.data.condition}</code>
                        </div>
                        
                      </div>
                    )}

                    {selectedNode.type === 'sortNode' && (
                      <div>
                        <div>
                          <span className={theme === 'dark' ? 'text-slate-300' : 'text-slate-600'}>Order By:</span>{' '}
                          <span className="text-teal-500 font-bold">{selectedNode.data.details}</span>
                        </div>
                        
                      </div>
                    )}

                    {selectedNode.type === 'limitNode' && (
                      <div>
                        <div>
                          <span className={theme === 'dark' ? 'text-slate-300' : 'text-slate-600'}>Parameters:</span>{' '}
                          <span className="text-cyan-500 font-bold">{selectedNode.data.details}</span>
                        </div>
                        
                      </div>
                    )}

                    {selectedNode.type === 'resultNode' && (
                      <div className="space-y-1.5">
                        <div className={`text-[11px] ${theme === 'dark' ? 'text-slate-200' : 'text-slate-700'}`}>
                          {selectedNode.data.columns?.some((col: any) => col.name && col.name.includes('Operation:'))
                            ? 'Итоговый результат выполнения DML-операции (модификация данных):'
                            : 'Итоговый набор колонок, который возвращается пользователю в результате выполнения SELECT:'}
                        </div>
                        <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                          {selectedNode.data.columns?.map((col: any, idx: number) => (
                            <span key={idx} className={`px-2 py-1 rounded text-[10px] border ${
                              theme === 'dark' 
                                ? 'bg-slate-850 text-emerald-300 border-slate-600' 
                                : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            }`}>
                              {col.name} {col.alias ? `as ${col.alias}` : ''}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {selectedNode.type === 'constantNode' && (
                      <div className="space-y-1">
                        <div className={`p-2 rounded border ${
                          theme === 'dark' ? 'bg-slate-850 border-slate-750 text-slate-200' : 'bg-slate-50 border-slate-200 text-slate-800'
                        }`}>
                          <code>{selectedNode.data.details}</code>
                        </div>
                        
                      </div>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => setSelectedNode(null)}
                  className={`p-1.5 rounded transition-colors shrink-0 ${
                    theme === 'dark' ? 'hover:bg-slate-600 text-slate-200' : 'hover:bg-slate-100 text-slate-600'
                  }`}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

        </section>

      </main>

      {/* FULLSCREEN OVERLAY MODAL */}
      {isMaximizedSql && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs p-1.5 sm:p-2.5 flex flex-col items-center justify-center animate-in fade-in duration-150">
          <div className={`w-full max-w-7xl h-full border rounded-xl flex flex-col shadow-2xl overflow-hidden transition-colors ${
            theme === 'dark' ? 'bg-slate-850 border-slate-700 text-slate-200' : 'bg-slate-100 border-slate-300 text-slate-900'
          }`}>
            {/* HEADER */}
            <div className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b shrink-0 ${
              theme === 'dark' ? 'bg-slate-800 border-slate-700' : 'bg-slate-200/90 border-slate-300'
            }`}>
              <div className="flex items-center gap-2.5">
                <Code className="w-4 h-4 text-blue-500" />
                <h3 className={`font-bold text-sm ${theme === 'dark' ? 'text-slate-100' : 'text-slate-900'}`}>
                  SQL Query Editor
                </h3>
                <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded ${
                  theme === 'dark' ? 'bg-slate-700 text-slate-300' : 'bg-white text-slate-800 border border-slate-300 shadow-2xs font-semibold'
                }`}>
                  Полноэкранный режим
                </span>
              </div>

              <div className="flex items-center gap-2 sm:gap-3">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded font-semibold transition-colors ${
                    theme === 'dark' 
                      ? 'text-amber-300 hover:text-amber-100 bg-amber-950/40 hover:bg-amber-900/60 border border-amber-500/30' 
                      : 'text-amber-800 hover:text-amber-950 bg-amber-50 hover:bg-amber-100 border border-amber-300 shadow-2xs'
                  }`}
                  title="Открыть SQL файл с диска"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-amber-500" />
                  <span>Открыть</span>
                </button>

                <button
                  onClick={handleSaveSqlFile}
                  className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded font-semibold transition-colors ${
                    theme === 'dark' 
                      ? 'text-emerald-300 hover:text-emerald-100 bg-emerald-950/40 hover:bg-emerald-900/60 border border-emerald-500/30' 
                      : 'text-emerald-800 hover:text-emerald-950 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 shadow-2xs'
                  }`}
                  title="Сохранить SQL в .sql файл"
                >
                  <FileDown className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Сохранить</span>
                </button>

                <button
                  onClick={() => setShowSnippetsModal(true)}
                  className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded font-semibold transition-colors ${
                    theme === 'dark' 
                      ? 'text-blue-300 hover:text-blue-100 bg-blue-900/40 hover:bg-blue-800/60 border border-blue-500/40' 
                      : 'text-blue-800 hover:text-blue-950 bg-blue-50 hover:bg-blue-100 border border-blue-300 shadow-2xs'
                  }`}
                  title="Конструктор и библиотека сниппетов SQL"
                >
                  <Layers className="w-3.5 h-3.5 text-blue-500" />
                  <span>Сниппеты</span>
                </button>

                <button
                  onClick={() => setShowHistoryModal(true)}
                  className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded font-semibold transition-colors ${
                    theme === 'dark' 
                      ? 'text-purple-300 hover:text-purple-100 bg-purple-950/40 hover:bg-purple-900/60 border border-purple-500/30' 
                      : 'text-purple-800 hover:text-purple-950 bg-purple-100 hover:bg-purple-200 border border-purple-300 shadow-2xs'
                  }`}
                  title="История версий SQL"
                >
                  <History className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                  <span>История</span>
                </button>

                <button
                  onClick={() => setIsWrapSql(!isWrapSql)}
                  className={`flex items-center gap-1 text-xs px-2 py-1 rounded font-medium transition-colors ${
                    isWrapSql
                      ? 'bg-blue-600/30 text-blue-300 border border-blue-500/40'
                      : theme === 'dark' ? 'text-slate-300 hover:text-slate-100' : 'text-slate-800 hover:text-slate-950'
                  }`}
                  title="Перенос строки"
                >
                  <WrapText className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Перенос строки</span>
                </button>

                <button
                  onClick={handleCopySql}
                  className={`flex items-center gap-1 text-xs px-2 py-1 font-medium transition-colors ${
                    theme === 'dark' ? 'text-slate-300 hover:text-slate-100' : 'text-slate-800 hover:text-slate-950'
                  }`}
                  title="Скопировать SQL"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  <span className="hidden sm:inline">{copied ? 'Copied!' : 'Copy SQL'}</span>
                </button>

                <div className="h-4 w-px bg-slate-400/40 dark:bg-slate-600" />

                <button
                  onClick={() => setIsMaximizedSql(false)}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold border transition-all ${
                    theme === 'dark' 
                      ? 'bg-slate-700 border-slate-600 text-slate-200 hover:bg-slate-600' 
                      : 'bg-white border-slate-300 text-slate-800 hover:bg-slate-50 shadow-2xs'
                  }`}
                  title="Свернуть (Esc)"
                >
                  <Minimize2 className="w-3.5 h-3.5" />
                  <span>Свернуть</span>
                </button>
              </div>
            </div>

            {/* BODY */}
            <div className="flex-1 p-3.5 flex flex-col min-h-0 relative">
              <SqlEditor
                value={sql}
                onChange={setSql}
                isWrapSql={isWrapSql}
                theme={theme}
              />
            </div>

            {/* FOOTER */}
            <div className={`p-3 px-5 border-t flex items-center justify-between shrink-0 relative ${
              theme === 'dark' ? 'bg-slate-800 border-slate-700' : 'bg-slate-300/80 border-slate-400/60'
            }`}>
              <div className="flex items-center gap-3">
                {/* PRESETS BUTTON & POPOVER IN FOOTER */}
                <div className="relative">
                  <button
                    onClick={() => setShowPresetsDropdown(!showPresetsDropdown)}
                    className={`text-xs px-2.5 py-1 rounded transition-colors flex items-center gap-1 font-medium ${
                      showPresetsDropdown
                        ? (theme === 'dark' ? 'bg-slate-700/80 text-slate-100 border border-slate-600' : 'bg-slate-400/40 text-slate-900 border border-slate-400')
                        : (theme === 'dark' 
                            ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/40 border border-transparent' 
                            : 'text-slate-700 hover:text-slate-900 hover:bg-slate-400/30 border border-transparent')
                    }`}
                    title="Готовые шаблоны и примеры SQL"
                  >
                    <span>Пресеты</span>
                    <ChevronDown className="w-3 h-3 opacity-60" />
                  </button>

                  {showPresetsDropdown && (
                    <>
                      <div 
                        className="fixed inset-0 z-40" 
                        onClick={() => setShowPresetsDropdown(false)} 
                      />
                      <div className={`absolute bottom-full mb-2 left-0 z-50 rounded-lg border shadow-2xl p-2 w-80 backdrop-blur-md animate-in fade-in duration-150 ${
                        theme === 'dark' ? 'bg-slate-800 border-slate-600 text-slate-200' : 'bg-white border-slate-300 text-slate-800'
                      }`}>
                        <div className="flex items-center justify-between pb-1.5 border-b border-slate-600/40 mb-1.5">
                          <span className="text-xs uppercase font-bold text-slate-400">Готовые SQL пресеты</span>
                          <button 
                            onClick={() => setShowPresetsDropdown(false)}
                            className="p-0.5 rounded hover:bg-slate-700/50 text-slate-400 hover:text-slate-200"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
                          {sqlPresets.map((preset) => (
                            <button
                              key={preset.id}
                              onClick={() => {
                                handlePresetChange(preset.id);
                                setShowPresetsDropdown(false);
                              }}
                              className={`w-full text-left p-2 rounded transition-all text-xs flex flex-col gap-0.5 border ${
                                activePresetId === preset.id
                                  ? theme === 'dark' ? 'bg-amber-950/50 border-amber-500/60 text-amber-200 font-semibold' : 'bg-amber-50 border-amber-300 text-amber-900 font-semibold'
                                  : theme === 'dark' ? 'hover:bg-slate-700/60 border-transparent text-slate-300' : 'hover:bg-slate-100 border-transparent text-slate-700'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <span className="truncate pr-1 font-medium">{preset.title}</span>
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-700/40 text-slate-300 font-mono shrink-0">
                                  {preset.dialect}
                                </span>
                              </div>
                              {preset.description && (
                                <span className="text-[10px] text-slate-400 line-clamp-1 leading-tight font-normal">
                                  {preset.description}
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>

                <div className="text-xs text-slate-500 dark:text-slate-400 border-l border-slate-600/40 pl-3">
                  Нажмите <kbd className="px-1.5 py-0.5 rounded border text-[10px] bg-slate-200 dark:bg-slate-700 border-slate-300 dark:border-slate-600 font-mono">Esc</kbd> чтобы выйти
                </div>
              </div>

              <button
                onClick={() => {
                  handleVisualize();
                  setIsMaximizedSql(false);
                }}
                className="flex items-center justify-center gap-2 px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-md transition-all"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>Visualize</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SQL SNIPPETS & BUILDER MODAL */}
      <SqlSnippetsManager
        isOpen={showSnippetsModal}
        onClose={() => setShowSnippetsModal(false)}
        onInsertSnippet={handleInsertSnippet}
        theme={theme}
      />

      {/* SETTINGS & HOTKEYS MODAL */}
      <SettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        theme={theme}
        hotkeys={hotkeys}
        onUpdateHotkeys={setHotkeys}
      />

      {/* VERSION HISTORY MODAL */}
      <VersionHistoryModal
        isOpen={showHistoryModal}
        onClose={() => setShowHistoryModal(false)}
        currentSql={sql}
        currentDialect={dialect}
        onRestoreVersion={(restoredSql, restoredDialect) => {
          setSql(restoredSql);
          setDialect(restoredDialect);
          handleVisualize(restoredSql, restoredDialect, direction);
        }}
        theme={theme}
      />

    </div>
  );
}

