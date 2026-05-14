export type LogLevel = "debug" | "info" | "warn" | "error";

export class Logger {
  constructor(private readonly scope: string) {}

  debug(message: string, meta?: unknown): void {
    this.write("debug", message, meta);
  }

  info(message: string, meta?: unknown): void {
    this.write("info", message, meta);
  }

  warn(message: string, meta?: unknown): void {
    this.write("warn", message, meta);
  }

  error(message: string, meta?: unknown): void {
    this.write("error", message, meta);
  }

  private write(level: LogLevel, message: string, meta?: unknown): void {
    const record = {
      at: new Date().toISOString(),
      level,
      scope: this.scope,
      message,
      ...(meta === undefined ? {} : { meta })
    };
    process.stderr.write(`${JSON.stringify(record)}\n`);
  }
}

