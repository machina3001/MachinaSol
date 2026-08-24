import { copyFileSync, existsSync, unlinkSync } from 'node:fs';

const backup = '.github-readme-backup.tmp';
if (existsSync(backup)) {
  copyFileSync(backup, 'README.md');
  unlinkSync(backup);
}
