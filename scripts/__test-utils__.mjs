import { spawn } from 'node:child_process';
import path from 'node:path';

const skillRoot = path.resolve(import.meta.dirname, '..');
const exporterScriptPath = path.join(skillRoot, 'scripts', 'export-testcases.ps1');

export { skillRoot, exporterScriptPath };

export function spawnAsync(command, args, options = {}) {
  const resolvedOptions = {
    cwd: options.cwd ?? skillRoot,
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
  };

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, resolvedOptions);

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

export function runPowerShell(args) {
  return spawnAsync('powershell', ['-ExecutionPolicy', 'Bypass', ...args]);
}

export function runExportPowerShellCommand(command) {
  return spawnAsync('powershell', ['-ExecutionPolicy', 'Bypass', '-Command', command]);
}

export function runExportToDir(inputJsonText, outputDir, extraArgs = []) {
  return runPowerShell([
    '-File', exporterScriptPath,
    '-InputJsonText', inputJsonText,
    '-OutputDir', outputDir,
    ...extraArgs,
  ]);
}

export async function readZipEntry(zipPath, entryPath) {
  const escapedZip = zipPath.replace(/'/g, "''");
  const escapedEntry = entryPath.replace(/'/g, "''");
  const command = [
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    `$zip = [System.IO.Compression.ZipFile]::OpenRead('${escapedZip}')`,
    `try { $entry = $zip.GetEntry('${escapedEntry}'); if ($null -eq $entry) { throw 'entry not found' }; $reader = New-Object System.IO.StreamReader($entry.Open(), [System.Text.Encoding]::UTF8); try { $text = $reader.ReadToEnd(); [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($text)) } finally { $reader.Dispose() } } finally { $zip.Dispose() }`,
  ].join('; ');

  const result = await runExportPowerShellCommand(command);
  if (result.code !== 0) {
    throw new Error(`readZipEntry failed:\nSTDOUT:${result.stdout}\nSTDERR:${result.stderr}`);
  }
  return Buffer.from(result.stdout.trim(), 'base64').toString('utf8');
}
