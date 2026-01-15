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
            // 'X-Atlassian-Token': 'no-check', // Handled by proxyReq
          },
          // DYNAMIC ROUTING: Check for X-Jira-Domain header
          router: (req) => {
            const customDomain = req.headers['x-jira-domain'];
            // console.log("[Proxy Router] Incoming Custom Domain Header:", customDomain);
            if (customDomain && typeof customDomain === 'string') {
              const target = customDomain.startsWith('http') ? customDomain : `https://${customDomain}`;
              // console.log("[Proxy Router] Routing to:", target);
              return target;
            }
            // Fallback to default
            return env.VITE_JIRA_DOMAIN?.startsWith('http') ? env.VITE_JIRA_DOMAIN : `https://${env.VITE_JIRA_DOMAIN}`;
          },
          configure: (proxy, options) => {
            proxy.on('proxyReq', (proxyReq, req: any, res) => {
              // Determine which target we are actually creating a request to
              const customDomain = req.headers['x-jira-domain'];
              let currentTarget = options.target as string;

              if (customDomain && typeof customDomain === 'string') {
                currentTarget = customDomain.startsWith('http') ? customDomain : `https://${customDomain}`;
              }

              // STRICT ORIGIN SANITIZATION: Remove trailing slash and paths
              // Origin must be strictly warning: protocol://hostname[:port]
              try {
                const urlObj = new URL(currentTarget);
                currentTarget = urlObj.origin; // This guarantees no path/slash
              } catch (e) {
                // If invalid, strip slash manually
                if (currentTarget.endsWith('/')) currentTarget = currentTarget.slice(0, -1);
              }

              console.log(`[Proxy Link] ${req.method} ${req.url} -> ${currentTarget} (Origin/Referer Set)`);

              proxyReq.setHeader('Origin', currentTarget);
              proxyReq.setHeader('Referer', currentTarget);

              // Remove internal header so Jira doesn't see it/complain
              proxyReq.removeHeader('X-Jira-Domain');

              // FORCE X-Atlassian-Token to be present and correct
              // This bypasses XSRF checks for script-based API calls
              proxyReq.setHeader('X-Atlassian-Token', 'no-check');

              // CLEANUP: Strip browser-specific headers that might trigger security
              proxyReq.removeHeader('Cookie');
              proxyReq.setHeader('User-Agent', 'JiraAgent/1.0 (Integration)');

              // DEBUG: Log all headers to ensure correctness
              const headers = proxyReq.getHeaders();
              console.log("[Proxy Headers] Outgoing Config:");
              Object.keys(headers).forEach(key => {
                if (key.toLowerCase() === 'authorization') {
                  console.log(`  ${key}: Basic [MASKED]`);
                } else {
                  console.log(`  ${key}: ${headers[key]}`);
                }
              });
            });
            proxy.on('error', (err, req, res) => {
              console.error('[Proxy Error]', err);
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
