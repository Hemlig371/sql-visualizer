// @ts-nocheck
import React, { useState, useEffect, useCallback } from 'react';
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
  RefreshCw,
  Sparkles,
  Info,
  Sun,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Map
} from 'lucide-react';

import { parseSqlToAst, astToGraph, getLayoutedElements } from './utils/astToGraph';
import { nodeTypes } from './components/CustomNodes';
import { sqlPresets, SQLPreset } from './components/SQLPresets';

export default function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [sql, setSql] = useState<string>(sqlPresets[0].sql);
  const [dialect, setDialect] = useState<'PostgreSQL' | 'Oracle' | 'Clickhouse'>('PostgreSQL');
  const [direction, setDirection] = useState<'LR' | 'TB'>('LR');
  const [activePresetId, setActivePresetId] = useState<string>(sqlPresets[0].id);
  const [showSortNodes, setShowSortNodes] = useState<boolean>(true);
  const [showLimitNodes, setShowLimitNodes] = useState<boolean>(true);
  
    const [expandedQueries, setExpandedQueries] = useState<Set<string>>(new Set());

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

  const [nodes, setNodes, onNodesChange] = useNodesState<any>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<any>([]);
  const [error, setError] = useState<string | null>(null);
  const [astResult, setAstResult] = useState<any>(null);
  
  const [selectedNode, setSelectedNode] = useState<any | null>(null);
  const [showAstPreview, setShowAstPreview] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [showLeftPanel, setShowLeftPanel] = useState<boolean>(true);
  const [showMiniMap, setShowMiniMap] = useState<boolean>(true);

  // Sync document.documentElement with theme
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

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
    <div className={`flex flex-col h-screen ${theme === 'dark' ? 'dark bg-slate-950 text-slate-200' : 'bg-slate-900 text-slate-100'} font-sans select-none overflow-hidden`}>
      
      {/* CORE WORKSPACE */}
      <main className="flex flex-1 overflow-hidden relative">
        
        {/* LEFT PANEL: INPUT & CONFIG (30% WIDTH) */}
        {showLeftPanel && (
        <aside id="control-panel" className={`w-[30%] min-w-[340px] max-w-[480px] border-r flex flex-col p-4 space-y-4 shrink-0 transition-colors ${
          theme === 'dark' ? 'bg-slate-900/50 border-slate-800' : 'bg-slate-800 border-slate-700'
        }`}>
          
          {/* PRESETS */}
          <div className="space-y-1.5">
            <label className={`text-[10px] font-bold uppercase tracking-widest ${theme === 'dark' ? 'text-slate-400' : 'text-slate-400'}`}>Preset SQL Query</label>
            <select
              value={activePresetId}
              onChange={(e) => handlePresetChange(e.target.value)}
              className={`w-full border rounded-md py-1.5 px-3 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors ${
                theme === 'dark' 
                  ? 'bg-slate-800 border-slate-700 text-slate-200' 
                  : 'bg-slate-800 border-slate-700 text-slate-200'
              }`}
            >
              {sqlPresets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.title}
                </option>
              ))}
            </select>
            <p className={`text-[11px] italic leading-relaxed ${theme === 'dark' ? 'text-slate-400' : 'text-slate-400'}`}>
              {sqlPresets.find(p => p.id === activePresetId)?.description}
            </p>
          </div>

          {/* CODE EDITOR WORKSPACE */}
          <div className="flex-1 flex flex-col space-y-1.5 min-h-0 relative">
            <div className="flex items-center justify-between">
              <label className={`text-[10px] font-bold uppercase tracking-widest ${theme === 'dark' ? 'text-slate-400' : 'text-slate-400'}`}>SQL Query</label>
              <button
                onClick={handleCopySql}
                className={`flex items-center gap-1 text-[10px] transition-colors ${theme === 'dark' ? 'text-slate-400 hover:text-slate-200' : 'text-slate-500 hover:text-slate-200'}`}
                title="Copy SQL"
              >
                {copied ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-500" />
                    <span className="text-emerald-500">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    <span>Copy SQL</span>
                  </>
                )}
              </button>
            </div>

            {/* TEXTAREA EDITOR WITH DECORATIVE LINE NUMBERS */}
            <div className={`flex-1 relative rounded-md border overflow-hidden font-mono text-xs leading-relaxed flex border-slate-700 bg-slate-950`}>
              <div className={`w-9 border-r flex flex-col items-center pt-3 text-[10px] select-none space-y-1 bg-slate-900/50 border-slate-800 text-slate-400`}>
                {Array.from({ length: 15 }).map((_, i) => (
                  <span key={i}>{i + 1}</span>
                ))}
              </div>
              <textarea
                value={sql}
                onChange={(e) => setSql(e.target.value)}
                spellCheck="false"
                className={`flex-1 h-full p-3 bg-transparent resize-none outline-none leading-relaxed overflow-y-auto text-blue-400 selection:bg-blue-600/30`}
                placeholder="Enter SQL Query here..."
              />
            </div>

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
          <button
            onClick={() => handleVisualize()}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-md shadow-lg shadow-blue-900/20 active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
          >
            <Play className="w-3.5 h-3.5 fill-white" />
            <span>Visualize Data Flow</span>
          </button>
        </aside>
        )}

        {/* RIGHT PANEL: INTERACTIVE CANVAS (70% WIDTH) */}
        <section className={`flex-1 flex flex-col h-full relative transition-colors ${
          theme === 'dark' ? 'bg-slate-950 text-slate-200' : 'bg-slate-900 text-slate-200'
        }`}>
          
          {/* CANVAS CONTROLS HEADER */}
          <div className={`flex items-center justify-between px-4 h-11 border-b z-10 select-none ${
            theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-slate-800 border-slate-700'
          }`}>
            <div className="flex items-center gap-4 text-xs">
              <div className="flex items-center gap-1.5 font-medium">
                <Layout className="w-3.5 h-3.5 text-blue-500" />
                <span className={theme === 'dark' ? 'text-slate-300' : 'text-slate-300'}>Layout:</span>
              </div>
              <div className={`flex p-0.5 rounded-md border ${
                theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-900 border-slate-700'
              }`}>
                <button
                  onClick={() => handleDirectionChange('LR')}
                  className={`px-2.5 py-1 rounded text-[10px] font-mono transition-all ${
                    direction === 'LR' 
                      ? 'bg-blue-600 text-white font-bold' 
                      : theme === 'dark' ? 'text-slate-400 hover:text-slate-200' : 'text-slate-500 hover:text-slate-200'
                  }`}
                >
                  Left-Right
                </button>
                <button
                  onClick={() => handleDirectionChange('TB')}
                  className={`px-2.5 py-1 rounded text-[10px] font-mono transition-all ${
                    direction === 'TB' 
                      ? 'bg-blue-600 text-white font-bold' 
                      : theme === 'dark' ? 'text-slate-400 hover:text-slate-200' : 'text-slate-500 hover:text-slate-200'
                  }`}
                >
                  Top-Bottom
                </button>
              </div>

              <div className="h-4 w-px bg-slate-300 dark:bg-slate-800" />
              <div className="flex items-center gap-1.5 font-medium">
                <span className={theme === 'dark' ? 'text-slate-300' : 'text-slate-300'}>Pipeline Steps:</span>
              </div>
              <div className={`flex p-0.5 rounded-md border ${
                theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-900 border-slate-700'
              }`}>
                <button
                  onClick={handleSortToggle}
                  className={`px-2.5 py-1 rounded text-[10px] font-mono transition-all ${
                    showSortNodes 
                      ? 'bg-emerald-600 text-white font-bold' 
                      : theme === 'dark' ? 'text-slate-500 hover:text-slate-400' : 'text-slate-400 hover:text-slate-300'
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
                      : theme === 'dark' ? 'text-slate-500 hover:text-slate-400' : 'text-slate-400 hover:text-slate-300'
                  }`}
                  title="Toggle visualization of LIMIT / OFFSET nodes"
                >
                  Limit Nodes
                </button>
              </div>
            </div>

            {/* AST Preview toggle and Info labels */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowLeftPanel(!showLeftPanel)}
                className={`p-1.5 rounded-lg border transition-all ${
                  theme === 'dark' 
                    ? 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200' 
                    : 'bg-slate-900 border-slate-700 text-slate-300 hover:text-slate-100'
                }`}
                title={showLeftPanel ? 'Hide Editor Panel' : 'Show Editor Panel'}
              >
                {showLeftPanel ? <PanelLeftClose className="w-3.5 h-3.5" /> : <PanelLeftOpen className="w-3.5 h-3.5" />}
              </button>

              <button
                onClick={() => setShowMiniMap(!showMiniMap)}
                className={`p-1.5 rounded-lg border transition-all ${
                  !showMiniMap
                    ? (theme === 'dark' ? 'bg-slate-900 border-slate-700 text-slate-400' : 'bg-slate-800 border-slate-700 text-slate-400')
                    : (theme === 'dark' ? 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200' : 'bg-slate-900 border-slate-700 text-slate-300 hover:text-slate-100')
                }`}
                title={showMiniMap ? 'Hide MiniMap' : 'Show MiniMap'}
              >
                <Map className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className={`p-1.5 rounded-lg border transition-all ${
                  theme === 'dark' 
                    ? 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200' 
                    : 'bg-slate-900 border-slate-700 text-slate-300 hover:text-slate-100'
                }`}
                title={theme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
              >
                {theme === 'dark' ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5 text-blue-600" />}
              </button>
                            

            </div>
          </div>

          {/* REACT FLOW CANVAS CONTAINER */}
          <div className={`flex-1 w-full relative min-h-0 ${theme === 'dark' ? 'bg-slate-950' : 'bg-slate-900'}`}>
            {/* Grid Pattern Background styled specifically to match the design style */}
            <div className={`absolute inset-0 pointer-events-none opacity-[0.07] dark:opacity-10`} style={{ backgroundImage: 'radial-gradient(#64748b 1px, transparent 1px)', backgroundSize: '24px 24px' }}></div>
            
            {nodes.length > 0 ? (
              <ReactFlow
                nodes={nodes}
                edges={edges}
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
                    ? '!bg-slate-900 !border-slate-800 !text-slate-300 [&_button]:!bg-slate-900 [&_button]:!border-slate-800 [&_button]:!text-slate-400 [&_button:hover]:!text-slate-200' 
                    : '!bg-slate-800 !border-slate-700 !text-slate-200 [&_button]:!bg-slate-800 [&_button]:!border-slate-700 [&_button]:!text-slate-400 [&_button:hover]:!text-slate-200'
                }`} />
                {showMiniMap && (
                  <MiniMap 
                    className={`!shadow-lg !rounded-lg border ${
                      theme === 'dark' ? '!bg-slate-900 !border-slate-800' : '!bg-slate-800 !border-slate-700'
                    }`}
                    nodeColor={(n: any) => {
                      if (n.type === 'tableNode') return theme === 'dark' ? '#3b82f6' : '#2563eb';
                      if (n.type === 'resultNode') return theme === 'dark' ? '#10b981' : '#059669';
                      if (n.type === 'filterNode') return theme === 'dark' ? '#f59e0b' : '#d97706';
                      return theme === 'dark' ? '#475569' : '#94a3b8';
                    }}
                    maskColor={theme === 'dark' ? 'rgba(15, 23, 42, 0.7)' : 'rgba(15, 23, 42, 0.5)'}
                  />
                )}
              </ReactFlow>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-slate-500 bg-transparent">
                <div className="w-12 h-12 rounded-full border border-slate-300 dark:border-slate-800 flex items-center justify-center text-slate-450 mb-3">
                  <Database className="w-6 h-6 text-slate-400 dark:text-slate-500" />
                </div>
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-400 mb-1">Песочница пуста</div>
                <div className="text-xs max-w-xs leading-normal text-slate-500 dark:text-slate-500">
                  Введите ваш SQL-запрос в редактор слева и нажмите <strong className="text-slate-600 dark:text-slate-400">Visualize Data Flow</strong> для построения интерактивного логического графа.
                </div>
              </div>
            )}

            {/* RAW AST OVERLAY SIDEBAR */}
            {showAstPreview && (
              <div className={`absolute right-0 top-0 bottom-0 w-80 border-l z-20 flex flex-col shadow-2xl backdrop-blur-md animate-in slide-in-from-right duration-200 ${
                theme === 'dark' ? 'bg-[#090f1a]/95 border-slate-800' : 'bg-slate-800/95 border-slate-700'
              }`}>
                <div className={`flex items-center justify-between p-3 border-b ${
                  theme === 'dark' ? 'border-slate-800 bg-slate-950/40' : 'border-slate-200 bg-slate-50'
                }`}>
                  <div className="flex items-center gap-1.5 text-xs font-mono text-amber-500 font-bold">
                    <Terminal className="w-3.5 h-3.5" />
                    <span>Parsed AST Tree</span>
                  </div>
                  <button
                    onClick={() => setShowAstPreview(false)}
                    className={`p-1 rounded transition-colors ${
                      theme === 'dark' ? 'hover:bg-slate-800 text-slate-400 hover:text-slate-200' : 'hover:bg-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex-1 p-3 overflow-y-auto text-[11px] font-mono select-text">
                  {astResult ? (
                    <pre className={`p-3 rounded-lg border overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-full ${
                      theme === 'dark' ? 'bg-[#040811] border-slate-900 text-slate-300' : 'bg-slate-900 border-slate-700 text-slate-200'
                    }`}>
                      {JSON.stringify(astResult, null, 2)}
                    </pre>
                  ) : (
                    <div className="text-slate-500 italic text-center mt-10">
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
              theme === 'dark' ? 'bg-slate-900 border-slate-800 text-slate-200' : 'bg-slate-800 border-slate-200 text-slate-200'
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
                    <span className={`text-[10px] tracking-wider uppercase font-mono ${theme === 'dark' ? 'text-slate-400' : 'text-slate-400'}`}>
                      Logical Execution Node: {selectedNode.type}
                    </span>
                    <span className="text-slate-500 text-[10px] font-mono">ID: {selectedNode.id}</span>
                  </div>
                  
                  <h4 className={`text-sm font-bold flex items-center gap-2 text-slate-100`}>
                    {selectedNode.data.title || selectedNode.data.label || 'Details'}
                  </h4>

                  {/* Dynamic description of execution */}
                  <div className="mt-2 text-xs leading-relaxed font-mono select-text">
                    {selectedNode.type === 'tableNode' && (
                      <div className="flex flex-col gap-1">
                        <div>
                          <span className="text-slate-500">Source relation:</span>{' '}
                          <span className={theme === 'dark' ? 'text-blue-300 font-bold' : 'text-blue-600 font-bold'}>{selectedNode.data.label}</span>
                          {selectedNode.data.alias && (
                            <> as <span className={theme === 'dark' ? 'text-blue-400 font-semibold' : 'text-blue-500 font-semibold'}>"{selectedNode.data.alias}"</span></>
                          )}
                        </div>
                        <div className={`text-[11px] italic ${theme === 'dark' ? 'text-slate-400' : 'text-slate-400'}`}>
                          Базовая таблица базы данных или подзапрос, из которого считываются исходные записи для обработки.
                        </div>
                      </div>
                    )}

                    {selectedNode.type === 'joinNode' && (
                      <div className="space-y-1">
                        <div>
                          <span className="text-slate-500">Operation:</span>{' '}
                          <span className="text-purple-500 font-bold">{selectedNode.data.joinType}</span>
                        </div>
                        <div className={`p-2 rounded border mt-1 max-h-24 overflow-y-auto ${
                          theme === 'dark' ? 'bg-slate-950 border-slate-900 text-slate-200' : 'bg-slate-900 border-slate-700 text-slate-200'
                        }`}>
                          <span className="text-purple-500 font-medium">ON Condition:</span>{' '}
                          <code>{selectedNode.data.condition}</code>
                        </div>
                        <p className={`text-[11px] leading-relaxed italic ${theme === 'dark' ? 'text-slate-400' : 'text-slate-400'}`}>
                          Объединяет записи из предыдущих шагов с текущей таблицей по указанному условию ON.
                        </p>
                      </div>
                    )}

                    {selectedNode.type === 'filterNode' && (
                      <div className="space-y-1">
                        <div className={`p-2 rounded border max-h-24 overflow-y-auto ${
                          theme === 'dark' ? 'bg-slate-950 border-slate-900 text-slate-200' : 'bg-slate-900 border-slate-700 text-slate-200'
                        }`}>
                          <span className="text-amber-500 font-semibold">Condition:</span>{' '}
                          <code>{selectedNode.data.condition}</code>
                        </div>
                        <p className={`text-[11px] leading-relaxed italic ${theme === 'dark' ? 'text-slate-400' : 'text-slate-400'}`}>
                          Фильтрует строки: пропускает дальше только те записи, которые удовлетворяют условию (где выражение истинно).
                        </p>
                      </div>
                    )}

                    {selectedNode.type === 'groupByNode' && (
                      <div>
                        <div>
                          <span className="text-slate-500">Grouping Columns:</span>{' '}
                          <span className="text-pink-500 font-bold">{selectedNode.data.columns}</span>
                        </div>
                        <p className={`text-[11px] leading-relaxed italic mt-1.5 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-400'}`}>
                          Группирует строки с одинаковыми значениями для вычисления агрегатных функций (например, SUM, AVG, COUNT).
                        </p>
                      </div>
                    )}

                    {selectedNode.type === 'havingNode' && (
                      <div className="space-y-1">
                        <div className={`p-2 rounded border ${
                          theme === 'dark' ? 'bg-slate-950 border-slate-900 text-slate-200' : 'bg-slate-900 border-slate-700 text-slate-200'
                        }`}>
                          <span className="text-rose-500 font-semibold">HAVING Expression:</span>{' '}
                          <code>{selectedNode.data.condition}</code>
                        </div>
                        <p className={`text-[11px] leading-relaxed italic ${theme === 'dark' ? 'text-slate-400' : 'text-slate-400'}`}>
                          Фильтрует уже сгруппированные данные (выполняется после GROUP BY). Пропускает только агрегированные группы, подходящие под условие.
                        </p>
                      </div>
                    )}

                    {selectedNode.type === 'sortNode' && (
                      <div>
                        <div>
                          <span className="text-slate-500">Order By:</span>{' '}
                          <span className="text-teal-500 font-bold">{selectedNode.data.details}</span>
                        </div>
                        <p className={`text-[11px] leading-relaxed italic mt-1.5 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-400'}`}>
                          Сортирует результирующие строки по одному или нескольким полям (по возрастанию ASC или убыванию DESC).
                        </p>
                      </div>
                    )}

                    {selectedNode.type === 'limitNode' && (
                      <div>
                        <div>
                          <span className="text-slate-500">Parameters:</span>{' '}
                          <span className="text-cyan-500 font-bold">{selectedNode.data.details}</span>
                        </div>
                        <p className={`text-[11px] leading-relaxed italic mt-1.5 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-400'}`}>
                          Ограничивает количество возвращаемых строк (LIMIT) и при необходимости задает сдвиг от начала (OFFSET).
                        </p>
                      </div>
                    )}

                    {selectedNode.type === 'resultNode' && (
                      <div className="space-y-1.5">
                        <div className={`text-[11px] ${theme === 'dark' ? 'text-slate-400' : 'text-slate-400'}`}>
                          {selectedNode.data.columns?.some((col: any) => col.name && col.name.includes('Operation:'))
                            ? 'Итоговый результат выполнения DML-операции (модификация данных):'
                            : 'Итоговый набор колонок, который возвращается пользователю в результате выполнения SELECT:'}
                        </div>
                        <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                          {selectedNode.data.columns?.map((col: any, idx: number) => (
                            <span key={idx} className={`px-2 py-1 rounded text-[10px] border ${
                              theme === 'dark' 
                                ? 'bg-slate-950 text-emerald-300 border-slate-800' 
                                : 'bg-slate-900 text-emerald-400 border-slate-700'
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
                          theme === 'dark' ? 'bg-slate-950 border-slate-900 text-slate-200' : 'bg-slate-900 border-slate-700 text-slate-200'
                        }`}>
                          <code>{selectedNode.data.details}</code>
                        </div>
                        <p className={`text-[11px] italic ${theme === 'dark' ? 'text-slate-400' : 'text-slate-400'}`}>
                          Константное значение или вычисление выражения, выполняемое напрямую без обращения к физическим таблицам.
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => setSelectedNode(null)}
                  className={`p-1.5 rounded transition-colors shrink-0 ${
                    theme === 'dark' ? 'hover:bg-slate-800 text-slate-400 hover:text-slate-200' : 'hover:bg-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

        </section>

      </main>

      {/* FOOTER BAR */}
      <footer className={`h-6 border-t flex items-center justify-between px-3 text-[10px] font-medium select-none shrink-0 transition-colors ${
        theme === 'dark' ? 'bg-slate-900 border-slate-800 text-slate-400' : 'bg-slate-800 border-slate-700 text-slate-400'
      }`}>
        <div className="flex items-center space-x-4">
          <span>Status: Ready</span>
          <span>Nodes: {nodes.length}</span>
          <span>Edges: {edges.length}</span>
        </div>
        <div className="flex items-center space-x-4">
          <span>AST ENGINE: node-sql-parser</span>
          <span>UTF-8</span>
        </div>
      </footer>

    </div>
  );
}

