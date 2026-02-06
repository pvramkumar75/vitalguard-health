# VitalGuard Health - Deployment Guide

## 🚀 Deploy to Vercel (Recommended - Easiest)

### Step 1: Prepare for Deployment

1. **Go to Vercel:** https://vercel.com
2. **Sign up/Login** with your GitHub account

### Step 2: Import Your Repository

1. Click **"Add New Project"**
2. Select **"Import Git Repository"**
3. Find `pvramkumar75/vitalguard-health`
4. Click **"Import"**

### Step 3: Configure Build Settings

Vercel should auto-detect Vite. Verify these settings:

- **Framework Preset:** Vite
- **Build Command:** `npm run build`
- **Output Directory:** `dist`
- **Install Command:** `npm install`

### Step 4: Add Environment Variable (CRITICAL!)

⚠️ **Your app won't work without this!**

1. In Vercel project settings, go to **"Environment Variables"**
2. Add:
   - **Name:** `API_KEY`
   - **Value:** Your Gemini API key (from .env.local)
   - **Environment:** Production, Preview, Development (select all)
3. Click **"Save"**

### Step 5: Deploy

1. Click **"Deploy"**
2. Wait 2-3 minutes for build to complete
3. You'll get a URL like: `https://vitalguard-health.vercel.app`

---

## 🌐 Deploy to Netlify (Alternative)

### Step 1: Prepare

1. Go to https://netlify.com
2. Sign up/Login with GitHub

### Step 2: New Site from Git

1. Click **"Add new site"** → **"Import an existing project"**
2. Choose **"GitHub"**
3. Select `pvramkumar75/vitalguard-health`

### Step 3: Build Settings

- **Build command:** `npm run build`
- **Publish directory:** `dist`

### Step 4: Environment Variables

1. Click **"Show advanced"**
2. Under **"Environment variables"**, click **"New variable"**
3. Add:
   - **Key:** `API_KEY`
   - **Value:** Your Gemini API key
4. Click **"Deploy site"**

---

## 🔧 Common Deployment Issues & Solutions

### Issue 1: "Blank Page / White Screen"

**Cause:** Environment variable not set or incorrect

**Solution:**
1. Check deployment logs for errors
2. Verify `API_KEY` is set in platform settings
3. Make sure the API key is valid
4. Redeploy after adding environment variable

### Issue 2: "Build Failed"

**Cause:** Missing dependencies or build errors

**Solution:**
1. Check build logs in deployment platform
2. Ensure `package.json` has all dependencies
3. Try building locally: `npm run build`
4. Check if build succeeds locally first

### Issue 3: "API Error / 401 Unauthorized"

**Cause:** Invalid or missing API key

**Solution:**
1. Get new API key from: https://aistudio.google.com/app/apikey
2. Update environment variable in deployment platform
3. Trigger redeploy

### Issue 4: "Module Not Found"

**Cause:** Import paths or dependencies issue

**Solution:**
1. Check all imports use relative paths
2. Verify all packages in `package.json`
3. Clear cache and redeploy

---

## 📝 Pre-Deployment Checklist

Before deploying, verify:

- ✅ Code pushed to GitHub (`git push`)
- ✅ `.env.local` in `.gitignore` (don't commit API key!)
- ✅ `npm run build` works locally
- ✅ Have valid Gemini API key ready
- ✅ All files committed and pushed

---

## 🧪 Test Local Build First

Before deploying, test the production build locally:

```bash
# Build the app
npm run build

# Preview the production build
npm run preview
```

If this works, deployment should work too!

---

## 🔐 Environment Variables Needed

Your deployment platform needs these variables:

| Variable | Value | Where to Get |
|----------|-------|--------------|
| `API_KEY` | Your Gemini API Key | https://aistudio.google.com/app/apikey |

---

## 📊 After Deployment

1. **Test the app:** Visit your deployment URL
2. **Check functionality:**
   - Patient registration works
   - Chat with AI works
   - Report generation works
3. **Monitor:** Check deployment logs for any errors

---

## 🆘 Still Not Working?

### Debug Steps:

1. **Check Deployment Logs:**
   - Vercel: Project → Deployments → Click failed deployment → View logs
   - Netlify: Site → Deploys → Click failed deploy → Deploy log

2. **Verify Environment Variable:**
   - Go to project settings
   - Check if `API_KEY` is set correctly
   - No quotes, no extra spaces

3. **Check Browser Console:**
   - Open deployed site
   - Press F12 → Console tab
   - Look for error messages

4. **Common Error Messages:**
   - "API key not configured" → Add API_KEY env variable
   - "Failed to fetch" → CORS or API key issue
   - "Module not found" → Build configuration issue

---

## 💡 Tips for Successful Deployment

1. **Use Vercel:** Easiest for Vite apps (recommended)
2. **Set Environment Variables:** BEFORE first deployment
3. **Check Logs:** Always check deployment logs
4. **Test Locally:** Build locally first with `npm run build`
5. **Valid API Key:** Make sure your Gemini key works

---

## 🎯 Quick Vercel Deployment (30 seconds)

```bash
# Install Vercel CLI (optional, for command-line deploy)
npm i -g vercel

# Deploy from command line
vercel

# Follow prompts, add API_KEY when asked
```

---

## 📞 Need Help?

If you're still stuck, tell me:
1. Which platform are you using? (Vercel/Netlify/Other)
2. What error message do you see?
3. Screenshot of deployment logs (if possible)

I'll help you troubleshoot! 🚀
