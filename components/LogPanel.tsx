
import React, { useState } from 'react';
import { LogEntry } from '../utils/logger';
import { TrashIcon } from './icons';

interface LogPanelProps {
  logs: LogEntry[];
  onClear: () => void;
}

const LogDetail: React.FC<{ data: any }> = ({ data }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  if (!data) return null;

  return (
    <div>
      <button onClick={() => setIsExpanded(!isExpanded)} className="text-xs text-indigo-400 hover:underline mt-1">
        {isExpanded ? 'Hide Details' : 'Show Details'}
      </button>
      {isExpanded && (
        <pre className="mt-1 p-2 bg-gray-900 text-xs text-gray-300 rounded overflow-auto max-h-60">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
};

const LogPanel: React.FC<LogPanelProps> = ({ logs, onClear }) => {
  const [isOpen, setIsOpen] = useState(false);

  const getLevelColor = (level: LogEntry['level']) => {
    switch (level) {
      case 'ERROR': return 'text-red-400';
      case 'API_REQUEST': return 'text-cyan-400';
      case 'API_RESPONSE': return 'text-green-400';
      case 'INFO':
      default:
        return 'text-gray-400';
    }
  };

  return (
    <>
      <div className="fixed bottom-4 right-4 z-50">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="bg-gray-700 hover:bg-indigo-600 text-white font-bold py-3 px-4 rounded-full shadow-lg transition-transform duration-200 hover:scale-110"
          aria-label="Toggle logs"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
        </button>
      </div>

      {isOpen && (
        <div className="fixed bottom-0 left-0 right-0 h-1/3 bg-gray-800 border-t-2 border-indigo-500 shadow-2xl z-40 flex flex-col p-2 animate-slide-up">
          <div className="flex justify-between items-center p-2 border-b border-gray-700">
            <h3 className="text-lg font-bold text-white">Application Logs</h3>
            <button onClick={onClear} className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white text-sm font-bold py-1 px-3 rounded-md">
              <TrashIcon className="w-4 h-4" />
              Clear
            </button>
          </div>
          <div className="flex-grow overflow-y-auto p-2 font-mono text-sm">
            {logs.length === 0 && <div className="text-gray-500">No log entries yet.</div>}
            {logs.map((log, index) => (
              <div key={index} className="border-b border-gray-700/50 py-1.5">
                <span className="text-gray-500 mr-2">{log.timestamp}</span>
                <span className={`font-bold mr-2 ${getLevelColor(log.level)}`}>[{log.level}]</span>
                <span className="text-gray-200">{log.message}</span>
                <LogDetail data={log.data} />
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
};

export default LogPanel;
