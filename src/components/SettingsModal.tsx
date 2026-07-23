import React, { useState, useEffect } from 'react';
import { X, Keyboard, RotateCcw, Settings, Check, Command, Sparkles } from 'lucide-react';

export interface HotkeyBinding {
  id: string;
  label: string;
  description: string;
  category: 'Редактор' | 'Граф' | 'Общие';
  defaultKey: string;
}

export const DEFAULT_HOTKEYS: HotkeyBinding[] = [
  {
    id: 'visualize',
    label: 'Визуализировать SQL (Visualize)',
    description: 'Запустить парсинг и построить граф выполнения',
    category: 'Редактор',
    defaultKey: 'Ctrl+Enter'
  },
  {
    id: 'openFile',
    label: 'Открыть SQL файл с диска',
    description: 'Загрузить файл .sql или .txt в редактор',
    category: 'Редактор',
    defaultKey: 'Ctrl+O'
  },
  {
    id: 'saveFile',
    label: 'Сохранить SQL в файл',
    description: 'Скачать текущий запрос в файл .sql',
    category: 'Редактор',
    defaultKey: 'Ctrl+S'
  },
  {
    id: 'copySql',
    label: 'Скопировать SQL в буфер',
    description: 'Скопировать текст запроса',
    category: 'Редактор',
    defaultKey: 'Ctrl+Shift+C'
  },
  {
    id: 'toggleWrap',
    label: 'Перенос строк в редакторе',
    description: 'Включить/выключить перенос длинных строк',
    category: 'Редактор',
    defaultKey: 'Alt+W'
  },
  {
    id: 'openSnippets',
    label: 'Конструктор и сниппеты',
    description: 'Открыть окно готовых сниппетов и генератора SQL',
    category: 'Редактор',
    defaultKey: 'Ctrl+K'
  },
  {
    id: 'toggleMaximized',
    label: 'Полноэкранный режим редактора',
    description: 'Развернуть/свернуть редактор на весь экран',
    category: 'Редактор',
    defaultKey: 'Alt+F'
  },
  {
    id: 'toggleTheme',
    label: 'Переключить тему (Dark / Light)',
    description: 'Сменить темную и светлую тему интерфейса',
    category: 'Общие',
    defaultKey: 'Alt+T'
  },
  {
    id: 'toggleMiniMap',
    label: 'Показать / скрыть миникарту',
    description: 'Включить ли навигатоор-миникарту графа',
    category: 'Граф',
    defaultKey: 'Alt+M'
  },
  {
    id: 'exportGraph',
    label: 'Экспорт графа',
    description: 'Открыть меню экспорта в PNG, SVG, JSON, XML, Mermaid',
    category: 'Граф',
    defaultKey: 'Ctrl+E'
  }
];

const STORAGE_KEY = 'sql_visualizer_hotkeys_v1';

