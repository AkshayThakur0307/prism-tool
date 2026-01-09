// Cloudflare Pages Function handler
export const onRequest = async (context: { request: Request; env: { VITE_JIRA_DOMAIN: string } }) => {
    const { request, env } = context;
    const url = new URL(request.url);

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

    // Extract the target path
    const targetPath = url.pathname.replace(/^\/jira-api/, '');

    if (!env.VITE_JIRA_DOMAIN) {
        return new Response(JSON.stringify({ error: "VITE_JIRA_DOMAIN environment variable is not set in Cloudflare." }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
        });
    }

    const targetDomain = env.VITE_JIRA_DOMAIN.startsWith('http')
        ? env.VITE_JIRA_DOMAIN
        : `https://${env.VITE_JIRA_DOMAIN}`;

    const targetUrl = new URL(targetPath, targetDomain).toString();

    // Prepare headers - clone original then clean up
    const newHeaders = new Headers(request.headers);
    newHeaders.delete('host');
    newHeaders.delete('origin');
    newHeaders.delete('referer');

    // Set Jira specific security bypasses
    newHeaders.set('X-Atlassian-Token', 'no-check');

    // Create a new request configuration
    const fetchOptions: RequestInit = {
        method: request.method,
        headers: newHeaders,
        redirect: 'follow',
    };

    // Only add body for non-GET/HEAD requests
    if (request.method !== "GET" && request.method !== "HEAD") {
        fetchOptions.body = await request.arrayBuffer();
    }

    try {
        const response = await fetch(targetUrl, fetchOptions);

        // Cloned response to add CORS headers
        const newResponse = new Response(response.body, response);
        newResponse.headers.set('Access-Control-Allow-Origin', '*');
        newResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        newResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Atlassian-Token');

        return newResponse;
    } catch (err: any) {
        return new Response(JSON.stringify({ error: "Proxy error", details: err.message }), {
            status: 502,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            }
        });
    }
};
