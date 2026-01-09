"use strict";
/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.jiraProxy = void 0;
const https_1 = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const node_fetch_1 = require("node-fetch");
// We can access environment variables via process.env 
// provided they are set via `firebase functions:config:set` or .env files
const JIRA_DOMAIN = process.env.VITE_JIRA_DOMAIN;
exports.jiraProxy = (0, https_1.onRequest)(async (request, response) => {
    // 1. CORS Preflight
    response.set("Access-Control-Allow-Origin", "*");
    if (request.method === "OPTIONS") {
        response.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE, PATCH");
        response.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Atlassian-Token");
        response.set("Access-Control-Max-Age", "86400");
        response.status(204).send("");
        return;
    }
    // 2. Validate Env
    if (!JIRA_DOMAIN) {
        logger.error("VITE_JIRA_DOMAIN is not set");
        response.status(500).json({ error: "VITE_JIRA_DOMAIN environment variable is not set in Firebase Functions." });
        return;
    }
    try {
        // 3. Construct Target URL
        // The request.url in Firebase Functions includes the full path (e.g. /jira-api/rest/api/...)
        // if rewritten from firebase.json.
        // However, sometimes it might be just the path.
        // We want to extract everything AFTER /jira-api/
        // We can rely on request.path which is the path part of the URL
        // e.g. /jira-api/rest/api/2/issue
        let targetPath = request.path;
        if (targetPath.startsWith("/jira-api")) {
            targetPath = targetPath.replace(/^\/jira-api/, "");
        }
        // Ensure domain has protocol
        const targetDomain = JIRA_DOMAIN.startsWith("http") ? JIRA_DOMAIN : `https://${JIRA_DOMAIN}`;
        // Combine. Note: targetPath usually starts with /
        const targetUrl = new URL(targetPath, targetDomain).toString();
        logger.info(`Proxying request to: ${targetUrl}`);
        // 4. Prepare Headers
        const newHeaders = {};
        const skipHeaders = ['host', 'origin', 'referer', 'content-length'];
        for (const [key, value] of Object.entries(request.headers)) {
            if (!skipHeaders.includes(key.toLowerCase())) {
                newHeaders[key] = value;
            }
        }
        // Jira specific
        newHeaders['X-Atlassian-Token'] = 'no-check';
        // 5. Fetch Options
        const fetchOptions = {
            method: request.method,
            headers: newHeaders,
            redirect: 'follow'
        };
        if (request.method !== 'GET' && request.method !== 'HEAD') {
            // request.rawBody is a Buffer in firebase-functions
            fetchOptions.body = request.rawBody;
        }
        // 6. Execute Fetch
        const jiraResponse = await (0, node_fetch_1.default)(targetUrl, fetchOptions);
        // 7. Send Response
        // Copy headers from Jira response
        jiraResponse.headers.forEach((value, key) => {
            // Skip some headers that might conflict or cause issues
            if (key.toLowerCase() !== 'content-encoding' && key.toLowerCase() !== 'content-length') {
                response.set(key, value);
            }
        });
        // Ensure CORS on response especially if fetch fails or for clarity
        response.set("Access-Control-Allow-Origin", "*");
        const buffer = await jiraResponse.buffer();
        response.status(jiraResponse.status).send(buffer);
    }
    catch (error) {
        logger.error("Proxy error", error);
        response.status(502).json({ error: "Proxy error", details: error.message });
    }
});
//# sourceMappingURL=index.js.map