import path from 'path';
import fs from 'fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');

  // fallback: try reading mcp_config.json
  try {
    const mcpPath = path.resolve(__dirname, 'mcp_config.json');
    if (fs.existsSync(mcpPath)) {
      const mcpConfig = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));
      const jiraEnv = mcpConfig?.mcpServers?.['jira-mcp']?.env;

      if (jiraEnv) {
        console.log("Loading Jira credentials from mcp_config.json...");
        if (!env.VITE_JIRA_DOMAIN && jiraEnv.JIRA_URL) env.VITE_JIRA_DOMAIN = jiraEnv.JIRA_URL;
        if (!env.VITE_JIRA_EMAIL && jiraEnv.JIRA_USERNAME) env.VITE_JIRA_EMAIL = jiraEnv.JIRA_USERNAME;
        if (!env.VITE_JIRA_API_TOKEN && jiraEnv.JIRA_API_TOKEN) env.VITE_JIRA_API_TOKEN = jiraEnv.JIRA_API_TOKEN;
      }
    }
  } catch (e) {
    console.warn("Failed to read mcp_config.json:", e);
  }

  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
      proxy: {
        '/jira-api': {
          target: env.VITE_JIRA_DOMAIN?.startsWith('http') ? env.VITE_JIRA_DOMAIN : `https://${env.VITE_JIRA_DOMAIN}`,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/jira-api/, ''),
          secure: false,
          headers: {
            'X-Atlassian-Token': 'no-check',
          },
          configure: (proxy, options) => {
            proxy.on('proxyReq', (proxyReq, req, res) => {
              proxyReq.setHeader('Origin', options.target as string);
              proxyReq.setHeader('Referer', options.target as string);
            });
          }
        }
      }
    },
    plugins: [react()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GROQ_API_KEY': JSON.stringify(env.GROQ_API_KEY),
      'process.env.SERPER_API_KEY': JSON.stringify(env.SERPER_API_KEY),
      'process.env.VITE_JIRA_DOMAIN': JSON.stringify(env.VITE_JIRA_DOMAIN),
      'process.env.VITE_JIRA_EMAIL': JSON.stringify(env.VITE_JIRA_EMAIL),
      'process.env.VITE_JIRA_API_TOKEN': JSON.stringify(env.VITE_JIRA_API_TOKEN),
      'process.env.VITE_JIRA_PROJECT_KEY': JSON.stringify(env.VITE_JIRA_PROJECT_KEY)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
  };
});
