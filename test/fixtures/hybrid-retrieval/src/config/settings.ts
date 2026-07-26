// Unrelated file: application configuration
export interface AppConfig {
  port: number;
  databaseUrl: string;
  debug: boolean;
}

export const defaultConfig: AppConfig = {
  port: 3000,
  databaseUrl: 'postgresql://localhost:5432/app',
  debug: false,
};
