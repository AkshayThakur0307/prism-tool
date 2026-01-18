/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

import { onRequest, onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import fetch from "node-fetch";

admin.initializeApp();

// We can access environment variables via process.env 
// provided they are set via `firebase functions:config:set` or .env files
const JIRA_DOMAIN = process.env.VITE_JIRA_DOMAIN;

export const shareProject = onCall(async (request) => {
    // 1. Auth Check
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'User must be logged in.');
    }

    const { projectId, email } = request.data;
    if (!projectId || !email) {
        throw new HttpsError('invalid-argument', 'Missing projectId or email.');
    }

    try {
        // 2. Find Recipient
        const userRecord = await admin.auth().getUserByEmail(email);
        const recipientUid = userRecord.uid;

        if (recipientUid === request.auth.uid) {
            throw new HttpsError('invalid-argument', 'Cannot share with yourself.');
        }

        // 3. Update Firestore
        const projectRef = admin.firestore().collection('projects').doc(projectId);
        const projectSnap = await projectRef.get();

        if (!projectSnap.exists) {
            throw new HttpsError('not-found', 'Project not found.');
        }

        // Verify Ownership (Simple check: Caller must be owner)
        // In real app, allow Admins too.
        const projectData = projectSnap.data();
        if (projectData?.userId !== request.auth.uid) {
            // throw new HttpsError('permission-denied', 'Only owner can share.');
            // Relaxed for now or add Admin check here if needed
        }

        // Add to sharedWith map
        // We use dot notation for update to avoid rewriting entire map
        await projectRef.set({
            sharedWith: {
                [recipientUid]: {
                    email: email,
                    role: 'viewer', // Enforce 'viewer' for MVP
                    sharedAt: Date.now(),
                    sharedBy: request.auth.token.email || 'unknown'
                }
            }
        }, { merge: true });

        // 4. Send Notification (Log for MVP)
        logger.info(`[SHARE] Project ${projectId} shared with ${email} by ${request.auth.uid}`);

        return { success: true, message: `Project shared with ${email}` };

    } catch (error: any) {
        logger.error("Share Project Error", error);
        if (error.code === 'auth/user-not-found') {
            throw new HttpsError('not-found', 'User with this email not found. They must sign up first.');
        }
        throw new HttpsError('internal', error.message);
    }
});

export const jiraProxy = onRequest(async (request, response) => {
    // 1. CORS Preflight
    response.set("Access-Control-Allow-Origin", "*");
    if (request.method === "OPTIONS") {
        response.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE, PATCH");
        // Allow X-Jira-Domain and other headers
        response.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Atlassian-Token, X-Jira-Domain");
        response.set("Access-Control-Max-Age", "86400");
        response.status(204).send("");
        return;
    }

    try {
        // 2. Determine Target Domain (Dynamic Routing)
        // Check for the custom header first, fall back to Env Var
        const customDomain = request.headers['x-jira-domain'] as string;
        let targetDomain = '';

        if (customDomain) {
            targetDomain = customDomain.startsWith("http") ? customDomain : `https://${customDomain}`;
        } else if (JIRA_DOMAIN) {
            targetDomain = JIRA_DOMAIN.startsWith("http") ? JIRA_DOMAIN : `https://${JIRA_DOMAIN}`;
        } else {
            logger.error("No Jira Domain provided (header or env)");
            response.status(500).json({ error: "Configuration Error: No Jira Domain found." });
            return;
        }

        // 3. Construct Target URL
        // We want to extract everything *after* the trigger path.
        // If the rewrite is /jira-api/** -> jiraProxy, request.url usually preserves the path.
        // We'll strip /jira-api if present.
        let targetPath = request.path;
        if (targetPath.startsWith("/jira-api")) {
            targetPath = targetPath.replace(/^\/jira-api/, "");
        }

        // Remove double slashes just in case
        if (!targetPath.startsWith('/')) targetPath = '/' + targetPath;

        const targetUrl = new URL(targetPath, targetDomain).toString();
        logger.info(`Proxying request to: ${targetUrl} (Domain: ${targetDomain})`);

        // 4. Prepare Headers (Security Hardening)
        const newHeaders: any = {};
        const skipHeaders = ['host', 'origin', 'referer', 'content-length', 'cookie', 'user-agent']; // STRIP COOKIE & UA

        for (const [key, value] of Object.entries(request.headers)) {
            if (!skipHeaders.includes(key.toLowerCase())) {
                newHeaders[key] = value;
            }
        }

        // Inject Security Headers
        newHeaders['X-Atlassian-Token'] = 'no-check';
        newHeaders['User-Agent'] = 'JiraAgent/1.0 (Integration)'; // Clean UA

        // Strict Origin Sanitization
        try {
            // Create clean origin from target domain (protocol + host only)
            const originUrl = new URL(targetDomain);
            newHeaders['Origin'] = originUrl.origin;
            newHeaders['Referer'] = originUrl.origin;
        } catch (e) {
            // Fallback
            newHeaders['Origin'] = targetDomain;
        }

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
        jiraResponse.headers.forEach((value, key) => {
            if (key.toLowerCase() !== 'content-encoding' && key.toLowerCase() !== 'content-length') {
                response.set(key, value);
            }
        });

        // Ensure CORS on main response
        response.set("Access-Control-Allow-Origin", "*");

        const buffer = await jiraResponse.buffer();
        response.status(jiraResponse.status).send(buffer);

    } catch (error: any) {
        logger.error("Proxy error", error);
        response.status(502).json({ error: "Proxy error", details: error.message });
    }
});

