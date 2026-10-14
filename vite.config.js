import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 阻止 Vite 对 onnxruntime-web 内部 .wasm 做 new URL() 静态替换
function onnxWasmPlugin() {
  let isBuild = false;
  return {
    name: 'onnx-wasm-no-transform',
    configResolved(cfg) {
      isBuild = cfg.command === 'build';
    },
    resolveId(id, importer) {
      if (!isBuild) return null;
      // onnxruntime-web 内部引用 .wasm 文件（通过 new URL('./x.wasm', import.meta.url)）
      // 返回带 \0 前缀的外部标记，阻止 Vite 将该 .wasm 当成资产去处理
      if (id.endsWith('.wasm') && importer && importer.includes('onnxruntime-web')) {
        return '\0onnx-wasm:' + id;
      }
      return null;
    },
    load(id) {
      if (id.startsWith('\0onnx-wasm:')) {
        // 返回一个假的 URL 字符串模块，让运行时基于 wasmPaths 自行拼路径
        return 'export default "";';
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [react(), onnxWasmPlugin()],
  root: '.',
  // onnxruntime-web 内部用动态 URL 加载 .wasm，不能被 Vite 预构建/静态分析破坏
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },
  server: {
    port: 3000,
    open: true,
    fs: {
      // 安全：禁止通过 URL 直接访问服务端源码 / 配置 / 数据等敏感文件
      // （Vite 默认允许按路径访问项目根内任意文件，这里显式封锁）
      deny: [
        'server.js',
        'package.json',
        'package-lock.json',
        'deploy.sh',
        'pruneB.js',
        '.env',
        '.env.*',
        'data/**',
        'scripts/**',
      ],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        xfwd: true,
        timeout: 120000
      },
      '/qr': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        timeout: 120000
      }
    }
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        // 确保 onnxruntime-web 不会被打散到多个 chunk 中
        manualChunks(id) {
          if (id.includes('onnxruntime-web')) {
            return 'onnxruntime';
          }
        },
      },
    },
  }
});
