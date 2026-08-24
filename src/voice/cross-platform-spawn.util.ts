import { ChildProcess, SpawnOptions, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Checks if a path is a WSL UNC path (e.g. \\wsl$\Ubuntu\... or \\wsl.localhost\Ubuntu\...).
 */
export function isWslPath(p: string): boolean {
  return /^[\\/]{2}wsl(?:\$|\.localhost)[\\/]/i.test(p);
}

/**
 * Parses a WSL UNC path into the distribution name and the internal Linux path.
 * Example: \\wsl$\Ubuntu\root\.local\opt\piper\piper -> { distro: 'Ubuntu', linuxPath: '/root/.local/opt/piper/piper' }
 */
export function parseWslPath(p: string): { distro: string; linuxPath: string } | null {
  const match = p.match(/^[\\/]{2}wsl(?:\$|\.localhost)[\\/]([^\\/]+)[\\/](.*)$/i);
  if (!match) return null;
  const distro = match[1];
  const linuxPath = '/' + match[2].replace(/\\/g, '/');
  return { distro, linuxPath };
}

/**
 * Converts a Windows absolute path (e.g. C:\Users\DELL\...) or WSL UNC path to a Linux path inside WSL.
 */
export function toWslPath(windowsPath: string): string {
  if (isWslPath(windowsPath)) {
    return parseWslPath(windowsPath)?.linuxPath ?? windowsPath;
  }
  const match = windowsPath.match(/^([a-zA-Z]):[\\/](.*)$/);
  if (match) {
    const drive = match[1].toLowerCase();
    const rest = match[2].replace(/\\/g, '/');
    return `/mnt/${drive}/${rest}`;
  }
  return windowsPath.replace(/\\/g, '/');
}

/**
 * Spawns a process cross-platform.
 * On Windows, if binaryPath is a WSL UNC path, executes via `wsl.exe -d <distro> <linuxBinary> ...`
 * and automatically translates any argument paths into WSL paths.
 */
export function spawnCrossPlatform(
  binaryPath: string,
  args: string[],
  options: SpawnOptions = {},
): ChildProcess {
  if (process.platform === 'win32' && isWslPath(binaryPath)) {
    const wsl = parseWslPath(binaryPath);
    if (wsl) {
      const convertedArgs = args.map((arg) => {
        if (isWslPath(arg)) {
          return parseWslPath(arg)?.linuxPath ?? arg;
        }
        if (/^[a-zA-Z]:[\\/]/.test(arg)) {
          return toWslPath(arg);
        }
        return arg;
      });

      return spawn('wsl.exe', ['-d', wsl.distro, wsl.linuxPath, ...convertedArgs], options);
    }
  }

  return spawn(binaryPath, args, options);
}

/**
 * Validates that a file or model path exists.
 */
export function checkFileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Validates that an executable exists and is accessible.
 */
export function checkExecutable(p: string): boolean {
  try {
    if (process.platform === 'win32' && isWslPath(p)) {
      return checkFileExists(p);
    }
    if (path.isAbsolute(p)) {
      fs.accessSync(p, fs.constants.X_OK);
      return true;
    }
    return true;
  } catch {
    return false;
  }
}
