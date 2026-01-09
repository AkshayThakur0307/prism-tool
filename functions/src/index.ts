/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import fetch from "node-fetch";

// We can access environment variables via process.env 
// provided they are set via `firebase functions:config:set` or .env files
const JIRA_DOMAIN = process.env.VITE_JIRA_DOMAIN;

export const jiraProxy = onRequest(async (request, response) => {
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
        const newHeaders: any = {};
        const skipHeaders = ['host', 'origin', 'referer', 'content-length'];

        for (const [key, value] of Object.entries(request.headers)) {
            if (!skipHeaders.includes(key.toLowerCase())) {
                newHeaders[key] = value;
            }
        }

        // Jira specific
        newHeaders['X-Atlassian-Token'] = 'no-check';

        // 5. Fetch Options
        const fetchOptions: any = {
            method: request.method,
            headers: newHeaders,
            redirect: 'follow'
        };

        if (request.method !== 'GET' && request.method !== 'HEAD') {
            // request.rawBody is a Buffer in firebase-functions
            fetchOptions.body = request.rawBody;
        }

        // 6. Execute Fetch
        const jiraResponse = await fetch(targetUrl, fetchOptions);

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

    } catch (error: any) {
        logger.error("Proxy error", error);
        response.status(502).json({ error: "Proxy error", details: error.message });
    }
});
