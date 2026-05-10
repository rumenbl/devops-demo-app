import express, { Request, Response } from 'express';
import os from 'os';
import fs from 'fs';
import path from 'path';
import checkDiskSpace from 'check-disk-space';

const app = express();
const ROOT = path.resolve(__dirname, fs.existsSync(path.join(__dirname, 'views')) ? '.' : '..');

app.set('view engine', 'ejs');
app.set('views', path.join(ROOT, 'views'));
app.use(express.static(path.join(ROOT, 'public')));
app.set('trust proxy', 1);

// ---------------------------------------------------------------------------
// Runtime detection
// ---------------------------------------------------------------------------

const isKube = !!process.env.KUBERNETES_SERVICE_HOST;
const isContainer = fs.existsSync('/.dockerenv') || isKube;
const hasAppInsights = !!process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`, `${s}s`]
    .filter(Boolean)
    .join(' ');
}

interface DiskStats {
  path: string;
  totalGB: string;
  freeGB: string;
  usedGB: string;
  usedPct: number;
}

async function getDiskStats(): Promise<DiskStats | null> {
  const diskPath = process.platform === 'win32' ? 'C:\\' : '/';
  try {
    const info = await checkDiskSpace(diskPath);
    return {
      path: diskPath,
      totalGB: (info.size / 1024 ** 3).toFixed(2),
      freeGB: (info.free / 1024 ** 3).toFixed(2),
      usedGB: ((info.size - info.free) / 1024 ** 3).toFixed(2),
      usedPct: Math.round(((info.size - info.free) / info.size) * 100),
    };
  } catch {
    return null;
  }
}

interface NetworkInterface {
  name: string;
  family: string;
  address: string;
  cidr: string | null;
}

function getNetworkInfo(): NetworkInterface[] {
  const ifaces = os.networkInterfaces();
  const results: NetworkInterface[] = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const addr of addrs ?? []) {
      if (!addr.internal) {
        results.push({ name, family: addr.family, address: addr.address, cidr: addr.cidr ?? null });
      }
    }
  }
  return results;
}

const FILTER_KEYS = /SECRET|PWD|PASSWORD|KEY|CONNSTR|PATH|NPM_/i;

function getFilteredEnv(): [string, string][] {
  return Object.entries(process.env)
    .filter(([k]) => !FILTER_KEYS.test(k))
    .sort(([a], [b]) => a.localeCompare(b)) as [string, string][];
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.get('/healthz', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

app.get('/', async (req: Request, res: Response) => {
  const cpus = os.cpus();
  const disk = await getDiskStats();
  const accessedUrl = `${req.protocol}://${req.headers.host}${req.originalUrl}`;

  res.render('index', {
    isContainer,
    isKube,
    hasAppInsights,
    hostname: os.hostname(),
    uptimeHuman: formatUptime(Math.floor(os.uptime())),
    osType: os.type(),
    osRelease: os.release(),
    arch: os.arch(),
    cpuCount: cpus.length,
    cpuModel: cpus[0]?.model ?? 'Unknown',
    totalMemMB: (os.totalmem() / 1024 / 1024).toFixed(0),
    freeMemMB: (os.freemem() / 1024 / 1024).toFixed(0),
    nodeVersion: process.version,
    releaseInfo: process.env.RELEASE_INFO ?? null,
    networkInterfaces: getNetworkInfo(),
    disk,
    accessedUrl,
    envVars: getFilteredEnv(),
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
