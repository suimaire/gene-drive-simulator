import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';

// 빌드 결과(dist/index.html)는 모든 스크립트와 스타일이 한 파일에 들어가므로
// 서버 없이 파일을 직접 열어도 오프라인으로 실행된다.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/gene-drive-simulator/' : '/',
  plugins: [viteSingleFile()],
  server: { port: 5173, strictPort: false },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
}));
