
export const onRequest: PagesFunction<{ VITE_JIRA_DOMAIN: string }> = async (context) => {
    const { request, env } = context;
    const url = new URL(request.url);

    // Extract the target path
    // Example: /jira-api/rest/api/3/issue -> /rest/api/3/issue
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

    const targetUrl = new URL(targetPath, targetDomain);

    // Create a new request based on the original
    const newRequest = new Request(targetUrl.toString(), {
        method: request.method,
        headers: new Headers(request.headers),
        body: request.body,
        redirect: 'follow'
    });

    // Inject necessary headers for Jira
    newRequest.headers.set('X-Atlassian-Token', 'no-check');
    newRequest.headers.set('Origin', targetDomain);
    newRequest.headers.set('Referer', targetDomain);

    // Fetch from Jira
    try {
        const response = await fetch(newRequest);

        // Return the response with updated headers
        const newResponse = new Response(response.body, response);
        newResponse.headers.set('Access-Control-Allow-Origin', '*');

        return newResponse;
    } catch (err: any) {
        return new Response(JSON.stringify({ error: "Proxy error", details: err.message }), {
            status: 502,
            headers: { "Content-Type": "application/json" }
        });
    }
};
