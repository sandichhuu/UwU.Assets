import { serve } from "bun";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import index from "./index.html";
import {
  createAsset,
  createProject,
  deleteAsset,
  deleteLocalization,
  deleteProject,
  getAssetById,
  getAssetByName,
  getProject,
  getProjectSettings,
  listAssets,
  listLocalization,
  listProjects,
  upsertLocalization,
  upsertProjectSettings,
  type AssetKind,
  type LocalizationKind,
} from "./db/assets";
import { ensureSeedData } from "./db/seed";

ensureSeedData();

const assetKinds = new Set<AssetKind>(["Image", "Audio", "Video"]);
const localizationKinds = new Set<LocalizationKind>(["audioLocalization", "textLocalization"]);
const assetStoragePathEnvName = "ASSET_STORAGE_PATH";
const configuredAssetStoragePath = Bun.env[assetStoragePathEnvName]?.trim();

if (!configuredAssetStoragePath) {
  throw new Error(`${assetStoragePathEnvName} must be set to a directory path before starting the server.`);
}

const assetStoragePath = resolve(configuredAssetStoragePath);
mkdirSync(assetStoragePath, { recursive: true });

function assetFilePath(name: string) {
  return join(assetStoragePath, name);
}

function assetPreviewFilePath(name: string) {
  return join(assetStoragePath, `${name}.preview.webp`);
}

function isSafeAssetName(name: string) {
  return name === name.replaceAll("\\", "/").split("/").pop();
}

