interface SecurityConfig {
  maskLogsInProduction: boolean;
  allowedLogLevels: string[];
  sanitizeBeforeLog: boolean;
  maxLogFileSize: number;
}

class SecurityConfigManager {
  private config: SecurityConfig;

  constructor() {
    const env = process.env.NODE_ENV || 'development';
    this.config = {
      maskLogsInProduction: env === 'production',
      allowedLogLevels: ['info', 'warn', 'error'],
      sanitizeBeforeLog: process.env.LOG_MASK_SENSITIVE !== 'false',
      maxLogFileSize: 10 * 1024 * 1024 // 10MB
    };
  }

  getShouldMaskLogs(): boolean {
    return this.config.sanitizeBeforeLog;
  }

  getLogLevel(): string {
    return process.env.LOG_LEVEL || 'info';
  }

  isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  }

  getAllowedLogLevels(): string[] {
    return this.config.allowedLogLevels;
  }

  getMaxLogFileSize(): number {
    return this.config.maxLogFileSize;
  }
}

export default new SecurityConfigManager();