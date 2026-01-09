
export interface Env {
    ASSETS: Fetcher;
    VITE_JIRA_DOMAIN: string;
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);

        // Proxy Jira API requests
        if (url.pathname.startsWith('/jira-api')) {
            const targetPath = url.pathname.replace(/^\/jira-api/, '');

            if (!env.VITE_JIRA_DOMAIN) {
                return new Response(JSON.stringify({ error: "VITE_JIRA_DOMAIN not set" }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                });
            }

            const targetDomain = env.VITE_JIRA_DOMAIN.startsWith('http')
                ? env.VITE_JIRA_DOMAIN
                : `https://${env.VITE_JIRA_DOMAIN}`;

            const targetUrl = new URL(targetPath, targetDomain).toString();

            // Handle CORS preflight
            if (request.method === "OPTIONS") {
                return new Response(null, {
                    headers: {
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Atlassian-Token",
                        "Access-Control-Max-Age": "86400",
                    },
                });
            }

            const newHeaders = new Headers(request.headers);
            newHeaders.delete('host');
            newHeaders.delete('origin');
            newHeaders.delete('referer');
            newHeaders.set('X-Atlassian-Token', 'no-check');

            const fetchOptions: RequestInit = {
                method: request.method,
                headers: newHeaders,
                redirect: 'follow',
            };

            if (request.method !== "GET" && request.method !== "HEAD") {
                fetchOptions.body = await request.arrayBuffer();
            }

            try {
                const response = await fetch(targetUrl, fetchOptions);
                const newResponse = new Response(response.body, response);
                newResponse.headers.set('Access-Control-Allow-Origin', '*');
                newResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
                newResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Atlassian-Token');
                return newResponse;
            } catch (err: any) {
                return new Response(JSON.stringify({ error: "Proxy error", details: err.message }), {
                    status: 502,
                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                });
            }
        }

        // Default: Serve static assets
        return env.ASSETS.fetch(request);
    },
};
