"use strict";
/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.confluenceProxy = exports.notionProxy = exports.figmaProxy = exports.jiraProxy = exports.shareProject = void 0;
const https_1 = require("firebase-functions/v2/https");
const logger = __importStar(require("firebase-functions/logger"));
const admin = __importStar(require("firebase-admin"));
const node_fetch_1 = __importDefault(require("node-fetch"));
admin.initializeApp();
// We can access environment variables via process.env 
// provided they are set via `firebase functions:config:set` or .env files
const JIRA_DOMAIN = process.env.VITE_JIRA_DOMAIN;
exports.shareProject = (0, https_1.onCall)(async (request) => {
    // 1. Auth Check
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be logged in.');
    }
    const { projectId, email } = request.data;
    if (!projectId || !email) {
        throw new https_1.HttpsError('invalid-argument', 'Missing projectId or email.');
    }
    try {
        // 2. Find Recipient
        const userRecord = await admin.auth().getUserByEmail(email);
        const recipientUid = userRecord.uid;
        if (recipientUid === request.auth.uid) {
            throw new https_1.HttpsError('invalid-argument', 'Cannot share with yourself.');
        }
        // 3. Update Firestore
        const projectRef = admin.firestore().collection('projects').doc(projectId);
        const projectSnap = await projectRef.get();
        if (!projectSnap.exists) {
            throw new https_1.HttpsError('not-found', 'Project not found.');
        }
        // Verify Ownership (Simple check: Caller must be owner)
        // In real app, allow Admins too.
        const projectData = projectSnap.data();
        if ((projectData === null || projectData === void 0 ? void 0 : projectData.userId) !== request.auth.uid) {
            // throw new HttpsError('permission-denied', 'Only owner can share.');
            // Relaxed for now or add Admin check here if needed
        }
        // Add to sharedWith map
        // We use dot notation for update to avoid rewriting entire map
        await projectRef.set({
            sharedWith: {
                [recipientUid]: {
                    email: email,
                    role: 'viewer',
                    sharedAt: Date.now(),
                    sharedBy: request.auth.token.email || 'unknown'
                }
            }
        }, { merge: true });
        // 4. Send Notification (Log for MVP)
        logger.info(`[SHARE] Project ${projectId} shared with ${email} by ${request.auth.uid}`);
        return { success: true, message: `Project shared with ${email}` };
    }
    catch (error) {
        logger.error("Share Project Error", error);
        if (error.code === 'auth/user-not-found') {
            throw new https_1.HttpsError('not-found', 'User with this email not found. They must sign up first.');
        }
        throw new https_1.HttpsError('internal', error.message);
    }
});
exports.jiraProxy = (0, https_1.onRequest)(async (request, response) => {
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
        const customDomain = request.headers['x-jira-domain'];
        let targetDomain = '';
        if (customDomain) {
            targetDomain = customDomain.startsWith("http") ? customDomain : `https://${customDomain}`;
        }
        else if (JIRA_DOMAIN) {
            targetDomain = JIRA_DOMAIN.startsWith("http") ? JIRA_DOMAIN : `https://${JIRA_DOMAIN}`;
        }
        else {
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
        if (!targetPath.startsWith('/'))
            targetPath = '/' + targetPath;
        const targetUrl = new URL(targetPath, targetDomain).toString();
        logger.info(`Proxying request to: ${targetUrl} (Domain: ${targetDomain})`);
        // 4. Prepare Headers (Security Hardening)
        const newHeaders = {};
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
        }
        catch (e) {
            // Fallback
            newHeaders['Origin'] = targetDomain;
        }
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
        jiraResponse.headers.forEach((value, key) => {
            if (key.toLowerCase() !== 'content-encoding' && key.toLowerCase() !== 'content-length') {
                response.set(key, value);
            }
        });
        // Ensure CORS on main response
        response.set("Access-Control-Allow-Origin", "*");
        const buffer = await jiraResponse.buffer();
        response.status(jiraResponse.status).send(buffer);
    }
    catch (error) {
        logger.error("Proxy error", error);
        response.status(502).json({ error: "Proxy error", details: error.message });
    }
});
exports.figmaProxy = (0, https_1.onRequest)(async (request, response) => {
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
        if (!targetPath.startsWith('/'))
            targetPath = '/' + targetPath;
        const targetUrl = new URL(targetPath, FIGMA_API_BASE).toString();
        logger.info(`[FigmaProxy] Proxying to: ${targetUrl}`);
        // 3. Prepare Headers
        const newHeaders = {};
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
        const fetchOptions = {
            method: request.method,
            headers: newHeaders,
            redirect: 'follow'
        };
        if (request.method !== 'GET' && request.method !== 'HEAD') {
            fetchOptions.body = request.rawBody;
        }
        const figmaResponse = await (0, node_fetch_1.default)(targetUrl, fetchOptions);
        // 5. Send Response
        figmaResponse.headers.forEach((value, key) => {
            if (key.toLowerCase() !== 'content-encoding' && key.toLowerCase() !== 'content-length') {
                response.set(key, value);
            }
        });
        response.set("Access-Control-Allow-Origin", "*");
        const buffer = await figmaResponse.buffer();
        response.status(figmaResponse.status).send(buffer);
    }
    catch (error) {
        logger.error("Figma Proxy error", error);
        response.status(502).json({ error: "Figma Proxy error", details: error.message });
    }
});
exports.notionProxy = (0, https_1.onRequest)(async (request, response) => {
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
        if (!targetPath.startsWith('/'))
            targetPath = '/' + targetPath;
        const targetUrl = new URL(targetPath, NOTION_API_BASE).toString();
        logger.info(`[NotionProxy] Proxying to: ${targetUrl}`);
        // 3. Prepare Headers
        const newHeaders = {};
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
        const fetchOptions = {
            method: request.method,
            headers: newHeaders,
            redirect: 'follow'
        };
        if (request.method !== 'GET' && request.method !== 'HEAD') {
            fetchOptions.body = request.rawBody;
        }
        const notionResponse = await (0, node_fetch_1.default)(targetUrl, fetchOptions);
        // 5. Send Response
        notionResponse.headers.forEach((value, key) => {
            if (key.toLowerCase() !== 'content-encoding' && key.toLowerCase() !== 'content-length') {
                response.set(key, value);
            }
        });
        response.set("Access-Control-Allow-Origin", "*");
        const buffer = await notionResponse.buffer();
        response.status(notionResponse.status).send(buffer);
    }
    catch (error) {
        logger.error("Notion Proxy error", error);
        response.status(502).json({ error: "Notion Proxy error", details: error.message });
    }
});
exports.confluenceProxy = (0, https_1.onRequest)(async (request, response) => {
    // 1. CORS Preflight
    response.set("Access-Control-Allow-Origin", "*");
    if (request.method === "OPTIONS") {
        response.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE, PATCH");
        response.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Atlassian-Token, X-Confluence-Domain");
        response.set("Access-Control-Max-Age", "86400");
        response.status(204).send("");
        return;
    }
    try {
        // 2. Determine Target Domain
        const customDomain = request.headers['x-confluence-domain'];
        if (!customDomain) {
            logger.error("No Confluence Domain provided in header x-confluence-domain");
            response.status(400).json({ error: "Configuration Error: No Confluence Domain provided." });
            return;
        }
        const baseUrl = customDomain.startsWith("http") ? customDomain : `https://${customDomain}`;
        // Confluence Cloud REST API Base: https://<site>.atlassian.net/wiki/rest/api
        const targetBase = `${baseUrl}/wiki/rest/api`;
        // 3. Construct Target URL
        let targetPath = request.path;
        if (targetPath.startsWith("/confluence-api")) {
            targetPath = targetPath.replace(/^\/confluence-api/, "");
        }
        if (!targetPath.startsWith('/'))
            targetPath = '/' + targetPath;
        if (!targetPath.startsWith('/'))
            targetPath = '/' + targetPath;
        // Construct Final URL
        const finalUrl = `${targetBase}${targetPath}`;
        logger.info(`[ConfluenceProxy] Proxying to: ${finalUrl}`);
        // 4. Prepare Headers
        const newHeaders = {};
        const skipHeaders = ['host', 'origin', 'referer', 'content-length', 'cookie'];
        for (const [key, value] of Object.entries(request.headers)) {
            if (!skipHeaders.includes(key.toLowerCase())) {
                newHeaders[key] = value;
            }
        }
        // Security Headers
        newHeaders['X-Atlassian-Token'] = 'no-check';
        newHeaders['User-Agent'] = 'ConfluenceAgent/1.0';
        // 5. Execute Fetch
        const fetchOptions = {
            method: request.method,
            headers: newHeaders,
            redirect: 'follow'
        };
        if (request.method !== 'GET' && request.method !== 'HEAD') {
            fetchOptions.body = request.rawBody;
        }
        const confResponse = await (0, node_fetch_1.default)(finalUrl, fetchOptions);
        // 6. Send Response
        confResponse.headers.forEach((value, key) => {
            if (key.toLowerCase() !== 'content-encoding' && key.toLowerCase() !== 'content-length') {
                response.set(key, value);
            }
        });
        response.set("Access-Control-Allow-Origin", "*");
        const buffer = await confResponse.buffer();
        response.status(confResponse.status).send(buffer);
    }
    catch (error) {
        logger.error("Confluence Proxy error", error);
        response.status(502).json({ error: "Confluence Proxy error", details: error.message });
    }
});
//# sourceMappingURL=index.js.map