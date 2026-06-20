This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the frontend and backend together:

```bash
npm run dev:all
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

If you intentionally want the frontend only, run `npm run dev` and set
`NEXT_PUBLIC_USE_LOCAL_MOCKS=true`. Otherwise backend-backed pages will fall
back to local sample data when the FastAPI service is not running.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Local OAuth Setup

Use `.env.example` as your template, and ensure this value matches your frontend dev server port:

```bash
NEXTAUTH_URL=http://localhost:3000
```

If `NEXTAUTH_URL` points to a different port (for example `3001`) while the app runs on `3000`, Google/NextAuth redirects can behave incorrectly.

In Google Cloud Console (OAuth 2.0 Client ID for Web application), add:

- Authorized JavaScript origins: `http://localhost:3000`
- Authorized redirect URIs: `http://localhost:3000/api/auth/callback/google`

If you sometimes run on another local port, add that too (for example `http://localhost:3001` and `http://localhost:3001/api/auth/callback/google`).

## Location Autocomplete Setup

The `/you` profile basics editor works locally without an API key using built-in city suggestions. For broader production coverage, add a Google Places key later. The key is server-only and must not use a `NEXT_PUBLIC_` prefix.

1. Create an API key in Google Cloud Console.
2. Enable the Google Places API for that project.
3. Paste the key into `.env.local` at the project root:

```bash
GOOGLE_PLACES_API_KEY=your_key_here
```

4. Restart the dev server after changing `.env.local`.
5. Do not commit `.env.local`; it is ignored by git.
6. Restrict the key in Google Cloud before production.

Without this key, local autocomplete still works from the built-in dataset. Adding `GOOGLE_PLACES_API_KEY` later switches the server-side autocomplete route to Google Places.

## Optional External Backend

This repo now includes a standalone FastAPI backend under `backend/`.

Frontend job data source is switchable via env flags:

```bash
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000/api/v1
NEXT_PUBLIC_USE_LOCAL_MOCKS=false
```

Defaults:
- `NEXT_PUBLIC_BACKEND_URL` defaults to `http://localhost:8000/api/v1` if unset.
- `NEXT_PUBLIC_USE_LOCAL_MOCKS=false` (or unset) means backend is the default source of truth.
- Set `NEXT_PUBLIC_USE_LOCAL_MOCKS=true` only when you explicitly want local mock/SQLite fallback.

## Auth Integration Notes

Frontend auth now uses:
- NextAuth Google OAuth (`signIn("google")`)
- NextAuth Credentials provider (`signIn("credentials")`) backed by FastAPI `/api/v1/auth/login`

Required frontend env vars:

```bash
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=change-me-please
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000/api/v1
NEXT_PUBLIC_USE_LOCAL_MOCKS=false
```

Email/password registration + verification endpoints are provided by the backend:
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/verify-email`

Portfolio YouTube import uses the backend-only `YOUTUBE_API_KEY` variable. Do not expose that key with a `NEXT_PUBLIC_` prefix.
