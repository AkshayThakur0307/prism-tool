import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function checkModels() {
    try {
        // Read .env.local manually to get the key
        const envPath = join(__dirname, '../.env.local');
        const envContent = await readFile(envPath, 'utf8');

        const keyMatch = envContent.match(/VITE_GEMINI_API_KEY=(.+)/);
        const apiKey = keyMatch ? keyMatch[1].trim() : null;

        if (!apiKey) {
            console.error("Could not find VITE_GEMINI_API_KEY in .env.local");
            process.exit(1);
        }

        console.log(`Checking models with key: ${apiKey.substring(0, 10)}...`);

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);

        if (!response.ok) {
            console.error(`Error: ${response.status} ${response.statusText}`);
            const text = await response.text();
            console.error(text);
            return;
        }

        const data = await response.json();
        console.log("\nAvailable Models:");
        console.log("-----------------");

        const relevantModels = data.models
            .filter(m => m.name.includes('gemini'))
            .sort((a, b) => b.name.localeCompare(a.name));

        relevantModels.forEach(m => {
            console.log(`- ${m.name.replace('models/', '')}`);
            console.log(`  Supported Methods: ${m.supportedGenerationMethods.join(', ')}`);
            console.log("");
        });

    } catch (error) {
        console.error("Script failed:", error);
    }
}

checkModels();
