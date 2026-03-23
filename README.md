<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Product Discovery Accelerator Pro

A comprehensive React application integrated with Firebase to accelerate product discovery, powered by various AI and productivity tools like Google Gemini, Groq, Figma, and Jira.

This document contains everything another developer needs to set up the IDE code, Git, a new Firebase/GCP account, and all dependencies to run and deploy the application locally and to production.

## 1. Prerequisites
Ensure you have the following installed on your machine before setting up the project:
- [Node.js](https://nodejs.org/) (v20+ is recommended as Firebase Functions use Node 20)
- [Git](https://git-scm.com/) for version control
- [Firebase CLI](https://firebase.google.com/docs/cli) (Install globally via `npm install -g firebase-tools`)

## 2. IDE Setup (Recommended: VS Code)
We recommend using **Visual Studio Code (VS Code)** for this project.
Valuable extensions to install:
- **Tailwind CSS IntelliSense**: For Tailwind support
- **ESlint & Prettier**: For code formatting and linting
- **Firebase Explorer**: (Optional) to manage Firebase resources from the IDE

## 3. Git Repo Setup (For New Users)
If you are setting this up for yourself, you'll want to push it to your own Git repository.

1. **Clone the existing codebase:**
   ```bash
   git clone <repository-url> product-discovery-accelerator
   cd product-discovery-accelerator
   ```

2. **Remove the existing Git history and re-initialize:**
   ```bash
   rm -rf .git
   git init
   git add .
   git commit -m "Initial commit from template"
   ```

3. **Link to your own GitHub/GitLab repository:**
   Create a new blank repository on GitHub/GitLab, then run:
   ```bash
   git remote add origin <your-new-repo-url>
   git branch -M main
   git push -u origin main
   ```

## 4. Install Dependencies
### Frontend Dependencies
From the root of the project, run:
```bash
npm install
```

### Firebase Functions Dependencies
The backend proxies and functions also need their own dependencies installed:
```bash
cd functions
npm install
cd ..
```

## 5. Firebase and GCP Setup (For New Accounts)
Since you are setting this up for your own use, you need your own Firebase project.

1. **Create a Firebase Project:**
   - Go to the [Firebase Console](https://console.firebase.google.com/).
   - Click **Add project** and follow the prompts. Give it a name (e.g., `my-discovery-accelerator`).
   - Enable Google Analytics if desired.

2. **Upgrade to the Blaze Plan (Required for Cloud Functions):**
   - In the Firebase Console, look at the bottom left for "Spark plan" and click **Upgrade**.
   - Select the **Blaze (Pay as you go)** plan. This requires setting up a billing account in Google Cloud Platform (GCP).
   - *Note: Cloud Functions (used for your backend proxies) require the Blaze plan, though generous free tiers apply.*

3. **Initialize Services in Firebase Console:**
   - **Firestore Database:** Go to Build > Firestore Database > Create Database. Start in **Production Mode** or **Test Mode** (you will overwrite rules later) and choose a location.
   - **Hosting:** Go to Build > Hosting > Get Started. Follow the initial prompts (you will deploy via CLI later).

4. **Connect the Local Code to Your New Firebase Project:**
   - Login to Firebase CLI:
     ```bash
     firebase login
     ```
   - Link the project to your new Firebase project:
     ```bash
     firebase use --add
     ```
   - Select the project you just created in the console. Give it an alias (like `default`).

## 6. Environment Variables Setup
You must create a local environment file to connect the application to its required APIs. 

1. Create a file named `.env.local` in the **root** directory.
2. Add the following keys (replace placeholder values with your actual API keys):

```env
GEMINI_API_KEY=your_gemini_api_key_here
VITE_GEMINI_API_KEY=your_vite_gemini_api_key_here
GROQ_API_KEY=your_groq_api_key_here
SERPER_API_KEY=your_serper_api_key_here
VITE_JIRA_DOMAIN=https://your-domain.atlassian.net/
VITE_JIRA_EMAIL=your_jira_email@example.com
VITE_JIRA_API_TOKEN=your_jira_api_token
VITE_JIRA_PROJECT_KEY=YOUR_PROJECT_KEY
VITE_PINECONE_API_KEY=your_pinecone_api_key
VITE_PINECONE_INDEX=discovery-accelerator
VITE_FIGMA_ACCESS_TOKEN=your_figma_access_token
VITE_FIGMA_FILE_KEY=your_figma_file_key
VITE_ELEVENLABS_API_KEY=your_elevenlabs_api_key
```

## 7. Running the Application Locally

### Start Firebase Emulators (For Local Backend/Proxy Testing)
If you want to test the Firebase Functions locally (which handle requests like `/jira-api/**`, `/figma-api/**`, etc.):
```bash
firebase emulators:start --only functions
```

### Start the Frontend Dev Server
Open a new terminal window at the **root directory** and start Vite:
```bash
npm run dev
```

The application will be accessible via `http://localhost:5173`.

## 8. Deployment to Your Firebase Account

1. **Deploy Firestore Rules and Indexes:**
   ```bash
   firebase deploy --only firestore
   ```

2. **Build the Application for Production:**
   ```bash
   npm run build
   ```

3. **Deploy Functions and Hosting:**
   ```bash
   firebase deploy --only functions,hosting
   ```
   *Alternatively, to deploy everything at once (Firestore, Functions, Hosting):*
   ```bash
   firebase deploy
   ```

After deployment, the Firebase CLI will provide you with the live URL (e.g., `https://my-discovery-accelerator.web.app`) where your application is hosted!