export function getSavedHotkeys(): Record<string, string> {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.error('Failed to load hotkeys', e);
  }
  const defaults: Record<string, string> = {};
  DEFAULT_HOTKEYS.forEach((h) => {
    defaults[h.id] = h.defaultKey;
  });
  return defaults;
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  theme: 'dark' | 'light';
  hotkeys: Record<string, string>;
  onUpdateHotkeys: (newHotkeys: Record<string, string>) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  theme,
  hotkeys,
  onUpdateHotkeys
}) => {
  const [listeningActionId, setListeningActionId] = useState<string | null>(null);

  useEffect(() => {
    if (!listeningActionId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Ignore standalone modifier keys
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
        return;
      }

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

      const updated = { ...hotkeys, [listeningActionId]: combo };
      onUpdateHotkeys(updated);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      setListeningActionId(null);
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [listeningActionId, hotkeys, onUpdateHotkeys]);

  if (!isOpen) return null;

  const handleResetDefaults = () => {
    const defaults: Record<string, string> = {};
    DEFAULT_HOTKEYS.forEach((h) => {
      defaults[h.id] = h.defaultKey;
    });
    onUpdateHotkeys(defaults);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(defaults));
    setListeningActionId(null);
  };

  const categories: ('Редактор' | 'Граф' | 'Общие')[] = ['Редактор', 'Граф', 'Общие'];

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-md p-4 sm:p-6 flex items-center justify-center animate-in fade-in duration-200">
      <div
        className={`w-full max-w-2xl border rounded-xl flex flex-col shadow-2xl overflow-hidden max-h-[90vh] transition-colors ${
          theme === 'dark'
            ? 'bg-slate-850 border-slate-700 text-slate-200'
            : 'bg-white border-slate-300 text-slate-800'
        }`}
      >
        {/* HEADER */}
        <div
          className={`flex items-center justify-between px-5 py-3.5 border-b shrink-0 ${
            theme === 'dark' ? 'bg-slate-800 border-slate-700' : 'bg-slate-100 border-slate-200'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <Settings className="w-5 h-5 text-blue-500" />
            <h2 className="font-bold text-base">Настройки и горячие клавиши</h2>
          </div>
          <button
            onClick={onClose}
            className={`p-1 rounded-md transition-colors ${
              theme === 'dark'
                ? 'hover:bg-slate-700 text-slate-400 hover:text-slate-200'
                : 'hover:bg-slate-200 text-slate-500 hover:text-slate-800'
            }`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* BODY */}
        <div className="flex-1 p-5 overflow-y-auto space-y-6">
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <p className={`text-xs ${theme === 'dark' ? 'text-slate-400' : 'text-slate-700 font-medium'}`}>
                Кликните по комбинации, чтобы назначить собственную горячую клавишу.
              </p>
              <button
                onClick={handleResetDefaults}
                className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border transition-colors ${
                  theme === 'dark'
                    ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-slate-100'
                    : 'bg-slate-100 border-slate-300 text-slate-900 font-bold hover:bg-slate-200 hover:text-slate-950'
                }`}
                title="Сбросить все хоткеи к исходным значениям"
              >
                <RotateCcw className="w-3.5 h-3.5 text-amber-500" />
                <span>Сбросить по умолчанию</span>
              </button>
            </div>

            {categories.map((cat) => {
              const items = DEFAULT_HOTKEYS.filter((h) => h.category === cat);
              if (items.length === 0) return null;

              return (
                <div key={cat} className="space-y-2">
                  <h3 className={`text-xs uppercase font-bold tracking-wider border-b pb-1 ${
                    theme === 'dark' ? 'text-slate-400 border-slate-700/50' : 'text-slate-900 border-slate-300'
                  }`}>
                    {cat}
                  </h3>
                  <div className="space-y-1.5">
                    {items.map((item) => {
                      const currentKey = hotkeys[item.id] || item.defaultKey;
                      const isListening = listeningActionId === item.id;

                      return (
                        <div
                          key={item.id}
                          className={`flex items-center justify-between p-2.5 rounded-lg border transition-all ${
                            isListening
                              ? 'border-amber-500 bg-amber-500/10'
                              : theme === 'dark'
                              ? 'bg-slate-800/40 border-slate-700/60 hover:bg-slate-800/80'
                              : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          <div className="pr-4">
                            <div className={`font-semibold text-xs ${
                              theme === 'dark' ? 'text-slate-100' : 'text-slate-900 font-bold'
                            }`}>
                              {item.label}
                            </div>
                            <div className={`text-[11px] ${
                              theme === 'dark' ? 'text-slate-400' : 'text-slate-700'
                            }`}>{item.description}</div>
                          </div>

                          <button
                            onClick={() => setListeningActionId(isListening ? null : item.id)}
                            className={`px-3 py-1.5 rounded font-mono text-xs font-bold border shadow-xs transition-all shrink-0 min-w-[100px] text-center ${
                              isListening
                                ? 'bg-amber-500 text-slate-900 border-amber-400 animate-pulse'
                                : theme === 'dark'
                                ? 'bg-slate-750 hover:bg-slate-700 border-slate-600 text-blue-400 hover:text-blue-300'
                                : 'bg-white hover:bg-slate-100 border-slate-300 text-blue-800 font-bold shadow-2xs'
                            }`}
                          >
                            {isListening ? 'Нажмите клавиши...' : currentKey}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* FOOTER */}
        <div
          className={`p-3.5 px-5 border-t flex items-center justify-end shrink-0 ${
            theme === 'dark' ? 'bg-slate-800 border-slate-700' : 'bg-slate-100 border-slate-200'
          }`}
        >
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs rounded-md shadow-sm transition-colors"
          >
            Готово
          </button>
        </div>
      </div>
    </div>
  );
};
