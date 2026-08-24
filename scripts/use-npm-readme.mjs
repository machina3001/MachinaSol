import { copyFileSync, existsSync } from 'node:fs';

const backup = '.github-readme-backup.tmp';
if (!existsSync(backup)) {
  copyFileSync('README.md', backup);
}
copyFileSync('scripts/npm-readme.md', 'README.md');
