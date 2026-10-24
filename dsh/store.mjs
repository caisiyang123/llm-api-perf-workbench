/**
 * Local persistence for the workbench.
 *
 * Everything lives under the DSH data directory configured in
 * `cordis.patch.yml` (`dshHomePath('llm-api-perf-workbench')`), never inside a
 * user workspace. Uninstalling the plugin must not delete these files.
 *
 * Layout:
 *   targets.json                     target endpoints + API keys (mode 0600)
 *   runs/<runId>/meta.json           plan, status, round summaries
 *   runs/<runId>/samples.ndjson      one line per request (no prompt/response text)
 *   runs/<runId>/parity.ndjson       one line per A/B pair, including answer text
 *                                    (consistency runs only; local evidence, 0600)
 *   runs/<runId>/plan.ndjson         one line per item, including answer text
 *                                    (plan runs only; local evidence, 0600)
 *
 * Writes are atomic (tmp + rename) so a crash cannot leave a half-written JSON.
 */

import { mkdir, readFile, writeFile, rename, readdir, chmod, appendFile } from 'node:fs/promises';
import { join } from 'node:path';

const OWNER_ONLY = 0o600;
const RUN_ID = /^[A-Za-z0-9-]{8,64}$/;

export function createStore(root) {
  const targetsPath = join(root, 'targets.json');
  const runsDir = join(root, 'runs');

  async function ensureDirs() {
    await mkdir(root, { recursive: true, mode: 0o700 });
    await mkdir(runsDir, { recursive: true, mode: 0o700 });
  }

  async function readJson(path, fallback) {
    try {
      return JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return fallback;
      throw error;
    }
  }

  async function writeJsonAtomic(path, value) {
    await mkdir(join(path, '..'), { recursive: true, mode: 0o700 });
    const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: OWNER_ONLY });
    await rename(tmp, path);
    try {
      await chmod(path, OWNER_ONLY);
    } catch {
      /* best effort on filesystems without POSIX modes */
    }
  }

  function assertRunId(runId) {
    if (typeof runId !== 'string' || !RUN_ID.test(runId)) throw new Error('非法运行 ID');
  }

  return {
    root,
    runsDir,

    async readTargets() {
      const data = await readJson(targetsPath, { version: 1, targets: [] });
      return Array.isArray(data.targets) ? data.targets : [];
    },

    async writeTargets(targets) {
      await ensureDirs();
      await writeJsonAtomic(targetsPath, { version: 1, updated_at: new Date().toISOString(), targets });
    },

    async listRuns() {
      await ensureDirs();
      let entries;
      try {
        entries = await readdir(runsDir, { withFileTypes: true });
      } catch {
        return [];
      }
      const runs = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const meta = await readJson(join(runsDir, entry.name, 'meta.json'), null);
        if (meta && meta.id === entry.name) runs.push(meta);
      }
      return runs.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    },

    async readRun(runId) {
      assertRunId(runId);
      return readJson(join(runsDir, runId, 'meta.json'), null);
    },

    async writeRun(run) {
      assertRunId(run.id);
      await ensureDirs();
      await mkdir(join(runsDir, run.id), { recursive: true, mode: 0o700 });
      await writeJsonAtomic(join(runsDir, run.id, 'meta.json'), run);
    },

    async appendSample(runId, record) {
      assertRunId(runId);
      const path = join(runsDir, runId, 'samples.ndjson');
      await appendFile(path, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: OWNER_ONLY });
    },

    async appendParityRow(runId, record) {
      assertRunId(runId);
      const path = join(runsDir, runId, 'parity.ndjson');
      await appendFile(path, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
    },

    async appendPlanRow(runId, record) {
      assertRunId(runId);
      const path = join(runsDir, runId, 'plan.ndjson');
      await appendFile(path, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
    },

    async readPlanRows(runId) {
      assertRunId(runId);
      let content;
      try {
        content = await readFile(join(runsDir, runId, 'plan.ndjson'), 'utf8');
      } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
      }
      const rows = [];
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        try {
          rows.push(JSON.parse(line));
        } catch {
          // Skip a torn final line; earlier rows are still valid evidence.
        }
      }
      return rows;
    },

    async readParityRows(runId) {
      assertRunId(runId);
      let content;
      try {
        content = await readFile(join(runsDir, runId, 'parity.ndjson'), 'utf8');
      } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
      }
      const rows = [];
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        try {
          rows.push(JSON.parse(line));
        } catch {
          /* a truncated tail line is expected after a crash */
        }
      }
      return rows;
    },

    async deleteRun(runId) {
      assertRunId(runId);
      const dir = join(runsDir, runId);
      const { rm } = await import('node:fs/promises');
      await rm(dir, { recursive: true, force: true });
    },
  };
}