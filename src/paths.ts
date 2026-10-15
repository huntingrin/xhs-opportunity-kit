import { homedir } from 'node:os';
import { join } from 'node:path';
export function defaultDatabasePath(): string {
  if (process.env.XHS_OPPORTUNITY_DATA_DIR) return join(process.env.XHS_OPPORTUNITY_DATA_DIR, 'opportunities.sqlite');
  const base = process.platform === 'win32' ? process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
    : process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support')
    : process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
  return join(base, 'xhs-opportunity-kit', 'opportunities.sqlite');
}
