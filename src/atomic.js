import fs from 'node:fs';

/** Write JSON via a temp file + rename so a crash can never leave a half-written file. */
export function writeJsonAtomic(file, data, mode = 0o644) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode });
  fs.renameSync(tmp, file);
}
