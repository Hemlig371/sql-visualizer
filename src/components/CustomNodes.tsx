// @ts-nocheck
import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { 
  Database, 
  GitMerge, 
  Filter, 
  Layers, 
  ArrowUpDown, 
  ChevronsDown, 
  FileSpreadsheet, 
  Settings, 
  HelpCircle,
  FileCode2,
  Edit
} from 'lucide-react';

interface CustomNodeProps {
  data: any;
  selected?: boolean;
  targetPosition?: Position;
  sourcePosition?: Position;
}

// TABLE NODE (Blue)
export const TableNode = memo(({ data, selected, targetPosition, sourcePosition }: CustomNodeProps) => {
  return (
    <div className={`w-64 rounded-lg dark:bg-slate-900 bg-slate-800 border-2 ${selected ? 'border-blue-500 shadow-2xl scale-102' : 'dark:border-blue-500/50 border-blue-500/30'} transition-all duration-200 shadow-xl overflow-hidden`}>
      <div className="dark:bg-blue-500/10 bg-blue-50/50 px-3 py-1.5 flex items-center border-b dark:border-blue-500/30 border-blue-500/15">
        <div className="w-2 h-2 rounded-full bg-blue-500 mr-2 animate-pulse"></div>
        <span className="text-[10px] font-bold uppercase dark:text-blue-400 text-blue-600 tracking-wider">
          {data.title || 'TableNode'}
        </span>
        {data.isSubquery && (
          <span className="ml-auto text-[9px] dark:bg-blue-500/20 bg-blue-50 text-blue-500 dark:text-blue-300 px-1.5 py-0.2 rounded font-mono border dark:border-blue-500/30 border-blue-500/20">
            Subquery
          </span>
        )}
      </div>
      <div className="p-3 dark:bg-slate-950/40 bg-slate-900/20">
        <div className="text-sm font-bold dark:text-slate-100 text-slate-200 truncate">
          {data.label}
        </div>
        {data.alias && (
          <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
            <span className="text-[9px] dark:bg-slate-800 bg-slate-900 dark:text-slate-400 text-slate-500 px-1 py-0.5 rounded font-mono border dark:border-slate-700 border-slate-700">ALIAS</span>
            <span className="font-mono dark:text-slate-300 text-slate-300 truncate">{data.alias}</span>
          </div>
        )}
        {data.subqueryTables && data.subqueryTables.length > 0 && (
          <div className="mt-2 text-[10px] dark:text-slate-400 text-slate-500">
            <span className="font-semibold">Источники: </span>
            <span className="font-mono dark:text-slate-300 text-slate-300">{data.subqueryTables.join(', ')}</span>
          </div>
        )}
        {data.columns && data.columns.length > 0 && (
          <div className="mt-3 space-y-1.5 border-t dark:border-slate-800 border-slate-700 pt-2.5">
            <div className="text-[9px] font-bold dark:text-slate-400 text-slate-500 uppercase tracking-wider">Колонки / Поля вставки:</div>
            <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
              {data.columns.map((col: any, idx: number) => {
                const colName = typeof col === 'string' ? col : (col.name || '');
                return (
                  <div key={idx} className="flex flex-col dark:bg-slate-950 bg-slate-900 p-1.5 rounded border dark:border-slate-800 border-slate-700 text-[10px] font-mono">
                    <span className="dark:text-slate-300 text-slate-300 break-all">{colName}</span>
                    {col.alias && (
                      <span className="text-[9px] dark:text-blue-400 text-blue-600 font-semibold mt-0.5">
                        as {col.alias}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      <Handle type="target" position={targetPosition || Position.Left} className="w-3 h-3 dark:!bg-slate-950 !bg-slate-800 dark:!border-slate-600 !border-slate-700" />
      <Handle type="source" position={sourcePosition || Position.Right} className="w-3 h-3 dark:!bg-slate-950 !bg-slate-800 dark:!border-slate-600 !border-slate-700" />
    </div>
  );
});

TableNode.displayName = 'TableNode';

// JOIN NODE (Purple)
export const JoinNode = memo(({ data, selected, targetPosition, sourcePosition }: CustomNodeProps) => {
  return (
    <div className={`w-64 rounded-lg dark:bg-slate-900 bg-slate-800 border-2 ${selected ? 'border-purple-500 shadow-2xl scale-102' : 'dark:border-purple-500/50 border-purple-500/30'} transition-all duration-200 shadow-xl overflow-hidden`}>
      <div className="dark:bg-purple-500/10 bg-purple-50/50 px-3 py-1.5 flex items-center border-b dark:border-purple-500/30 border-purple-500/15">
        <div className="w-2 h-2 rounded-full bg-purple-500 mr-2"></div>
        <span className="text-[10px] font-bold uppercase dark:text-purple-400 text-purple-600 tracking-wider">JoinNode</span>
      </div>
      <div className="p-3 dark:bg-slate-950/40 bg-slate-900/20 space-y-2">
        <div className="text-xs font-bold dark:text-purple-300 text-purple-700 dark:bg-purple-500/10 bg-purple-50 border dark:border-purple-500/20 border-purple-500/15 px-2 py-0.5 rounded inline-block">
          {data.joinType}
        </div>
        <div className="text-[10px] font-mono dark:text-slate-300 text-slate-300 dark:bg-slate-950 bg-slate-900 p-2 rounded border dark:border-slate-800 border-slate-700 break-words max-h-24 overflow-y-auto">
          <span className="dark:text-slate-500 text-slate-400">ON</span> {data.condition}
        </div>
      </div>
      <Handle type="target" position={targetPosition || Position.Left} className="w-3 h-3 dark:!bg-slate-950 !bg-slate-800 dark:!border-slate-600 !border-slate-700" />
      <Handle type="source" position={sourcePosition || Position.Right} className="w-3 h-3 dark:!bg-slate-950 !bg-slate-800 dark:!border-slate-600 !border-slate-700" />
    </div>
  );
});

JoinNode.displayName = 'JoinNode';

// FILTER NODE (Orange/Amber)
export const FilterNode = memo(({ data, selected, targetPosition, sourcePosition }: CustomNodeProps) => {
  return (
    <div className={`w-64 rounded-lg dark:bg-slate-900 bg-slate-800 border-2 ${selected ? 'border-orange-500 shadow-2xl scale-102' : 'dark:border-orange-500/50 border-orange-500/30'} transition-all duration-200 shadow-xl overflow-hidden`}>
      <div className="dark:bg-orange-500/10 bg-orange-50/50 px-3 py-1.5 flex items-center border-b dark:border-orange-500/30 border-orange-500/15">
        <div className="w-2 h-2 rounded-full bg-orange-500 mr-2"></div>
        <span className="text-[10px] font-bold uppercase dark:text-orange-400 text-orange-600 tracking-wider">
          {data.title || 'FilterNode'}
        </span>
      </div>
      <div className="p-3 dark:bg-slate-950/40 bg-slate-900/20">
        <div className="text-[10px] font-mono dark:text-slate-300 text-slate-300 dark:bg-slate-950 bg-slate-900 p-2 rounded border dark:border-slate-800 border-slate-700 break-words max-h-24 overflow-y-auto">
          {data.condition || 'N/A'}
        </div>
      </div>
      <Handle type="target" position={targetPosition || Position.Left} className="w-3 h-3 dark:!bg-slate-950 !bg-slate-800 dark:!border-slate-600 !border-slate-700" />
      <Handle type="source" position={sourcePosition || Position.Right} className="w-3 h-3 dark:!bg-slate-950 !bg-slate-800 dark:!border-slate-600 !border-slate-700" />
    </div>
  );
});

FilterNode.displayName = 'FilterNode';

// GROUP BY NODE (Pink)
export const GroupByNode = memo(({ data, selected, targetPosition, sourcePosition }: CustomNodeProps) => {
  return (
    <div className={`w-64 rounded-lg dark:bg-slate-900 bg-slate-800 border-2 ${selected ? 'border-pink-500 shadow-2xl scale-102' : 'dark:border-pink-500/50 border-pink-500/30'} transition-all duration-200 shadow-xl overflow-hidden`}>
      <div className="dark:bg-pink-500/10 bg-pink-50/50 px-3 py-1.5 flex items-center border-b dark:border-pink-500/30 border-pink-500/15">
        <div className="w-2 h-2 rounded-full bg-pink-500 mr-2"></div>
        <span className="text-[10px] font-bold uppercase dark:text-pink-400 text-pink-600 tracking-wider">GroupByNode</span>
      </div>
      <div className="p-3 dark:bg-slate-950/40 bg-slate-900/20">
        <div className="text-[10px] font-mono dark:text-slate-300 text-slate-300 dark:bg-slate-950 bg-slate-900 p-2 rounded border dark:border-slate-800 border-slate-700 break-words">
          {data.columns}
        </div>
      </div>
      <Handle type="target" position={targetPosition || Position.Left} className="w-3 h-3 dark:!bg-slate-950 !bg-slate-800 dark:!border-slate-600 !border-slate-700" />
      <Handle type="source" position={sourcePosition || Position.Right} className="w-3 h-3 dark:!bg-slate-950 !bg-slate-800 dark:!border-slate-600 !border-slate-700" />
    </div>
  );
});

GroupByNode.displayName = 'GroupByNode';

// HAVING NODE (Rose)
export const HavingNode = memo(({ data, selected, targetPosition, sourcePosition }: CustomNodeProps) => {
  return (
    <div className={`w-64 rounded-lg dark:bg-slate-900 bg-slate-800 border-2 ${selected ? 'border-rose-500 shadow-2xl scale-102' : 'dark:border-rose-500/50 border-rose-500/30'} transition-all duration-200 shadow-xl overflow-hidden`}>
      <div className="dark:bg-rose-500/10 bg-rose-50/50 px-3 py-1.5 flex items-center border-b dark:border-rose-500/30 border-rose-500/15">
        <div className="w-2 h-2 rounded-full bg-rose-500 mr-2"></div>
        <span className="text-[10px] font-bold uppercase dark:text-rose-400 text-rose-600 tracking-wider">HavingNode</span>
      </div>
      <div className="p-3 dark:bg-slate-950/40 bg-slate-900/20">
        <div className="text-[10px] font-mono dark:text-slate-300 text-slate-300 dark:bg-slate-950 bg-slate-900 p-2 rounded border dark:border-slate-800 border-slate-700 break-words">
          {data.condition}
        </div>
      </div>
      <Handle type="target" position={targetPosition || Position.Left} className="w-3 h-3 dark:!bg-slate-950 !bg-slate-800 dark:!border-slate-600 !border-slate-700" />
      <Handle type="source" position={sourcePosition || Position.Right} className="w-3 h-3 dark:!bg-slate-950 !bg-slate-800 dark:!border-slate-600 !border-slate-700" />
    </div>
  );
});

HavingNode.displayName = 'HavingNode';

// SORT NODE (Teal)
export const SortNode = memo(({ data, selected, targetPosition, sourcePosition }: CustomNodeProps) => {
  return (
    <div className={`w-64 rounded-lg dark:bg-slate-900 bg-slate-800 border-2 ${selected ? 'border-teal-500 shadow-2xl scale-102' : 'dark:border-teal-500/50 border-teal-500/30'} transition-all duration-200 shadow-xl overflow-hidden`}>
      <div className="dark:bg-teal-500/10 bg-teal-50/50 px-3 py-1.5 flex items-center border-b dark:border-teal-500/30 border-teal-500/15">
        <div className="w-2 h-2 rounded-full bg-teal-500 mr-2"></div>
        <span className="text-[10px] font-bold uppercase dark:text-teal-400 text-teal-600 tracking-wider">SortNode</span>
      </div>
      <div className="p-3 dark:bg-slate-950/40 bg-slate-900/20">
        <div className="text-[10px] font-mono dark:text-slate-300 text-slate-300 dark:bg-slate-950 bg-slate-900 p-2 rounded border dark:border-slate-800 border-slate-700 break-words">
          {data.details}
        </div>
      </div>
      <Handle type="target" position={targetPosition || Position.Left} className="w-3 h-3 dark:!bg-slate-950 !bg-slate-800 dark:!border-slate-600 !border-slate-700" />
      <Handle type="source" position={sourcePosition || Position.Right} className="w-3 h-3 dark:!bg-slate-950 !bg-slate-800 dark:!border-slate-600 !border-slate-700" />
    </div>
  );
});

SortNode.displayName = 'SortNode';

// LIMIT NODE (Cyan)
export const LimitNode = memo(({ data, selected, targetPosition, sourcePosition }: CustomNodeProps) => {
  return (
    <div className={`w-64 rounded-lg dark:bg-slate-900 bg-slate-800 border-2 ${selected ? 'border-cyan-500 shadow-2xl scale-102' : 'dark:border-cyan-500/50 border-cyan-500/30'} transition-all duration-200 shadow-xl overflow-hidden`}>
      <div className="dark:bg-cyan-500/10 bg-cyan-50/50 px-3 py-1.5 flex items-center border-b dark:border-cyan-500/30 border-cyan-500/15">
        <div className="w-2 h-2 rounded-full bg-cyan-500 mr-2"></div>
        <span className="text-[10px] font-bold uppercase dark:text-cyan-400 text-cyan-600 tracking-wider">LimitNode</span>
      </div>
      <div className="p-3 dark:bg-slate-950/40 bg-slate-900/20">
        <div className="text-[10px] font-mono dark:text-slate-300 text-slate-300 dark:bg-slate-950 bg-slate-900 p-2 rounded border dark:border-slate-800 border-slate-700 break-words">
          {data.details}
        </div>
      </div>
      <Handle type="target" position={targetPosition || Position.Left} className="w-3 h-3 dark:!bg-slate-950 !bg-slate-800 dark:!border-slate-600 !border-slate-700" />
      <Handle type="source" position={sourcePosition || Position.Right} className="w-3 h-3 dark:!bg-slate-950 !bg-slate-800 dark:!border-slate-600 !border-slate-700" />
    </div>
  );
});

LimitNode.displayName = 'LimitNode';

// CONSTANT NODE (Slate)
export const ConstantNode = memo(({ data, selected, targetPosition, sourcePosition }: CustomNodeProps) => {
  return (
    <div className={`w-64 rounded-lg dark:bg-slate-900 bg-slate-800 border-2 ${selected ? 'border-slate-450 shadow-2xl scale-102' : 'dark:border-slate-500/50 border-slate-700'} transition-all duration-200 shadow-xl overflow-hidden`}>
      <div className="dark:bg-slate-9000/10 bg-slate-900 px-3 py-1.5 flex items-center border-b dark:border-slate-500/30 border-slate-700">
        <div className="w-2 h-2 rounded-full bg-slate-9000 mr-2"></div>
        <span className="text-[10px] font-bold uppercase dark:text-slate-400 text-slate-300 tracking-wider">
          {data.title || 'ConstantNode'}
        </span>
      </div>
      <div className="p-3 dark:bg-slate-950/40 bg-slate-900/20">
        <div className="text-[10px] font-mono dark:text-slate-400 text-slate-300 dark:bg-slate-950 bg-slate-900 p-2 rounded border dark:border-slate-800 border-slate-700 break-words">
          {data.details || 'Constant Expressions Only'}
        </div>
      </div>
      <Handle type="target" position={targetPosition || Position.Left} className="w-3 h-3 dark:!bg-slate-950 !bg-slate-800 dark:!border-slate-600 !border-slate-700" />
      <Handle type="source" position={sourcePosition || Position.Right} className="w-3 h-3 dark:!bg-slate-950 !bg-slate-800 dark:!border-slate-600 !border-slate-700" />
    </div>
  );
});

ConstantNode.displayName = 'ConstantNode';

// RESULT NODE (Emerald Green)
export const ResultNode = memo(({ data, selected, targetPosition, sourcePosition }: CustomNodeProps) => {
  return (
    <div className={`w-64 rounded-lg dark:bg-slate-900 bg-slate-800 border-2 ${selected ? 'border-emerald-500 shadow-2xl scale-102' : 'dark:border-emerald-500/50 border-emerald-500/30'} transition-all duration-200 shadow-2xl overflow-hidden`}>
      <div className="dark:bg-emerald-500/10 bg-emerald-50/50 px-3 py-1.5 flex items-center border-b dark:border-emerald-500/30 border-emerald-500/15">
        <div className="w-2 h-2 rounded-full bg-emerald-500 mr-2"></div>
        <span className="text-[10px] font-bold uppercase dark:text-emerald-400 text-emerald-600 tracking-wider">ResultNode</span>
      </div>
      <div className="p-3 dark:bg-slate-950/40 bg-slate-900/20">
        <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
          {data.columns && data.columns.length > 0 ? (
            data.columns.map((col: any, idx: number) => (
              <div key={idx} className="flex flex-col dark:bg-slate-950 bg-slate-900 p-1.5 rounded border dark:border-slate-800 border-slate-700 text-[10px] font-mono">
                <span className="dark:text-slate-300 text-slate-300 break-all">{col.name}</span>
                {col.alias && (
                  <span className="text-[9px] dark:text-emerald-400 text-emerald-600 font-semibold mt-0.5">
                    as {col.alias}
                  </span>
                )}
              </div>
            ))
          ) : (
            <div className="text-xs text-slate-500 italic p-1">No columns projected</div>
          )}
        </div>
      </div>
      <Handle type="target" position={targetPosition || Position.Left} className="w-3 h-3 dark:!bg-slate-950 !bg-slate-800 dark:!border-slate-600 !border-slate-700" />
      <Handle type="source" position={sourcePosition || Position.Right} className="w-3 h-3 dark:!bg-slate-950 !bg-slate-800 dark:!border-slate-600 !border-slate-700" />
    </div>
  );
});

ResultNode.displayName = 'ResultNode';

// ALL CUSTOM NODES MAPPED FOR REACT FLOW
export const nodeTypes = {
  tableNode: TableNode,
  joinNode: JoinNode,
  filterNode: FilterNode,
  groupByNode: GroupByNode,
  havingNode: HavingNode,
  sortNode: SortNode,
  limitNode: LimitNode,
  constantNode: ConstantNode,
  resultNode: ResultNode,
};
