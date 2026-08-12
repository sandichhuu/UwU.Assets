import { serve } from "bun";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, statfsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
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
  getLocalizationById,
  getProject,
  getProjectSettings,
  listAssets,
  listAuditLogs,
  listLocalization,
  listProjects,
  recordAuditLog,
  updateAssetConversion,
  updateAssetFile,
  upsertLocalization,
  upsertProjectSettings,
  type AssetKind,
  type LocalizationKind,
} from "./db/assets";
import {
  createSession,
  createUser,
  deleteUser,
  deleteSession,
  ensureDefaultAdminUser,
  getUserById,
  getUserByApiToken,
  getSessionUser,
  listUsers,
  regenerateUserApiToken,
  updateUserEnabled,
  updateUserPassword,
  type AuthUser,
  type UserRole,
  verifyUserPassword,
} from "./db/auth";
import { getDatabasePath } from "./db/database";
import { ensureSeedData } from "./db/seed";

ensureSeedData();
await ensureDefaultAdminUser();

const assetKinds = new Set<AssetKind>(["Image", "Audio", "Video"]);
const localizationKinds = new Set<LocalizationKind>(["audioLocalization", "textLocalization"]);
const assetStoragePathEnvName = "ASSET_STORAGE_PATH";
const configuredAssetStoragePath = Bun.env[assetStoragePathEnvName]?.trim();
const defaultAssetPageSize = 50;

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

function oggAssetName(name: string) {
  return name.replace(/\.[^.]*$/, "") + ".ogg";
}

function webmAssetName(name: string) {
  return name.replace(/\.[^.]*$/, "") + ".webm";
}

function sourceVideoAssetName(name: string) {
  return `${name}.source`;
}

function isSafeAssetName(name: string) {
  return name === name.replaceAll("\\", "/").split("/").pop();
}

function fileSize(path: string) {
  return existsSync(path) ? statSync(path).size : 0;
}

function directorySize(path: string): number {
  if (!existsSync(path)) return 0;
  const stats = statSync(path);
  if (!stats.isDirectory()) return stats.size;

  return readdirSync(path).reduce((total, entry) => total + directorySize(join(path, entry)), 0);
}

function storageUsageBytes() {
  const databasePath = getDatabasePath();
  const sqliteBytes = fileSize(databasePath) + fileSize(`${databasePath}-wal`) + fileSize(`${databasePath}-shm`);
  const assetBytes = directorySize(assetStoragePath);
  return sqliteBytes + assetBytes;
}

function diskStorage() {
  const stats = statfsSync(assetStoragePath);
  return {
    availableBytes: stats.bavail * stats.bsize,
    totalBytes: stats.blocks * stats.bsize,
  };
}

function parseCookies(req: Request) {
  return Object.fromEntries(
    (req.headers.get("cookie") ?? "")
      .split(";")
      .map(cookie => cookie.trim())
      .filter(Boolean)
      .map(cookie => {
        const [name, ...value] = cookie.split("=");
        return [name, decodeURIComponent(value.join("="))];
      }),
  );
}

function sessionCookie(sessionId: string, maxAgeSeconds = 60 * 60 * 24 * 7) {
  const secure = Bun.env.NODE_ENV === "production" ? "; Secure" : "";
  return `uwu_session=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${secure}`;
}

function clearSessionCookie() {
  return sessionCookie("", 0);
}

function currentUser(req: Request) {
  const sessionId = parseCookies(req).uwu_session;
  const user = sessionId ? getSessionUser(sessionId) : null;
  return user?.enabled ? user : null;
}

function tokenUser(token: string | null) {
  const user = token ? getUserByApiToken(token) : null;
  return user?.enabled ? user : null;
}

function authError(req: Request, minimumRole: UserRole = "readonly") {
  const user = currentUser(req);
  if (!user) return Response.json({ error: "Login required" }, { status: 401 });
  if (user.mustChangePassword) return Response.json({ error: "Password change required" }, { status: 403 });
  if (!hasRole(user, minimumRole)) return Response.json({ error: "Permission denied" }, { status: 403 });
  return null;
}

