# bun-react-tailwind-shadcn-template

To install dependencies:

```bash
bun install
```

To start a development server:

```bash
export SQLITE_DATABASE_PATH=./data/uwu-assets.sqlite
bun dev
```

To run for production:

```bash
export SQLITE_DATABASE_PATH=./data/uwu-assets.sqlite
bun start
```

In PowerShell, set the database path with:

```powershell
$env:SQLITE_DATABASE_PATH = "./data/uwu-assets.sqlite"
```

The server creates the parent directory and SQLite file automatically when they do not already exist.

This project was created using `bun init` in bun v1.3.14. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
