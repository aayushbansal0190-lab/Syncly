# Chat App

A real-time chat application built on the MERN stack with Socket.IO. It supports
1-on-1 messaging, a friend system, read receipts, presence, voice notes, video
calls, and an optional AI assistant for summaries and reply suggestions.

The frontend is written in TypeScript (React + Vite); the backend is Node/Express
with MongoDB.

## Features

**Messaging**
- Real-time 1-on-1 chat over WebSockets
- Read receipts (sent / delivered / seen) and online presence
- Edit and delete your own messages (soft delete)
- In-conversation search with jump-to-message
- Infinite scroll with server-side pagination
- Image and file attachments (images are compressed client-side before upload)
- Voice notes, recorded in the browser and stored as mp3 so they play everywhere
- Emoji picker

**Friends**
- User search by username with relationship-aware actions
- Friend requests on their own page, with a live count badge in the navbar

**AI assistant (optional)**
- Summarize a conversation or suggest a reply based on recent messages
- Runs through a single `generateText()` service, so the LLM provider can be
  swapped in one file (currently Groq / Llama 3.3)

**Other**
- 1-on-1 video calls over WebRTC, using Socket.IO for signaling
- Theme switcher (DaisyUI) with a resizable chat list

## Tech stack

- **Frontend:** React 18 + TypeScript, Vite, Tailwind CSS + DaisyUI, Zustand, Axios, Socket.IO client
- **Backend:** Node.js, Express, MongoDB + Mongoose, Socket.IO, JWT, bcrypt
- **Media:** Cloudinary (images, files, audio)
- **AI:** Groq SDK (optional)

## Getting started

### Prerequisites
- Node.js 20.19+
- A MongoDB database (MongoDB Atlas free tier is fine)
- A Cloudinary account for media uploads
- A Groq API key if you want the AI features (optional)

### Setup

```bash
git clone <your-repo-url>
cd chat-app
npm run setup    # installs backend + frontend dependencies
```

Create `backend/.env` (see `backend/.env.example`):

```env
PORT=5001
CLIENT_URL=http://localhost:5173
JSON_LIMIT=8mb
TOKEN_SECRET=a-long-random-string
CONNECTION_STRING=your-mongodb-connection-string
CLOUD_NAME=your-cloudinary-cloud-name
API_KEY=your-cloudinary-api-key
API_SECRET=your-cloudinary-api-secret
GROQ_API_KEY=your-groq-api-key   # optional; AI features are skipped if unset
```

The frontend needs no `.env` locally — Vite proxies `/api` and the socket to the
backend. For a split-domain deployment, set `VITE_API_URL` and `VITE_SOCKET_URL`
at build time.

### Run

```bash
npm run dev      # backend on :5001, frontend on :5173
```

Then open http://localhost:5173.

## Scripts

| Command | Description |
|---|---|
| `npm run setup` | Install backend + frontend dependencies |
| `npm run dev` | Run backend and frontend together |
| `npm run backend` | Backend only (nodemon) |
| `npm run frontend` | Frontend only (Vite) |
| `npm run build` | Build the frontend |
| `npm start` | Start the backend in production |

## Project structure

```
chat-app/
├── backend/
│   └── src/
│       ├── controllers/   # auth, message, friend, ai
│       ├── models/        # user, message, friendRequest
│       ├── routes/        # /api/{auth,messages,friends,ai}
│       ├── lib/           # db, socket, cloudinary, ai, env
│       ├── middleware/    # JWT auth
│       └── index.js       # Express + Socket.IO server
└── frontend/
    └── src/
        ├── components/     # chat UI, sidebar, message input, ...
        ├── pages/          # login, signup, home, profile, settings, requests
        ├── store/          # Zustand stores
        └── lib/            # axios instance, helpers
```

## Deployment

The backend needs a host that runs a persistent process (for the Socket.IO
connection); the frontend is a static build. See [DEPLOYMENT.md](DEPLOYMENT.md)
for the AWS setup (EC2 + S3 + CloudFront). Note that HTTPS is required in
production for voice recording and video calls, since the browser only grants
mic/camera access over a secure origin.

## Notes

- Passwords are bcrypt-hashed; auth uses a JWT stored in an httpOnly cookie.
- Authorization is checked server-side on every action — the server never trusts
  client-supplied IDs (e.g. AI only ever reads messages from your own conversation).