function hasRole(user: AuthUser, minimumRole: UserRole) {
  const levels: Record<UserRole, number> = { readonly: 0, manager: 1, admin: 2 };
  return levels[user.role] >= levels[minimumRole];
}

function isAccountManager(user: AuthUser) {
  return user.role === "admin" || user.role === "manager";
}

function auditActor(user: AuthUser) {
  return {
    actorId: user.id,
    actorUsername: user.username,
    actorRole: user.role,
  };
}

async function convertWithFfmpeg(content: Buffer, sourceName: string, outputExtension: string, args: string[], errorMessage: string) {
  const conversionId = crypto.randomUUID();
  const tempPath = join(tmpdir(), `uwu-asset-${conversionId}-${sourceName.replaceAll(/[^\w.-]/g, "_")}`);
  const outputPath = join(tmpdir(), `uwu-asset-${conversionId}.${outputExtension}`);

  try {
    await Bun.write(tempPath, content);
    const process = Bun.spawn(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", tempPath, ...args, outputPath], {
      stderr: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([process.exited, new Response(process.stderr).text()]);
    if (exitCode !== 0) {
      throw new Error(stderr.trim() || errorMessage);
    }

    return Buffer.from(await Bun.file(outputPath).arrayBuffer());
  } finally {
    for (const path of [tempPath, outputPath]) {
      if (existsSync(path)) rmSync(path, { force: true });
    }
  }
}

async function convertAudioToOgg(content: Buffer, sourceName: string) {
  return convertWithFfmpeg(content, sourceName, "ogg", ["-vn", "-c:a", "libopus"], "ffmpeg could not convert audio to Ogg");
}

async function convertVideoToWebm(content: Buffer, sourceName: string) {
  return convertWithFfmpeg(
    content,
    sourceName,
    "webm",
    ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "32", "-c:a", "libopus"],
    "ffmpeg could not convert video to WebM",
  );
}

async function convertStoredVideoInBackground(assetId: string, sourcePath: string, outputPath: string) {
  updateAssetConversion(assetId, "processing", 1);

  try {
    const process = Bun.spawn(
      ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", sourcePath, "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "32", "-c:a", "libopus", "-progress", "pipe:1", outputPath],
      { stdout: "pipe", stderr: "pipe" },
    );
    const reader = process.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let durationUs = 0;

    const probe = Bun.spawn(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", sourcePath], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [probeExit, probeText] = await Promise.all([probe.exited, new Response(probe.stdout).text()]);
    if (probeExit === 0) {
      const durationSeconds = Number(probeText.trim());
      durationUs = Number.isFinite(durationSeconds) ? durationSeconds * 1_000_000 : 0;
    }

    while (true) {
      const { done, value } = await reader.read();
      if (value) {
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const [key, rawValue] = line.split("=", 2);
          if (key === "out_time_us" && durationUs > 0) {
            const outTimeUs = Number(rawValue);
            if (Number.isFinite(outTimeUs)) {
              updateAssetConversion(assetId, "processing", Math.min(99, (outTimeUs / durationUs) * 100));
            }
          }
        }
      }
      if (done) break;
    }

    const [exitCode, stderr] = await Promise.all([process.exited, new Response(process.stderr).text()]);
    if (exitCode !== 0) throw new Error(stderr.trim() || "ffmpeg could not convert video to WebM");

    updateAssetConversion(assetId, "ready", 100, "", fileSize(outputPath));
  } catch (error) {
    updateAssetConversion(assetId, "failed", 100, error instanceof Error ? error.message : String(error));
  } finally {
    if (existsSync(sourcePath)) unlinkSync(sourcePath);
  }
}

function assetPageParams(req: Request) {
  const params = new URL(req.url).searchParams;
  const parsedLimit = Number(params.get("limit"));
  const parsedOffset = Number(params.get("offset"));
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(Math.floor(parsedLimit), 100) : defaultAssetPageSize;
  const offset = Number.isFinite(parsedOffset) && parsedOffset > 0 ? Math.floor(parsedOffset) : 0;
  return { limit, offset };
}