async function assetResponse(req: Request, mode: "id" | "name", key: string) {
  const asset = mode === "id" ? getAssetById(key) : getAssetByName(key);
  if (!asset) return Response.json({ error: "Asset not found" }, { status: 404 });

  const token = new URL(req.url).searchParams.get("token");
  const settings = getProjectSettings(asset.projectId);
  if (!token || token !== settings.assetToken) {
    return Response.json({ error: "Invalid asset token" }, { status: 401 });
  }

  const shouldServePreview = new URL(req.url).searchParams.get("preview") === "1";
  const file = Bun.file(shouldServePreview ? assetPreviewFilePath(asset.name) : assetFilePath(asset.name));
  if (!(await file.exists())) {
    return Response.json({ error: "Asset file not found" }, { status: 404 });
  }

  return new Response(file, {
    headers: {
      "Content-Type": shouldServePreview ? "image/webp" : asset.mimeType || "application/octet-stream",
      "Content-Disposition": `inline; filename="${(shouldServePreview ? `${asset.name}.preview.webp` : asset.name).replaceAll('"', "")}"`,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

const server = serve({
  routes: {
    // Serve index.html for all unmatched routes.
    "/*": index,

    "/api/hello": {
      async GET(req) {
        return Response.json({
          message: "Hello, world!",
          method: "GET",
        });
      },
      async PUT(req) {
        return Response.json({
          message: "Hello, world!",
          method: "PUT",
        });
      },
    },

    "/api/hello/:name": async req => {
      const name = req.params.name;
      return Response.json({
        message: `Hello, ${name}!`,
      });
    },

    "/api/projects": {
      async GET() {
        return Response.json({ projects: listProjects() });
      },
      async POST(req) {
        const body = (await req.json()) as { name?: string };
        const name = body.name?.trim();

        if (!name) {
          return Response.json({ error: "Project name is required" }, { status: 400 });
        }

        const project = createProject(name);

        return Response.json({ project }, { status: 201 });
      },
    },

    "/api/projects/:projectId": {
      async GET(req) {
        const project = getProject(req.params.projectId);
        if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

        return Response.json({
          project,
          assets: {
            Image: listAssets(project.id, "Image"),
            Audio: listAssets(project.id, "Audio"),
            Video: listAssets(project.id, "Video"),
          },
          audioLocalization: listLocalization(project.id, "audioLocalization"),
          textLocalization: listLocalization(project.id, "textLocalization"),
          settings: getProjectSettings(project.id),
        });
      },
      async DELETE(req) {
        return Response.json({ deleted: deleteProject(req.params.projectId) });
      },
    },

    "/api/projects/:projectId/assets": {
      async GET(req) {
        const project = getProject(req.params.projectId);
        if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

        const kind = new URL(req.url).searchParams.get("kind") as AssetKind | null;
        if (kind && !assetKinds.has(kind)) {
          return Response.json({ error: "Invalid asset kind" }, { status: 400 });
        }

        return Response.json({ assets: listAssets(project.id, kind ?? undefined) });
      },
      async POST(req) {
        const project = getProject(req.params.projectId);
        if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

        const body = (await req.json()) as {
          originalName?: string;
          name?: string;
          kind?: AssetKind;
          sizeBytes?: number;
          mimeType?: string;
          contentBase64?: string;
          previewContentBase64?: string;
          metadata?: string[];
        };

        const assetName = body.name?.trim();
        if (!body.originalName?.trim() || !assetName || !body.kind || !assetKinds.has(body.kind) || !body.contentBase64) {
          return Response.json({ error: "originalName, name, contentBase64, and valid kind are required" }, { status: 400 });
        }
        if (!isSafeAssetName(assetName)) {
          return Response.json({ error: "Asset name cannot contain path separators" }, { status: 400 });
        }

        mkdirSync(assetStoragePath, { recursive: true });
        await Bun.write(assetFilePath(assetName), Buffer.from(body.contentBase64, "base64"));
        if (body.previewContentBase64) {
          await Bun.write(assetPreviewFilePath(assetName), Buffer.from(body.previewContentBase64, "base64"));
        }
        const asset = createAsset({
          projectId: project.id,
          originalName: body.originalName.trim(),
          name: assetName,
          kind: body.kind,
          sizeBytes: body.sizeBytes,
          mimeType: body.mimeType,
          metadata: body.metadata,
        });

        return Response.json({ asset }, { status: 201 });
      },
    },

    "/api/assets/:assetId": {
      async DELETE(req) {
        const asset = getAssetById(req.params.assetId);
        const deleted = deleteAsset(req.params.assetId);
        if (deleted && asset) {
          const path = assetFilePath(asset.name);
          if (existsSync(path)) unlinkSync(path);
          const previewPath = assetPreviewFilePath(asset.name);
          if (existsSync(previewPath)) unlinkSync(previewPath);
        }
        return Response.json({ deleted });
      },
    },

    "/assets/id/:assetId": {
      async GET(req) {
        return assetResponse(req, "id", req.params.assetId);
      },
    },

    "/assets/name/:assetName": {
      async GET(req) {
        return assetResponse(req, "name", req.params.assetName);
      },
    },

    "/api/projects/:projectId/localization/:kind": {
      async GET(req) {
        const project = getProject(req.params.projectId);
        if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

        const kind = req.params.kind as LocalizationKind;
        if (!localizationKinds.has(kind)) return Response.json({ error: "Invalid localization kind" }, { status: 400 });

        return Response.json({ rows: listLocalization(project.id, kind) });
      },
      async POST(req) {
        const project = getProject(req.params.projectId);
        if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

        const kind = req.params.kind as LocalizationKind;
        if (!localizationKinds.has(kind)) return Response.json({ error: "Invalid localization kind" }, { status: 400 });

        const body = (await req.json()) as { id?: string; key?: string; values?: Record<string, string> };
        const key = body.key?.trim();
        if (!key) return Response.json({ error: "Localization key is required" }, { status: 400 });

        return Response.json({
          row: upsertLocalization({
            id: body.id,
            projectId: project.id,
            kind,
            key,
            values: body.values ?? {},
          }),
        });
      },
    },

    "/api/localization/:localizationId": {
      async DELETE(req) {
        return Response.json({ deleted: deleteLocalization(req.params.localizationId) });
      },
    },

    "/api/projects/:projectId/settings": {
      async GET(req) {
        const project = getProject(req.params.projectId);
        if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

        return Response.json({ settings: getProjectSettings(project.id) });
      },
      async PUT(req) {
        const project = getProject(req.params.projectId);
        if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

        const current = getProjectSettings(project.id);
        const body = (await req.json()) as { assetToken?: string; gptApiToken?: string };

        return Response.json({
          settings: upsertProjectSettings(
            project.id,
            body.assetToken?.trim() || current.assetToken,
            body.gptApiToken ?? current.gptApiToken,
          ),
        });
      },
    },
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
