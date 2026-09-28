# Cinevo (Full-stack)
Landing, sign-up, log-in and a "My List" CRUD dashboard.
Stack: Node/Express, PostgreSQL (Neon), bcrypt (hashed passwords), JWT in httpOnly cookie. Frontend is served by Express from `/public`.

## Run locally
1. `npm install`
2. Set `DATABASE_URL` and `JWT_SECRET` (see `.env.example`)
3. `npm start` then open http://localhost:3000

## API
POST /api/signup, /api/login, /api/logout · GET /api/me · GET/POST /api/list · PUT/DELETE /api/list/:id · GET /api/health

Live URL: <add here>
Educational project; not affiliated with any streaming service.