async function assetResponse(req: Request, mode: "id" | "name", key: string) {
  const asset = mode === "id" ? getAssetById(key) : getAssetByName(key);
  if (!asset) return Response.json({ error: "Asset not found" }, { status: 404 });

  const token = new URL(req.url).searchParams.get("token");
  const settings = getProjectSettings(asset.projectId);
  const user = currentUser(req);
  const userFromToken = token === settings.assetToken ? null : tokenUser(token);
  const hasSessionAccess = Boolean(user && !user.mustChangePassword);
  const hasProjectTokenAccess = token === settings.assetToken;
  const hasLoginTokenAccess = Boolean(userFromToken && !userFromToken.mustChangePassword);
  if (!hasSessionAccess && !hasProjectTokenAccess && !hasLoginTokenAccess) {
    return Response.json({ error: "Invalid asset token" }, { status: 401 });
  }

  const shouldServePreview = new URL(req.url).searchParams.get("preview") === "1";
  if (asset.kind === "Video" && asset.conversionStatus !== "ready") {
    console.warn(`Video asset ${asset.id} is not ready: ${asset.conversionStatus} ${asset.conversionProgress}%`);
    return Response.json(
      {
        error: "Video not ready yet",
        assetId: asset.id,
        status: asset.conversionStatus,
        progress: asset.conversionProgress,
        trace: asset.conversionError,
      },
      { status: 409 },
    );
  }
  const file = Bun.file(shouldServePreview ? assetPreviewFilePath(asset.name) : assetFilePath(asset.name));
  if (!(await file.exists())) {
    return Response.json({ error: "Asset file not found" }, { status: 404 });
  }

  return new Response(file, {
    headers: {
      "Content-Type": shouldServePreview ? "image/webp" : asset.mimeType || "application/octet-stream",
      "Content-Disposition": `inline; filename="${(shouldServePreview ? `${asset.name}.preview.webp` : asset.name).replaceAll('"', "")}"`,
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}

const server = serve({
  port: Bun.env.PORT ? Number(Bun.env.PORT) : 3000,
  routes: {
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

    "/api/auth/me": {
      async GET(req) {
        const user = currentUser(req);
        return Response.json({ user });
      },
    },

    "/api/auth/login": {
      async POST(req) {
        const body = (await req.json()) as { username?: string; password?: string };
        const username = body.username?.trim() ?? "";
        const password = body.password ?? "";
        const user = await verifyUserPassword(username, password);
        if (!user) return Response.json({ error: "Invalid username or password" }, { status: 401 });

        const sessionId = createSession(user.id);
        return Response.json(
          { user, token: user.apiToken },
          {
            headers: {
              "Set-Cookie": sessionCookie(sessionId),
            },
          },
        );
      },
    },

    "/api/auth/password": {
      async PUT(req) {
        const user = currentUser(req);
        if (!user) return Response.json({ error: "Login required" }, { status: 401 });

        const body = (await req.json()) as { currentPassword?: string; newPassword?: string };
        const currentPassword = body.currentPassword ?? "";
        const newPassword = body.newPassword ?? "";
        if (newPassword.length < 8) return Response.json({ error: "New password must be at least 8 characters" }, { status: 400 });
        if (newPassword === "admin") return Response.json({ error: "New password cannot be the default password" }, { status: 400 });

        const verifiedUser = await verifyUserPassword(user.username, currentPassword);
        if (!verifiedUser) return Response.json({ error: "Current password is incorrect" }, { status: 401 });

        const updatedUser = await updateUserPassword(user.id, newPassword);
        return Response.json({ user: updatedUser });
      },
    },

    "/api/auth/users": {
      async GET(req) {
        const requester = currentUser(req);
        if (!requester) return Response.json({ error: "Login required" }, { status: 401 });
        if (requester.mustChangePassword) return Response.json({ error: "Password change required" }, { status: 403 });
        if (!isAccountManager(requester)) return Response.json({ error: "Permission denied" }, { status: 403 });
        return Response.json({ users: listUsers() });
      },
      async POST(req) {
        const requester = currentUser(req);
        if (!requester) return Response.json({ error: "Login required" }, { status: 401 });
        if (requester.mustChangePassword) return Response.json({ error: "Password change required" }, { status: 403 });
        if (!isAccountManager(requester)) return Response.json({ error: "Permission denied" }, { status: 403 });

        const body = (await req.json()) as { username?: string; password?: string; role?: UserRole };
        const username = body.username?.trim() ?? "";
        const password = body.password ?? "";
        const role = body.role === "manager" ? "manager" : body.role === "readonly" ? "readonly" : null;
        if (!username) return Response.json({ error: "Username is required" }, { status: 400 });
        if (password.length < 8) return Response.json({ error: "Password must be at least 8 characters" }, { status: 400 });
        if (!role) return Response.json({ error: "Role must be readonly or manager" }, { status: 400 });
        if (listUsers().some(user => user.username.toLowerCase() === username.toLowerCase())) {
          return Response.json({ error: "Username already exists" }, { status: 409 });
        }

        const user = await createUser(username, password, role);
        return Response.json({ user }, { status: 201 });
      },
    },

    "/api/auth/users/:userId": {
      async PATCH(req) {
        const requester = currentUser(req);
        if (!requester) return Response.json({ error: "Login required" }, { status: 401 });
        if (requester.mustChangePassword) return Response.json({ error: "Password change required" }, { status: 403 });

        const target = getUserById(req.params.userId);
        if (!target) return Response.json({ error: "Account not found" }, { status: 404 });
        const canUpdateTarget = requester.id === target.id || requester.role === "admin" || (requester.role === "manager" && target.role === "readonly");
        if (!canUpdateTarget) return Response.json({ error: "Permission denied" }, { status: 403 });

        const body = (await req.json()) as { enabled?: boolean; password?: string; regenerateToken?: boolean };
        if (typeof body.password === "string") {
          if (body.password.length < 8) return Response.json({ error: "Password must be at least 8 characters" }, { status: 400 });
          if (body.password === "admin") return Response.json({ error: "Password cannot be the default password" }, { status: 400 });
          return Response.json({ user: await updateUserPassword(target.id, body.password) });
        }

        if (body.regenerateToken === true) {
          if (!isAccountManager(requester)) return Response.json({ error: "Permission denied" }, { status: 403 });
          if (requester.role === "manager" && target.role !== "readonly" && requester.id !== target.id) {
            return Response.json({ error: "Managers can only regenerate readonly account tokens" }, { status: 403 });
          }
          return Response.json({ user: regenerateUserApiToken(target.id) });
        }

        if (typeof body.enabled === "boolean") {
          if (!isAccountManager(requester)) return Response.json({ error: "Permission denied" }, { status: 403 });
          if (requester.id === target.id) return Response.json({ error: "You cannot disable your own account" }, { status: 400 });
          return Response.json({ user: updateUserEnabled(target.id, body.enabled) });
        }

        return Response.json({ error: "Nothing to update" }, { status: 400 });
      },
      async DELETE(req) {
        const requester = currentUser(req);
        if (!requester) return Response.json({ error: "Login required" }, { status: 401 });
        if (requester.mustChangePassword) return Response.json({ error: "Password change required" }, { status: 403 });
        if (!isAccountManager(requester)) return Response.json({ error: "Permission denied" }, { status: 403 });
        if (requester.id === req.params.userId) return Response.json({ error: "You cannot delete your own account" }, { status: 400 });

        const target = getUserById(req.params.userId);
        if (!target) return Response.json({ error: "Account not found" }, { status: 404 });
        if (requester.role === "manager" && target.role !== "readonly") {
          return Response.json({ error: "Managers can only remove readonly accounts" }, { status: 403 });
        }

        return Response.json({ deleted: deleteUser(target.id) });
      },
    },

    "/api/auth/logout": {
      async POST(req) {
        const sessionId = parseCookies(req).uwu_session;
        if (sessionId) deleteSession(sessionId);
        return Response.json(
          { ok: true },
          {
            headers: {
              "Set-Cookie": clearSessionCookie(),
            },
          },
        );
      },
    },

    "/api/storage-usage": {
      async GET(req) {
        const unauthorized = authError(req);
        if (unauthorized) return unauthorized;
        return Response.json({ bytes: storageUsageBytes(), disk: diskStorage() });
      },
    },

    "/api/projects": {
      async GET(req) {
        const unauthorized = authError(req);
        if (unauthorized) return unauthorized;
        return Response.json({ projects: listProjects() });
      },
      async POST(req) {
        const unauthorized = authError(req, "manager");
        if (unauthorized) return unauthorized;
        const body = (await req.json()) as { name?: string };
        const name = body.name?.trim();

        if (!name) {
          return Response.json({ error: "Project name is required" }, { status: 400 });
        }

        const project = createProject(name);
        const user = currentUser(req);
        if (user) {
          recordAuditLog({
            projectId: project.id,
            ...auditActor(user),
            action: "created project",
            targetType: "project",
            targetId: project.id,
            targetName: project.name,
          });
        }

        return Response.json({ project }, { status: 201 });
      },
    },

    "/api/projects/:projectId": {
      async GET(req) {
        const unauthorized = authError(req);
        if (unauthorized) return unauthorized;
        const project = getProject(req.params.projectId);
        if (!project) return Response.json({ error: "Project not found" }, { status: 404 });
        const page = { limit: defaultAssetPageSize, offset: 0 };

        return Response.json({
          project,
          assets: {
            Image: listAssets(project.id, "Image", page),
            Audio: listAssets(project.id, "Audio", page),
            Video: listAssets(project.id, "Video", page),
          },
          audioLocalization: listLocalization(project.id, "audioLocalization"),
          textLocalization: listLocalization(project.id, "textLocalization"),
          settings: getProjectSettings(project.id),
        });
      },
      async DELETE(req) {
        const unauthorized = authError(req, "manager");
        if (unauthorized) return unauthorized;
        const project = getProject(req.params.projectId);
        const user = currentUser(req);
        if (project && user) {
          recordAuditLog({
            projectId: project.id,
            ...auditActor(user),
            action: "deleted project",
            targetType: "project",
            targetId: project.id,
            targetName: project.name,
          });
        }
        const deleted = deleteProject(req.params.projectId);
        return Response.json({ deleted });
      },
    },

    "/api/projects/:projectId/audit-logs": {
      async GET(req) {
        const unauthorized = authError(req);
        if (unauthorized) return unauthorized;
        const project = getProject(req.params.projectId);
        if (!project) return Response.json({ error: "Project not found" }, { status: 404 });
        return Response.json({ auditLogs: listAuditLogs(project.id, assetPageParams(req)) });
      },
    },

    "/api/projects/:projectId/assets": {
      async GET(req) {
        const unauthorized = authError(req);
        if (unauthorized) return unauthorized;
        const project = getProject(req.params.projectId);
        if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

        const kind = new URL(req.url).searchParams.get("kind") as AssetKind | null;
        if (kind && !assetKinds.has(kind)) {
          return Response.json({ error: "Invalid asset kind" }, { status: 400 });
        }

        return Response.json({ assets: listAssets(project.id, kind ?? undefined, assetPageParams(req)) });
      },
      async POST(req) {
        const unauthorized = authError(req, "manager");
        if (unauthorized) return unauthorized;
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

        const requestedAssetName = body.name?.trim();
        const assetName =
          body.kind === "Audio" && requestedAssetName
            ? oggAssetName(requestedAssetName)
            : body.kind === "Video" && requestedAssetName
              ? webmAssetName(requestedAssetName)
              : requestedAssetName;
        if (!body.originalName?.trim() || !assetName || !body.kind || !assetKinds.has(body.kind) || !body.contentBase64) {
          return Response.json({ error: "originalName, name, contentBase64, and valid kind are required" }, { status: 400 });
        }
        if (!isSafeAssetName(assetName)) {
          return Response.json({ error: "Asset name cannot contain path separators" }, { status: 400 });
        }

        mkdirSync(assetStoragePath, { recursive: true });
        const originalContent = Buffer.from(body.contentBase64, "base64");
        const isVideo = body.kind === "Video";
        const assetContent = body.kind === "Audio" ? await convertAudioToOgg(originalContent, body.originalName.trim()) : originalContent;
        const mimeType = body.kind === "Audio" ? "audio/ogg" : isVideo ? "video/webm" : body.mimeType;
        const writePath = isVideo ? assetFilePath(sourceVideoAssetName(assetName)) : assetFilePath(assetName);
        await Bun.write(writePath, assetContent);
        if (body.previewContentBase64) {
          await Bun.write(assetPreviewFilePath(assetName), Buffer.from(body.previewContentBase64, "base64"));
        }
        const asset = createAsset({
          projectId: project.id,
          originalName: body.originalName.trim(),
          name: assetName,
          kind: body.kind,
          sizeBytes: assetContent.byteLength,
          mimeType,
          metadata: body.metadata,
          conversionStatus: isVideo ? "queued" : "ready",
          conversionProgress: isVideo ? 0 : 100,
        });
        const user = currentUser(req);
        if (user) {
          recordAuditLog({
            projectId: project.id,
            ...auditActor(user),
            action: "uploaded asset",
            targetType: "asset",
            targetId: asset.id,
            targetName: asset.name,
            details: { kind: asset.kind, originalName: asset.originalName, sizeBytes: asset.sizeBytes },
          });
        }

        if (isVideo) {
          void convertStoredVideoInBackground(asset.id, writePath, assetFilePath(assetName));
        }

        return Response.json({ asset }, { status: 201 });
      },
    },

    "/api/assets/:assetId": {
      async PATCH(req) {
        const unauthorized = authError(req, "manager");
        if (unauthorized) return unauthorized;
        const asset = getAssetById(req.params.assetId);
        if (!asset) return Response.json({ error: "Asset not found" }, { status: 404 });

        const body = (await req.json()) as {
          originalName?: string;
          mimeType?: string;
          contentBase64?: string;
          previewContentBase64?: string;
          metadata?: string[];
        };
        if (!body.originalName?.trim() || !body.contentBase64) {
          return Response.json({ error: "originalName and contentBase64 are required" }, { status: 400 });
        }

        mkdirSync(assetStoragePath, { recursive: true });
        const originalContent = Buffer.from(body.contentBase64, "base64");
        const isVideo = asset.kind === "Video";
        const assetContent = asset.kind === "Audio" ? await convertAudioToOgg(originalContent, body.originalName.trim()) : originalContent;
        const mimeType = asset.kind === "Audio" ? "audio/ogg" : isVideo ? "video/webm" : body.mimeType ?? asset.mimeType;
        const writePath = isVideo ? assetFilePath(sourceVideoAssetName(asset.name)) : assetFilePath(asset.name);
        await Bun.write(writePath, assetContent);

        if (asset.kind === "Image") {
          if (!body.previewContentBase64) return Response.json({ error: "Image previewContentBase64 is required" }, { status: 400 });
          await Bun.write(assetPreviewFilePath(asset.name), Buffer.from(body.previewContentBase64, "base64"));
        }

        const updatedAsset = updateAssetFile({
          id: asset.id,
          originalName: body.originalName.trim(),
          sizeBytes: assetContent.byteLength,
          mimeType,
          metadata: body.metadata,
          conversionStatus: isVideo ? "queued" : "ready",
          conversionProgress: isVideo ? 0 : 100,
        });
        if (!updatedAsset) return Response.json({ error: "Asset could not be updated" }, { status: 500 });

        const user = currentUser(req);
        if (user) {
          recordAuditLog({
            projectId: asset.projectId,
            ...auditActor(user),
            action: "replaced asset",
            targetType: "asset",
            targetId: asset.id,
            targetName: asset.name,
            details: { kind: asset.kind, originalName: updatedAsset.originalName, sizeBytes: updatedAsset.sizeBytes },
          });
        }

        if (isVideo) {
          void convertStoredVideoInBackground(asset.id, writePath, assetFilePath(asset.name));
        }

        return Response.json({ asset: updatedAsset });
      },
      async DELETE(req) {
        const unauthorized = authError(req, "manager");
        if (unauthorized) return unauthorized;
        const asset = getAssetById(req.params.assetId);
        const deleted = deleteAsset(req.params.assetId);
        if (deleted && asset) {
          const path = assetFilePath(asset.name);
          if (existsSync(path)) unlinkSync(path);
          const sourcePath = assetFilePath(sourceVideoAssetName(asset.name));
          if (existsSync(sourcePath)) unlinkSync(sourcePath);
          const previewPath = assetPreviewFilePath(asset.name);
          if (existsSync(previewPath)) unlinkSync(previewPath);
          const user = currentUser(req);
          if (user) {
            recordAuditLog({
              projectId: asset.projectId,
              ...auditActor(user),
              action: "deleted asset",
              targetType: "asset",
              targetId: asset.id,
              targetName: asset.name,
              details: { kind: asset.kind, originalName: asset.originalName },
            });
          }
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
        const unauthorized = authError(req);
        if (unauthorized) return unauthorized;
        const project = getProject(req.params.projectId);
        if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

        const kind = req.params.kind as LocalizationKind;
        if (!localizationKinds.has(kind)) return Response.json({ error: "Invalid localization kind" }, { status: 400 });

        return Response.json({ rows: listLocalization(project.id, kind) });
      },
      async POST(req) {
        const unauthorized = authError(req, "manager");
        if (unauthorized) return unauthorized;
        const project = getProject(req.params.projectId);
        if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

        const kind = req.params.kind as LocalizationKind;
        if (!localizationKinds.has(kind)) return Response.json({ error: "Invalid localization kind" }, { status: 400 });

        const body = (await req.json()) as { id?: string; key?: string; values?: Record<string, string> };
        const key = body.key?.trim();
        if (!key) return Response.json({ error: "Localization key is required" }, { status: 400 });

        const row = upsertLocalization({
          id: body.id,
          projectId: project.id,
          kind,
          key,
          values: body.values ?? {},
        });
        const user = currentUser(req);
        if (user) {
          recordAuditLog({
            projectId: project.id,
            ...auditActor(user),
            action: body.id ? "updated localization" : "created localization",
            targetType: "localization",
            targetId: row.id,
            targetName: row.key,
            details: { kind, languages: Object.keys(row.values) },
          });
        }

        return Response.json({ row });
      },
    },

    "/api/localization/:localizationId": {
      async DELETE(req) {
        const unauthorized = authError(req, "manager");
        if (unauthorized) return unauthorized;
        const row = getLocalizationById(req.params.localizationId);
        const deleted = deleteLocalization(req.params.localizationId);
        const user = currentUser(req);
        if (deleted && row && user) {
          recordAuditLog({
            projectId: row.projectId,
            ...auditActor(user),
            action: "deleted localization",
            targetType: "localization",
            targetId: row.id,
            targetName: row.key,
            details: { kind: row.kind },
          });
        }
        return Response.json({ deleted });
      },
    },

    "/api/projects/:projectId/settings": {
      async GET(req) {
        const unauthorized = authError(req);
        if (unauthorized) return unauthorized;
        const project = getProject(req.params.projectId);
        if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

        return Response.json({ settings: getProjectSettings(project.id) });
      },
      async PUT(req) {
        const unauthorized = authError(req, "manager");
        if (unauthorized) return unauthorized;
        const project = getProject(req.params.projectId);
        if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

        const current = getProjectSettings(project.id);
        const body = (await req.json()) as { assetToken?: string; gptApiToken?: string };

        const settings = upsertProjectSettings(
          project.id,
          body.assetToken?.trim() || current.assetToken,
          body.gptApiToken ?? current.gptApiToken,
        );
        const changedFields = [
          settings.assetToken !== current.assetToken ? "assetToken" : null,
          settings.gptApiToken !== current.gptApiToken ? "gptApiToken" : null,
        ].filter(Boolean);
        const user = currentUser(req);
        if (changedFields.length && user) {
          recordAuditLog({
            projectId: project.id,
            ...auditActor(user),
            action: "updated settings",
            targetType: "settings",
            targetId: project.id,
            targetName: project.name,
            details: { changedFields },
          });
        }

        return Response.json({ settings });
      },
    },

    // Serve index.html for all unmatched routes.
    "/*": index,
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
