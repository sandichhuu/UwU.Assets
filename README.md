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
export SQLITE_DATABASE_PATH=./data/uwu-assets.sqlite
export ASSET_STORAGE_PATH=./data/assets
bun start
```

In PowerShell, set the database path with:

```powershell
$env:SQLITE_DATABASE_PATH = "./data/uwu-assets.sqlite"
$env:ASSET_STORAGE_PATH = "./data/assets"
```

The server creates the parent directory, SQLite file, and asset storage directory automatically when they do not already exist.

This project was created using `bun init` in bun v1.3.14. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
