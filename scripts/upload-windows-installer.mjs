import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { put } from '@vercel/blob';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagePath = path.join(projectRoot, 'electron', 'package.json');
const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
const installerPath = path.join(
  projectRoot,
  'release-installer',
  `Aetheris-AI-Setup-${packageJson.version}-x64.exe`
);

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  throw new Error('BLOB_READ_WRITE_TOKEN must be configured as a GitHub Actions secret.');
}

const installerInfo = await stat(installerPath);
if (!installerInfo.isFile() || installerInfo.size === 0) {
  throw new Error(`Installer file is missing or empty: ${installerPath}`);
}

const blob = await put(
  'downloads/Aetheris-AI-Setup-latest-x64.exe',
  createReadStream(installerPath),
  {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    contentType: 'application/vnd.microsoft.portable-executable',
    multipart: true
  }
);

console.log(`Uploaded Aetheris AI ${packageJson.version} installer to ${blob.downloadUrl}`);