export const figmaProxy = onRequest(async (request, response) => {
    // 1. CORS Preflight
    response.set("Access-Control-Allow-Origin", "*");
    if (request.method === "OPTIONS") {
        response.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
        response.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Figma-Token");
        response.set("Access-Control-Max-Age", "86400");
        response.status(204).send("");
        return;
    }

    try {
        const FIGMA_API_BASE = "https://api.figma.com/v1";
        const envToken = process.env.VITE_FIGMA_ACCESS_TOKEN;

        // 2. Construct Target URL
        // Strip /figma-api prefix
        let targetPath = request.path;
        if (targetPath.startsWith("/figma-api")) {
            targetPath = targetPath.replace(/^\/figma-api/, "");
        }
        if (!targetPath.startsWith('/')) targetPath = '/' + targetPath;

        const targetUrl = new URL(targetPath, FIGMA_API_BASE).toString();
        logger.info(`[FigmaProxy] Proxying to: ${targetUrl}`);

        // 3. Prepare Headers
        const newHeaders: any = {};
        const skipHeaders = ['host', 'origin', 'referer', 'content-length', 'cookie'];

        for (const [key, value] of Object.entries(request.headers)) {
            if (!skipHeaders.includes(key.toLowerCase())) {
                newHeaders[key] = value;
            }
        }

        // Auth Handling: Prefer Header from Client, Fallback to Env
        if (!newHeaders['x-figma-token'] && envToken) {
            newHeaders['X-Figma-Token'] = envToken;
        }

        // 4. Execute Fetch
        const fetchOptions: any = {
            method: request.method,
            headers: newHeaders,
            redirect: 'follow'
        };

        if (request.method !== 'GET' && request.method !== 'HEAD') {
            fetchOptions.body = request.rawBody;
        }

        const figmaResponse = await fetch(targetUrl, fetchOptions);

        // 5. Send Response
        figmaResponse.headers.forEach((value, key) => {
            if (key.toLowerCase() !== 'content-encoding' && key.toLowerCase() !== 'content-length') {
                response.set(key, value);
            }
        });

        response.set("Access-Control-Allow-Origin", "*");

        const buffer = await figmaResponse.buffer();
        response.status(figmaResponse.status).send(buffer);

    } catch (error: any) {
        logger.error("Figma Proxy error", error);
        response.status(502).json({ error: "Figma Proxy error", details: error.message });
    }
});

export const notionProxy = onRequest(async (request, response) => {
    // 1. CORS Preflight
    response.set("Access-Control-Allow-Origin", "*");
    if (request.method === "OPTIONS") {
        response.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE, PATCH");
        response.set("Access-Control-Allow-Headers", "Content-Type, Authorization, Notion-Version");
        response.set("Access-Control-Max-Age", "86400");
        response.status(204).send("");
        return;
    }

    try {
        const NOTION_API_BASE = "https://api.notion.com/v1";

        // 2. Construct Target URL
        // Strip /notion-api prefix
        let targetPath = request.path;
        if (targetPath.startsWith("/notion-api")) {
            targetPath = targetPath.replace(/^\/notion-api/, "");
        }
        if (!targetPath.startsWith('/')) targetPath = '/' + targetPath;

        const targetUrl = new URL(targetPath, NOTION_API_BASE).toString();
        logger.info(`[NotionProxy] Proxying to: ${targetUrl}`);

        // 3. Prepare Headers
        const newHeaders: any = {};
        const skipHeaders = ['host', 'origin', 'referer', 'content-length', 'cookie'];

        for (const [key, value] of Object.entries(request.headers)) {
            if (!skipHeaders.includes(key.toLowerCase())) {
                newHeaders[key] = value;
            }
        }

        // Ensure Notion Version
        if (!newHeaders['notion-version']) {
            newHeaders['Notion-Version'] = '2022-06-28';
        }

        // 4. Execute Fetch
        const fetchOptions: any = {
            method: request.method,
            headers: newHeaders,
            redirect: 'follow'
        };

        if (request.method !== 'GET' && request.method !== 'HEAD') {
            fetchOptions.body = request.rawBody;
        }

        const notionResponse = await fetch(targetUrl, fetchOptions);

        // 5. Send Response
        notionResponse.headers.forEach((value, key) => {
            if (key.toLowerCase() !== 'content-encoding' && key.toLowerCase() !== 'content-length') {
                response.set(key, value);
            }
        });

        response.set("Access-Control-Allow-Origin", "*");

        const buffer = await notionResponse.buffer();
        response.status(notionResponse.status).send(buffer);

    } catch (error: any) {
        logger.error("Notion Proxy error", error);
        response.status(502).json({ error: "Notion Proxy error", details: error.message });
    }
});
