# bun-react-tailwind-shadcn-template

To install dependencies:

```bash
bun install
```

To start a development server:

```bash
export SQLITE_DATABASE_PATH=./data/uwu-assets.sqlite
export ASSET_STORAGE_PATH=./data/assets
bun dev
```

To run for production:

```bash
export SQLITE_DATABASE_PATH="$PWD/data/uwu-assets.sqlite"
export ASSET_STORAGE_PATH="$PWD/data/assets"
bun run build
bun start
```

To preview only the built static frontend in `dist` after `bun run build`, run:

```bash
bun run preview
```

Do not run `bun dist/index.html` directly. The production server entrypoint is `dist/index.js`.

In PowerShell, set the database path with:

```powershell
$env:SQLITE_DATABASE_PATH = "$PWD/data/uwu-assets.sqlite"
$env:ASSET_STORAGE_PATH = "$PWD/data/assets"
```

The server creates the parent directory, SQLite file, and asset storage directory automatically when they do not already exist.

## Docker

The included `docker-compose.yaml` stores SQLite and uploaded assets in a Docker-managed volume:

```bash
docker compose up --build -d
```

If you change the compose file back to a host bind mount such as `./data:/app/data`, the host `data` directory and any existing `*.sqlite`, `*.sqlite-wal`, and `*.sqlite-shm` files must be writable by the container's `bun` user. Otherwise SQLite will fail during startup with `SQLITE_CANTOPEN`.

This project was created using `bun init` in bun v1.3.14. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
