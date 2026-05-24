# ExamCheck — AI Re-evaluation Tool

An AI-powered exam re-evaluation assistant that reads handwritten answer sheets, compares them against marking schemes, and flags potential marking errors.

---

## SETUP INSTRUCTIONS (For Beginners — Follow Exactly)

### Step 1: Get Your API Key

1. Go to https://console.anthropic.com
2. Sign up or log in
3. Click "API Keys" in the left sidebar
4. Click "Create Key"
5. Copy the key (it starts with `sk-ant-...`) — save it somewhere safe, you only see it once

---

### Step 2: Push This Code to GitHub

1. Go to https://github.com and sign in
2. Click the green "New" button (top left)
3. Name your repository: `examcheck`
4. Leave it as "Public"
5. Click "Create repository"
6. On the next page, click "uploading an existing file"
7. Upload ALL the files from this folder (drag and drop the entire folder contents)
8. Click "Commit changes"

---

### Step 3: Deploy on Vercel

1. Go to https://vercel.com and sign in with your GitHub account
2. Click "Add New Project"
3. Find and select your `examcheck` repository
4. Click "Import"
5. BEFORE clicking Deploy, look for "Environment Variables" section
6. Add one variable:
   - Name: `ANTHROPIC_API_KEY`
   - Value: paste your API key from Step 1
7. Click "Deploy"
8. Wait 2-3 minutes
9. Vercel gives you a URL like `examcheck-xyz.vercel.app` — that is your website!

---

### Step 4: Test It

1. Open your Vercel URL
2. Paste a simple marking scheme in Step 1
3. Paste a question in Step 2
4. Upload any PDF in Step 3
5. Click "Run Re-evaluation Analysis"

---

## HOW TO USE THE WEBSITE

**What to type in "Marking Scheme":**
Copy the exact marking scheme from your school/board. Include question numbers, marks per step, and what earns each mark. The more detail the better.

**What to type in "Question Paper":**
Copy the question text. This gives the AI context for what was being asked.

**What to upload in "Answer Sheet":**
Scan your handwritten answer sheet to PDF. Use your phone camera + a scanning app (like Adobe Scan or CamScanner — both free). Higher quality scans = more accurate results.

---

## IMPORTANT NOTES

- Your documents are never stored — they are processed and immediately deleted
- This tool flags potential errors — always verify with your teacher before a formal challenge
- Works best when marking scheme is structured with per-step marks
- Works with blurry scans, messy handwriting, and diagrams — though clarity helps

---

## COSTS

- The Anthropic API is paid — each analysis costs approximately $0.05 to $0.15 USD depending on paper length
- You get $5 free credit when you sign up to Anthropic, which covers roughly 30-100 analyses
- Monitor your usage at https://console.anthropic.com

---

## UPDATING YOUR SITE

If you change any code:
1. Upload the changed file(s) to your GitHub repository
2. Vercel automatically rebuilds and redeploys within 2-3 minutes
