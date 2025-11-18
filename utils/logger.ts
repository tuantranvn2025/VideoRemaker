// utils/logger.ts

export type LogLevel = 'INFO' | 'ERROR' | 'API_REQUEST' | 'API_RESPONSE';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: any;
}

type LogListener = (logs: LogEntry[]) => void;

class Logger {
  private logs: LogEntry[] = [];
  private listeners: LogListener[] = [];
  private MAX_LOGS = 200;

  add(level: LogLevel, message: string, data?: any) {
    const timestamp = new Date().toLocaleTimeString();
    const newEntry: LogEntry = { timestamp, level, message, data };
    
    this.logs = [newEntry, ...this.logs];
    if (this.logs.length > this.MAX_LOGS) {
      this.logs.splice(this.MAX_LOGS);
    }

    this.notifyListeners();
  }

  getLogs(): LogEntry[] {
    return this.logs;
  }

  clear() {
    this.logs = [];
    this.notifyListeners();
  }

  subscribe(listener: LogListener) {
    this.listeners.push(listener);
    // Unsubscribe function
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notifyListeners() {
    for (const listener of this.listeners) {
      listener([...this.logs]); // Pass a copy
    }
  }
}

// Export a singleton instance
export const appLogger = new Logger();
