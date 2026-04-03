import { execSync } from 'child_process';
try {
  console.log(execSync('npx vitest run src-react/src/components/symbol-editor/kicad-import.test.ts', { encoding: 'utf-8' }));
} catch(e) {
  console.log(e.stdout);
  console.log(e.stderr);
}
