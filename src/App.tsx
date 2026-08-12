import {
  ChevronDown,
  Copy,
  Download,
  HardDrive,
  History,
  FileAudio,
  FileImage,
  FileVideo,
  FolderPlus,
  Globe2,
  Link2,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Play,
  Plus,
  Settings,
  Trash2,
  TriangleAlert,
  Upload,
  WandSparkles,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Toaster } from "@/components/ui/sonner";
import { toast as showToast } from "sonner";
import "./index.css";

type AssetKind = "Image" | "Audio" | "Video";
type LocalizationKind = "audioLocalization" | "textLocalization";
type Tab = AssetKind | "Audio Localization" | "Text Localization" | "Audit Logs" | "Settings";

type Asset = {
  id: string;
  originalName: string;
  name: string;
  kind: AssetKind;
  sizeBytes: number;
  mimeType: string;
  metadata: string[];
  conversionStatus: "queued" | "processing" | "ready" | "failed";
  conversionProgress: number;
  conversionError: string;
  updatedAt: string;
};

type LocalizationRow = {
  id?: string;
  key: string;
  values: Record<string, string>;
};

type Project = {
  id: string;
  name: string;
  assets: Record<AssetKind, Asset[]>;
  audioLocalization: LocalizationRow[];
  textLocalization: LocalizationRow[];
};

type AuditLog = {
  id: string;
  actorUsername: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetName: string | null;
  details: Record<string, unknown>;
  createdAt: string;
};

type UploadProgress = {
  title: string;
  detail: string;
  percent: number;
};

type PreviewAsset = {
  asset: Asset;
  previewUrl: string;
  originalUrl: string;
};

type StorageUsage = {
  bytes: number;
  disk: {
    availableBytes: number;
    totalBytes: number;
  };
};

type UserRole = "admin" | "manager" | "readonly";

type AuthUser = {
  id: string;
  username: string;
  role: UserRole;
  enabled: boolean;
  mustChangePassword: boolean;
};

const assetPageSize = 50;
const selectedProjectStorageKey = "uwu-assets:selectedProjectId";
const selectedTabStorageKey = "uwu-assets:selectedTab";
const tabs: Tab[] = ["Image", "Audio", "Video", "Audio Localization", "Text Localization", "Audit Logs", "Settings"];
const languages = ["en", "vi", "ja", "ko", "th", "zh"];
const primaryLanguage = "en";
const secondaryLanguages = languages.filter(language => language !== primaryLanguage);
const emptyAssets = (): Record<AssetKind, Asset[]> => ({ Image: [], Audio: [], Video: [] });
const supportedImageExtensions = new Set(["png", "svg", "jpg", "jpeg", "webp"]);
const imageUploadAccept = ".png,.svg,.jpg,.jpeg,.webp,image/png,image/svg+xml,image/jpeg,image/webp";

function emptyProject(id: string, name: string): Project {
  return { id, name, assets: emptyAssets(), audioLocalization: [], textLocalization: [] };
}

function formatBytes(bytes: number) {
  const units = ["KB", "MB", "GB", "TB"];
  let value = Math.max(0, bytes) / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  if (unitIndex === 0) return `${Math.max(1, Math.round(value))} ${units[unitIndex]}`;
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[unitIndex]}`;
}

function isAssetTab(tab: Tab): tab is AssetKind {
  return tab === "Image" || tab === "Audio" || tab === "Video";
}

function isTab(value: string | null): value is Tab {
  return tabs.includes(value as Tab);
}

function mapAssetPayload(asset: any): Asset {
  return {
    id: asset.id,
    originalName: asset.originalName,
    name: asset.name,
    kind: asset.kind,
    sizeBytes: asset.sizeBytes,
    mimeType: asset.mimeType,
    metadata: asset.metadata ?? [],
    conversionStatus: asset.conversionStatus ?? "ready",
    conversionProgress: asset.conversionProgress ?? 100,
    conversionError: asset.conversionError ?? "",
    updatedAt: asset.updatedAt,
  };
}

function mapProjectPayload(data: any): Project {
  const mapLocalization = (row: any): LocalizationRow => ({
    id: row.id,
    key: row.key,
    values: row.values ?? {},
  });

  return {
    id: data.project.id,
    name: data.project.name,
    assets: {
      Image: (data.assets.Image ?? []).map(mapAssetPayload),
      Audio: (data.assets.Audio ?? []).map(mapAssetPayload),
      Video: (data.assets.Video ?? []).map(mapAssetPayload),
    },
    audioLocalization: (data.audioLocalization ?? []).map(mapLocalization),
    textLocalization: (data.textLocalization ?? []).map(mapLocalization),
  };
}

function uploadName(fileName: string, kind: AssetKind) {
  const extension = kind === "Image" ? "webp" : kind === "Video" ? "webm" : "ogg";
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hash = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hash}.${extension}`;
}

function imageExtension(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

function isSupportedImageFile(file: File) {
  return supportedImageExtensions.has(imageExtension(file.name));
}

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Could not read image file")));
    reader.readAsDataURL(file);
  });
}

async function fileToBase64(file: File) {
  return (await readAsDataUrl(file)).split(",", 2)[1] ?? "";
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", () => reject(new Error("Could not decode image file")));
    image.src = source;
  });
}

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function startProcessingProgress(setProgress: Dispatch<SetStateAction<UploadProgress | null>>, title: string, detail: string, floor: number) {
  const ceiling = 92;
  const startedAt = performance.now();
  setProgress({ title, detail, percent: floor });

  const timer = window.setInterval(() => {
    const elapsed = performance.now() - startedAt;
    const easedPercent = floor + (ceiling - floor) * (1 - Math.exp(-elapsed / 7000));
    setProgress(current => {
      if (!current) return current;
      return { ...current, title, detail, percent: Math.max(current.percent, Math.min(ceiling, Math.round(easedPercent))) };
    });
  }, 500);

  return () => window.clearInterval(timer);
}

async function normalizeImageToWebp(file: File) {
  return imageFileToWebp(file);
}

async function imageFileToWebp(file: File, maxSize?: number) {
  const image = await loadImage(await readAsDataUrl(file));
  const canvas = document.createElement("canvas");
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const scale = maxSize ? Math.min(1, maxSize / Math.max(sourceWidth, sourceHeight)) : 1;
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext("2d");
  if (!context || !canvas.width || !canvas.height) throw new Error(`Could not normalize ${file.name}`);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/webp", 0.92));
  if (!blob) throw new Error(`Could not convert ${file.name} to WebP`);
  return new File([blob], uploadName(file.name, "Image"), { type: "image/webp", lastModified: Date.now() });
}

async function generateImagePreview(file: File, normalizedName: string) {
  const preview = await imageFileToWebp(file, 256);
  return new File([preview], `${normalizedName}.preview.webp`, { type: "image/webp", lastModified: Date.now() });
}

export function App() {
  const [authUser, setAuthUser] = useState<AuthUser | null | undefined>(undefined);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState(() => localStorage.getItem(selectedProjectStorageKey) ?? "");
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const savedTab = localStorage.getItem(selectedTabStorageKey);
    return isTab(savedTab) ? savedTab : "Image";
  });
  const [token, setToken] = useState("");
  const [gptApiToken, setGptApiToken] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isProjectDialogOpen, setIsProjectDialogOpen] = useState(false);
  const [isDeleteProjectDialogOpen, setIsDeleteProjectDialogOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [deleteProjectName, setDeleteProjectName] = useState("");
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [previewAsset, setPreviewAsset] = useState<PreviewAsset | null>(null);
  const [deleteAssetTarget, setDeleteAssetTarget] = useState<Asset | null>(null);
  const [assetHasMore, setAssetHasMore] = useState<Record<AssetKind, boolean>>({ Image: true, Audio: true, Video: true });
  const [isLoadingMoreAssets, setIsLoadingMoreAssets] = useState(false);
  const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [isLoadingAuditLogs, setIsLoadingAuditLogs] = useState(false);
  const [isAccountPanelOpen, setIsAccountPanelOpen] = useState(false);
  const [isAddAccountDialogOpen, setIsAddAccountDialogOpen] = useState(false);
  const [accountUsers, setAccountUsers] = useState<AuthUser[]>([]);
  const [passwordChangeTarget, setPasswordChangeTarget] = useState<AuthUser | null>(null);
  const [passwordChangeForm, setPasswordChangeForm] = useState({ newPassword: "", confirmPassword: "" });
  const [newAccountForm, setNewAccountForm] = useState<{ username: string; password: string; role: Exclude<UserRole, "admin"> }>({
    username: "",
    password: "",
    role: "readonly",
  });

  const activeProject = projects.find(project => project.id === activeProjectId) ?? projects[0];
  const activeLocalizationKind: LocalizationKind | null =
    activeTab === "Audio Localization" ? "audioLocalization" : activeTab === "Text Localization" ? "textLocalization" : null;
  const tabAssetCount = activeLocalizationKind
    ? activeProject?.[activeLocalizationKind].length ?? 0
    : activeTab === "Audit Logs"
      ? auditLogs.length
    : activeTab === "Settings"
      ? 2
      : isAssetTab(activeTab)
        ? activeProject?.assets[activeTab].length ?? 0
        : 0;
  const totalAssets = useMemo(
    () => projects.reduce((sum, project) => sum + project.assets.Image.length + project.assets.Audio.length + project.assets.Video.length, 0),
    [projects],
  );
  const canManageAssets = authUser?.role === "admin" || authUser?.role === "manager";
  const canManageAccounts = canManageAssets;
  const visibleTabs = canManageAssets ? tabs : tabs.filter(tab => tab !== "Settings");

  const loadCurrentUser = async () => {
    const response = await fetch("/api/auth/me");
    if (!response.ok) throw new Error("Could not check login session");
    const data = (await response.json()) as { user: AuthUser | null };
    setAuthUser(data.user);
    return data.user;
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setAuthUser(null);
    setProjects([]);
    setActiveProjectId("");
    showToast.success("Signed out");
  };

  const loadProject = async (projectId: string) => {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`);
    if (!response.ok) throw new Error("Could not load project from database");
    const data = await response.json();
    const project = mapProjectPayload(data);
    setProjects(current => current.map(item => (item.id === project.id ? project : item)));
    setAssetHasMore({
      Image: project.assets.Image.length === assetPageSize,
      Audio: project.assets.Audio.length === assetPageSize,
      Video: project.assets.Video.length === assetPageSize,
    });
    setToken(data.settings.assetToken);
    setGptApiToken(data.settings.gptApiToken);
    return project;
  };

  const loadProjects = async () => {
    const response = await fetch("/api/projects");
    if (!response.ok) throw new Error("Could not load projects from database");
    const data = (await response.json()) as { projects: Array<{ id: string; name: string }> };
    const shells = data.projects.map(project => emptyProject(project.id, project.name));
    const savedProjectId = localStorage.getItem(selectedProjectStorageKey);
    const selectedProject = shells.find(project => project.id === savedProjectId) ?? shells[0];
    setProjects(shells);
    if (selectedProject) {
      setActiveProjectId(selectedProject.id);
      await loadProject(selectedProject.id);
    } else {
      setActiveProjectId("");
    }
    await loadStorageUsage();
  };

  const loadStorageUsage = async () => {
    const response = await fetch("/api/storage-usage");
    if (!response.ok) throw new Error("Could not load storage usage");
    const data = (await response.json()) as StorageUsage;
    setStorageUsage(data);
  };

  const loadAccountUsers = async () => {
    if (!canManageAccounts) return;
    const response = await fetch("/api/auth/users");
    if (!response.ok) throw new Error("Could not load accounts");
    const data = (await response.json()) as { users: AuthUser[] };
    setAccountUsers(data.users);
  };

  const loadAuditLogs = async (projectId: string) => {
    setIsLoadingAuditLogs(true);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/audit-logs?limit=100`);
      if (!response.ok) throw new Error("Could not load audit logs");
      const data = (await response.json()) as { auditLogs: AuditLog[] };
      setAuditLogs(data.auditLogs);
    } finally {
      setIsLoadingAuditLogs(false);
    }
  };

  const refreshAuditLogsIfOpen = async (projectId: string) => {
    if (activeTab === "Audit Logs") await loadAuditLogs(projectId);
  };

  const openAccountDialog = () => {
    setNewAccountForm({ username: "", password: "", role: "readonly" });
    setIsAccountPanelOpen(true);
    void loadAccountUsers().catch(error => showToast.error(error instanceof Error ? error.message : String(error)));
  };

  useEffect(() => {
    loadCurrentUser().catch(error => {
      setAuthUser(null);
      showToast.error(String(error));
    });
  }, []);

  useEffect(() => {
    if (authUser && !authUser.mustChangePassword) {
      loadProjects().catch(error => showToast.error(String(error)));
    }
  }, [authUser?.id, authUser?.mustChangePassword]);

  useEffect(() => {
    if (activeProjectId) localStorage.setItem(selectedProjectStorageKey, activeProjectId);
    else localStorage.removeItem(selectedProjectStorageKey);
  }, [activeProjectId]);

  useEffect(() => {
    localStorage.setItem(selectedTabStorageKey, activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (!canManageAssets && activeTab === "Settings") setActiveTab("Image");
  }, [activeTab, canManageAssets]);

  useEffect(() => {
    if (authUser && !authUser.mustChangePassword && activeProjectId) {
      loadProject(activeProjectId).catch(error => showToast.error(String(error)));
    }
  }, [activeProjectId, authUser?.id, authUser?.mustChangePassword]);

  useEffect(() => {
    if (authUser && !authUser.mustChangePassword && activeProjectId && activeTab === "Audit Logs") {
      loadAuditLogs(activeProjectId).catch(error => showToast.error(error instanceof Error ? error.message : String(error)));
    }
  }, [activeProjectId, activeTab, authUser?.id, authUser?.mustChangePassword]);

  useEffect(() => {
    if (
      !authUser ||
      authUser.mustChangePassword ||
      !activeProject ||
      !activeProject.assets.Video.some(asset => asset.conversionStatus === "queued" || asset.conversionStatus === "processing")
    ) {
      return;
    }
    const timer = window.setInterval(() => {
      loadProject(activeProject.id).catch(error => showToast.error(String(error)));
    }, 2000);
    return () => window.clearInterval(timer);
  }, [activeProject, authUser?.id, authUser?.mustChangePassword]);

  const loadMoreAssets = async (kind: AssetKind) => {
    if (!activeProject || isLoadingMoreAssets || !assetHasMore[kind]) return;
    setIsLoadingMoreAssets(true);
    try {
      const offset = activeProject.assets[kind].length;
      const response = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/assets?kind=${encodeURIComponent(kind)}&offset=${offset}&limit=${assetPageSize}`);
      if (!response.ok) throw new Error(`Could not load more ${kind.toLowerCase()} assets`);
      const data = (await response.json()) as { assets: any[] };
      const nextAssets = data.assets.map(mapAssetPayload);
      setProjects(current =>
        current.map(project =>
          project.id === activeProject.id
            ? { ...project, assets: { ...project.assets, [kind]: [...project.assets[kind], ...nextAssets] } }
            : project,
        ),
      );
      setAssetHasMore(current => ({ ...current, [kind]: nextAssets.length === assetPageSize }));
    } catch (error) {
      showToast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoadingMoreAssets(false);
    }
  };

  const assetUrl = (asset: Asset, mode: "id" | "name") => {
    const key = mode === "id" ? asset.id : asset.name;
    const path = `/assets/${mode}/${encodeURIComponent(key)}`;
    return authUser ? `${location.origin}${path}` : `${location.origin}${path}?token=${encodeURIComponent(token)}`;
  };

  const assetPreviewUrl = (asset: Asset) => {
    const url = assetUrl(asset, "name");
    return `${url}${url.includes("?") ? "&" : "?"}preview=1`;
  };

  const copyToClipboard = async (value: string, label: string) => {
    await navigator.clipboard?.writeText(value);
    showToast.success(label);
  };

  const addProject = async () => {
    const name = newProjectName.trim();
    if (!name) return showToast.warning("Project name is required");
    const response = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    const data = await response.json();
    const project = emptyProject(data.project.id, data.project.name);
    setProjects(current => [project, ...current]);
    setActiveProjectId(project.id);
    setActiveTab("Image");
    setIsProjectDialogOpen(false);
    await loadStorageUsage();
    showToast.success(`Created ${project.name} in database`);
  };

  const deleteActiveProject = async () => {
    if (!activeProject) return;
    if (deleteProjectName !== activeProject.name) return showToast.warning("Project name does not match");
    await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}`, { method: "DELETE" });
    const remaining = projects.filter(project => project.id !== activeProject.id);
    setProjects(remaining);
    setActiveProjectId(remaining[0]?.id ?? "");
    setIsDeleteProjectDialogOpen(false);
    await loadStorageUsage();
    showToast.success(remaining.length ? `Deleted ${activeProject.name} from database` : "No projects found in SQLite database");
  };

  const addUploadedFiles = async (files: FileList | null, uploadKind?: AssetKind) => {
    const kind = uploadKind ?? (isAssetTab(activeTab) ? activeTab : null);
    if (!files?.length || !activeProject || !kind) return;
    const selectedFiles = Array.from(files);
    const unsupportedImages = kind === "Image" ? selectedFiles.filter(file => !isSupportedImageFile(file)) : [];
    if (unsupportedImages.length) {
      showToast.warning(`Image assets must be .png, .svg, .jpg, or .webp: ${unsupportedImages.map(file => file.name).join(", ")}`);
      return;
    }
    const startedAt = performance.now();
    let savedCount = 0;
    const totalSteps = selectedFiles.length * (kind === "Image" ? 2 : 1) + 1;
    let completedSteps = 0;
    const showProgress = (title: string, detail: string) => {
      setUploadProgress({ title, detail, percent: Math.min(98, Math.round((completedSteps / totalSteps) * 100)) });
    };

    setUploadProgress({ title: "Preparing upload", detail: `${selectedFiles.length} ${kind.toLowerCase()} asset(s) selected`, percent: 4 });

    try {
      for (const originalFile of selectedFiles) {
        showProgress(kind === "Image" ? "Normalizing image" : "Preparing asset", originalFile.name);
        const normalizedFile = kind === "Image" ? await normalizeImageToWebp(originalFile) : originalFile;
        const previewFile = kind === "Image" ? await generateImagePreview(originalFile, normalizedFile.name) : null;
        completedSteps += 1;

        const uploadTitle = kind === "Video" ? "Converting video" : kind === "Audio" ? "Converting audio" : "Uploading asset";
        const uploadDetail = kind === "Image" ? `${normalizedFile.name} as WebP` : originalFile.name;
        const progressFloor = Math.min(88, Math.max(8, Math.round((completedSteps / totalSteps) * 100)));
        const stopProcessingProgress = startProcessingProgress(setUploadProgress, uploadTitle, uploadDetail, progressFloor);
        try {
          const response = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/assets`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              originalName: originalFile.name,
              name: kind === "Image" ? normalizedFile.name : uploadName(originalFile.name, kind),
              kind,
              sizeBytes: normalizedFile.size,
              mimeType: normalizedFile.type,
              contentBase64: await fileToBase64(normalizedFile),
              previewContentBase64: previewFile ? await fileToBase64(previewFile) : undefined,
              metadata: [
                kind === "Image" ? "converted to webp" : kind === "Video" ? "converted to webm" : "converted to ogg",
                originalFile.type || "unknown mime",
              ],
            }),
          });
          if (!response.ok) throw new Error(`Could not upload ${originalFile.name}`);
        } finally {
          stopProcessingProgress();
        }
        savedCount += 1;
        completedSteps += 1;
      }

      showProgress("Refreshing assets", "Loading saved database rows");
      await loadProject(activeProject.id);
      await refreshAuditLogsIfOpen(activeProject.id);
      await loadStorageUsage();
      completedSteps = totalSteps;
      setUploadProgress({ title: "Upload complete", detail: `Saved ${savedCount} ${kind.toLowerCase()} asset(s)`, percent: 100 });
      showToast.success(`Saved ${savedCount} ${kind.toLowerCase()} asset(s) to database`);
    } catch (error) {
      setUploadProgress({ title: "Upload failed", detail: error instanceof Error ? error.message : String(error), percent: 100 });
      showToast.error(error instanceof Error ? error.message : String(error));
    } finally {
      await wait(Math.max(0, 1000 - (performance.now() - startedAt)));
      setUploadProgress(null);
    }
  };

  const removeAsset = async (asset: Asset) => {
    if (!activeProject) return;
    await fetch(`/api/assets/${encodeURIComponent(asset.id)}`, { method: "DELETE" });
    await loadProject(activeProject.id);
    await refreshAuditLogsIfOpen(activeProject.id);
    await loadStorageUsage();
    showToast.success(`Removed ${asset.name} from database`);
  };

  const saveLocalization = async (kind: LocalizationKind, row: LocalizationRow) => {
    if (!activeProject || !row.key.trim()) return;
    await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/localization/${kind}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row),
    });
  };

  const updateLocalization = (kind: LocalizationKind, rowIndex: number, language: string, value: string) => {
    if (!activeProject) return;
    const currentRow = activeProject[kind][rowIndex];
    if (!currentRow) return;
    const row = { ...currentRow, values: { ...currentRow.values, [language]: value } };
    setProjects(current =>
      current.map(project =>
        project.id === activeProject.id ? { ...project, [kind]: project[kind].map((item, index) => (index === rowIndex ? row : item)) } : project,
      ),
    );
    void saveLocalization(kind, row);
  };

  const replaceLocalizationAudio = async (rowIndex: number, language: string, file: File) => {
    if (!activeProject) return;
    const currentRow = activeProject.audioLocalization[rowIndex];
    if (!currentRow) return;

    try {
      setUploadProgress({ title: "Replacing audio", detail: file.name, percent: 35 });
      const assetName = uploadName(file.name, "Audio");
      const response = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalName: file.name,
          name: assetName,
          kind: "Audio",
          sizeBytes: file.size,
          mimeType: file.type,
          contentBase64: await fileToBase64(file),
          metadata: ["converted to ogg", file.type || "unknown mime", `replaced ${currentRow.key}.${language}`],
        }),
      });
      if (!response.ok) throw new Error(`Could not upload ${file.name}`);

      const data = (await response.json()) as { asset: Asset };
      const row = { ...currentRow, values: { ...currentRow.values, [language]: data.asset.name } };
      setUploadProgress({ title: "Saving localization", detail: `${currentRow.key} ${language.toUpperCase()}`, percent: 80 });
      await saveLocalization("audioLocalization", row);
      await loadProject(activeProject.id);
      await refreshAuditLogsIfOpen(activeProject.id);
      await loadStorageUsage();
      showToast.success(`Replaced ${language.toUpperCase()} audio for ${currentRow.key}`);
    } catch (error) {
      showToast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setUploadProgress(null);
    }
  };

  const updateLocalizationKey = (kind: LocalizationKind, rowIndex: number, key: string) => {
    if (!activeProject) return;
    const currentRow = activeProject[kind][rowIndex];
    if (!currentRow) return;
    const row = { ...currentRow, key };
    setProjects(current =>
      current.map(project =>
        project.id === activeProject.id ? { ...project, [kind]: project[kind].map((item, index) => (index === rowIndex ? row : item)) } : project,
      ),
    );
    void saveLocalization(kind, row);
  };

  const removeLocalization = async (kind: LocalizationKind, rowIndex: number) => {
    if (!activeProject) return;
    const row = activeProject[kind][rowIndex];
    if (!row?.id) return;
    await fetch(`/api/localization/${encodeURIComponent(row.id)}`, { method: "DELETE" });
    await loadProject(activeProject.id);
    await refreshAuditLogsIfOpen(activeProject.id);
    showToast.success("Removed localization row from database");
  };

  const addLocalizationRecord = async (kind: LocalizationKind) => {
    if (!activeProject) return;
    const rows = activeProject[kind];
    const prefix = kind === "audioLocalization" ? "audio.record" : "text.record";
    const defaultValue = kind === "audioLocalization" ? "default.ogg" : "";
    const existingKeys = new Set(rows.map(row => row.key));
    let index = rows.length + 1;
    let key = `${prefix}.${index}`;

    while (existingKeys.has(key)) {
      index += 1;
      key = `${prefix}.${index}`;
    }

    await saveLocalization(kind, {
      key,
      values: Object.fromEntries(languages.map(language => [language, defaultValue])),
    });
    await loadProject(activeProject.id);
    await refreshAuditLogsIfOpen(activeProject.id);
    await loadStorageUsage();
    showToast.success("Added localization record to database");
  };

  const aiTranslate = async (kind: LocalizationKind) => {
    if (!activeProject) return;
    const rows = activeProject[kind].map(row => {
      const source = row.values[primaryLanguage] ?? "";
      const values = { ...row.values };
      secondaryLanguages.forEach(language => {
        values[language] ||= source ? `${source} (${language.toUpperCase()})` : "";
      });
      return { ...row, values };
    });
    await Promise.all(rows.map(row => saveLocalization(kind, row)));
    await loadProject(activeProject.id);
    await refreshAuditLogsIfOpen(activeProject.id);
    await loadStorageUsage();
    showToast.success("Saved AI translations to database");
  };

  const saveSettings = async (nextToken: string, nextGptApiToken: string) => {
    if (!activeProject) return;
    await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetToken: nextToken, gptApiToken: nextGptApiToken }),
    });
    await refreshAuditLogsIfOpen(activeProject.id);
  };

  const generateToken = () => {
    const nextToken = `asset_tok_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`;
    setToken(nextToken);
    void saveSettings(nextToken, gptApiToken);
    showToast.success("Generated and saved a new asset token");
  };

  const updateGptApiToken = (value: string) => {
    setGptApiToken(value);
    void saveSettings(token, value);
  };

  const openPasswordDialog = (user: AuthUser) => {
    setPasswordChangeTarget(user);
    setPasswordChangeForm({ newPassword: "", confirmPassword: "" });
  };

  const changeAccountPassword = async () => {
    if (!passwordChangeTarget) return;
    if (passwordChangeForm.newPassword !== passwordChangeForm.confirmPassword) return showToast.warning("Password confirmation does not match");
    const response = await fetch(`/api/auth/users/${encodeURIComponent(passwordChangeTarget.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: passwordChangeForm.newPassword }),
    });
    const data = await response.json();
    if (!response.ok) return showToast.error(data.error ?? "Could not update password");
    if (passwordChangeTarget.id === authUser?.id) setAuthUser(data.user);
    setPasswordChangeTarget(null);
    setPasswordChangeForm({ newPassword: "", confirmPassword: "" });
    await loadAccountUsers();
    showToast.success("Password updated");
  };

  const createAccount = async () => {
    const response = await fetch("/api/auth/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newAccountForm),
    });
    const data = await response.json();
    if (!response.ok) return showToast.error(data.error ?? "Could not create account");
    setNewAccountForm({ username: "", password: "", role: "readonly" });
    setIsAddAccountDialogOpen(false);
    await loadAccountUsers();
    showToast.success(`Created ${data.user.username}`);
  };

  const updateAccountEnabled = async (user: AuthUser, enabled: boolean) => {
    const response = await fetch(`/api/auth/users/${encodeURIComponent(user.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    const data = await response.json();
    if (!response.ok) return showToast.error(data.error ?? "Could not update account");
    await loadAccountUsers();
    showToast.success(`${user.username} ${enabled ? "enabled" : "disabled"}`);
  };

  const removeAccount = async (user: AuthUser) => {
    const response = await fetch(`/api/auth/users/${encodeURIComponent(user.id)}`, { method: "DELETE" });
    const data = await response.json();
    if (!response.ok) return showToast.error(data.error ?? "Could not remove account");
    await loadAccountUsers();
    showToast.success(`Removed ${user.username}`);
  };

  if (authUser === undefined) {
    return (
      <main className="auth-screen">
        <div className="auth-card">
          <div className="brand-mark">UwU</div>
          <h1>Loading account</h1>
        </div>
        <Toaster position="top-right" richColors closeButton />
      </main>
    );
  }

  if (!authUser || authUser.mustChangePassword) {
    return (
      <AuthPage
        user={authUser}
        onAuthenticated={user => {
          setAuthUser(user);
          if (!user.mustChangePassword) showToast.success(`Welcome, ${user.username}`);
        }}
      />
    );
  }

  if (!activeProject) {
    return (
      <main className="asset-app">
        <aside className="project-rail">
          <div className="brand-block">
            <div className="brand-mark">UwU</div>
            <div>
              <p>Asset Console</p>
              <DiskStorageLabel storageUsage={storageUsage} />
            </div>
          </div>
          <div className="project-action-row">
            <Button className="project-create" disabled={!canManageAssets} onClick={() => { setNewProjectName(""); setIsProjectDialogOpen(true); }}>
              <FolderPlus /> Project
            </Button>
            {canManageAccounts && <Button className="project-account" variant="outline" size="icon" onClick={openAccountDialog} title="Manage account" aria-label="Manage account">
              <Settings />
            </Button>}
          </div>
        </aside>

        <section className={isAccountPanelOpen ? "workspace" : "workspace empty-workspace"}>
          {isAccountPanelOpen && authUser ? (
            <AccountPanel
              currentUser={authUser}
              users={accountUsers}
              onAddAccount={() => setIsAddAccountDialogOpen(true)}
              onChangePassword={openPasswordDialog}
              onRemoveAccount={removeAccount}
              onUpdateAccountEnabled={updateAccountEnabled}
            />
          ) : <Card className="database-empty-state">
            <FolderPlus />
            <div>
              <h1>No projects yet</h1>
              <p>The SQLite database is connected, but it does not have any project rows to display.</p>
            </div>
            <Button disabled={!canManageAssets} onClick={() => { setNewProjectName(""); setIsProjectDialogOpen(true); }}>
              <FolderPlus /> Create project
            </Button>
          </Card>}
          <Toaster position="top-right" richColors closeButton />
        </section>

        {isProjectDialogOpen && (
          <div className="modal-backdrop" role="presentation">
            <form className="project-modal" onSubmit={event => { event.preventDefault(); void addProject(); }}>
              <div><h2>New project</h2><p>Enter a project name before creating its asset tabs.</p></div>
              <label>Project name<Input autoFocus value={newProjectName} onChange={event => setNewProjectName(event.target.value)} placeholder="Project Name" /></label>
              <div className="modal-actions"><Button type="button" variant="outline" onClick={() => setIsProjectDialogOpen(false)}>Cancel</Button><Button type="submit">Create project</Button></div>
            </form>
          </div>
        )}
        {isAddAccountDialogOpen && authUser && (
          <AddAccountModal
            newAccountForm={newAccountForm}
            onClose={() => setIsAddAccountDialogOpen(false)}
            onCreateAccount={createAccount}
            onNewAccountFormChange={setNewAccountForm}
          />
        )}
        {passwordChangeTarget && (
          <ChangePasswordModal
            target={passwordChangeTarget}
            form={passwordChangeForm}
            onClose={() => setPasswordChangeTarget(null)}
            onFormChange={setPasswordChangeForm}
            onSubmit={changeAccountPassword}
          />
        )}
      </main>
    );
  }

  return (
    <main className={isSidebarOpen ? "asset-app" : "asset-app sidebar-collapsed"}>
      <aside className="project-rail">
        <div className="brand-block">
          <div className="brand-mark">UwU</div>
          <div>
            <p>Asset Console</p>
            <DiskStorageLabel storageUsage={storageUsage} />
          </div>
        </div>
        <div className="project-action-row">
          <Button className="project-create" disabled={!canManageAssets} onClick={() => { setNewProjectName(""); setIsProjectDialogOpen(true); }}>
            <FolderPlus /> Project
          </Button>
          {canManageAccounts && <Button className="project-account" variant="outline" size="icon" onClick={openAccountDialog} title="Manage account" aria-label="Manage account">
            <Settings />
          </Button>}
        </div>
        <div className="project-list">
          {projects.map(project => (
            <button className={project.id === activeProject.id && !isAccountPanelOpen ? "project-item is-active" : "project-item"} key={project.id} onClick={() => { setIsAccountPanelOpen(false); setActiveProjectId(project.id); }}>
              <span>{project.name}</span>
              <small>{project.assets.Image.length + project.assets.Audio.length + project.assets.Video.length} assets</small>
            </button>
          ))}
        </div>
      </aside>

      <Button className="panel-toggle" variant="outline" size="icon" onClick={() => setIsSidebarOpen(current => !current)} title="Toggle project panel" aria-label="Toggle project panel">
        {isSidebarOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
      </Button>

      <section className="workspace">
        <header className="topbar">
          <div className="title-cluster"><div><span className="eyebrow">{isAccountPanelOpen ? "Admin" : "Project"}</span><h1>{isAccountPanelOpen ? "Manage accounts" : activeProject.name}</h1></div></div>
          <Button variant="outline" onClick={() => void logout()}><LogOut />Logout</Button>
        </header>
        {!isAccountPanelOpen && <section className="metric-row" aria-label="Project summary">
          <Card><strong>{totalAssets}</strong><span>Total assets</span></Card>
          <Card><strong>{tabAssetCount}</strong><span>Rows in view</span></Card>
          <Card><strong>{languages.length}</strong><span>Localization languages</span></Card>
          <Card><strong>{storageUsage === null ? "..." : formatBytes(storageUsage.bytes)}</strong><span>Storage usage</span></Card>
        </section>}
        {!isAccountPanelOpen && <nav className="tabbar" aria-label="Asset tabs">
          {visibleTabs.map(tab => {
            const Icon = tab === "Image" ? FileImage : tab === "Audio" ? FileAudio : tab === "Video" ? FileVideo : tab === "Audit Logs" ? History : tab === "Settings" ? Settings : Globe2;
            const tabClassName = [activeTab === tab ? "tab is-active" : "tab", tab === "Audit Logs" ? "audit-log-tab" : ""].filter(Boolean).join(" ");
            return <button className={tabClassName} key={tab} onClick={() => { setIsAccountPanelOpen(false); setActiveTab(tab); }}><Icon />{tab}</button>;
          })}
        </nav>}

        <div className="tab-panel" key={isAccountPanelOpen ? "accounts" : activeTab}>
          {isAccountPanelOpen && authUser ? (
            <AccountPanel
              currentUser={authUser}
              users={accountUsers}
              onAddAccount={() => setIsAddAccountDialogOpen(true)}
              onChangePassword={openPasswordDialog}
              onRemoveAccount={removeAccount}
              onUpdateAccountEnabled={updateAccountEnabled}
            />
          ) : activeTab === "Settings" ? (
            <SettingPanel canManage={canManageAssets} assetToken={token} gptApiToken={gptApiToken} projectName={activeProject.name} onCopy={copyToClipboard} onDeleteProject={() => { setDeleteProjectName(""); setIsDeleteProjectDialogOpen(true); }} onGenerateToken={generateToken} onGptApiTokenChange={updateGptApiToken} />
          ) : activeTab === "Audit Logs" ? (
            <AuditLogTable logs={auditLogs} isLoading={isLoadingAuditLogs} />
          ) : activeLocalizationKind ? (
            <LocalizationTable canManage={canManageAssets} kind={activeLocalizationKind} rows={activeProject[activeLocalizationKind]} title={activeTab} token={token} onAddRecord={addLocalizationRecord} onClearAudio={(rowIndex, language) => updateLocalization("audioLocalization", rowIndex, language, "default.ogg")} onCopy={copyToClipboard} onKeyUpdate={updateLocalizationKey} onRemove={removeLocalization} onReplaceAudio={replaceLocalizationAudio} onUpdate={updateLocalization} onTranslate={aiTranslate} />
          ) : (
            <AssetTable canManage={canManageAssets} assets={isAssetTab(activeTab) ? activeProject.assets[activeTab] : []} assetKind={isAssetTab(activeTab) ? activeTab : "Image"} audioUrl={asset => assetUrl(asset, "name")} hasMore={isAssetTab(activeTab) ? assetHasMore[activeTab] : false} isLoadingMore={isLoadingMoreAssets} onCopy={(asset, mode) => copyToClipboard(assetUrl(asset, mode), `Copied link by ${mode}: ${asset.name}`)} onDownload={asset => { location.href = assetUrl(asset, "name"); }} onLoadMore={loadMoreAssets} onUpload={addUploadedFiles} onRemove={asset => setDeleteAssetTarget(asset)} previewUrl={assetPreviewUrl} onPreview={asset => setPreviewAsset({ asset, previewUrl: assetPreviewUrl(asset), originalUrl: assetUrl(asset, "name") })} />
          )}
        </div>
      </section>

      {isProjectDialogOpen && (
        <div className="modal-backdrop" role="presentation">
          <form className="project-modal" onSubmit={event => { event.preventDefault(); void addProject(); }}>
            <div><h2>New project</h2><p>Enter a project name before creating its asset tabs.</p></div>
            <label>Project name<Input autoFocus value={newProjectName} onChange={event => setNewProjectName(event.target.value)} placeholder="Project Name" /></label>
            <div className="modal-actions"><Button type="button" variant="outline" onClick={() => setIsProjectDialogOpen(false)}>Cancel</Button><Button type="submit">Create project</Button></div>
          </form>
        </div>
      )}

      {isDeleteProjectDialogOpen && (
        <div className="modal-backdrop" role="presentation">
          <form className="project-modal danger-modal" onSubmit={event => { event.preventDefault(); void deleteActiveProject(); }}>
            <div><div className="modal-title-row"><TriangleAlert /><h2>Delete project</h2></div><p>Type <strong>{activeProject.name}</strong> to permanently delete this project and all rows.</p></div>
            <label>Project name<Input autoFocus value={deleteProjectName} onChange={event => setDeleteProjectName(event.target.value)} placeholder={activeProject.name} /></label>
            <div className="modal-actions"><Button type="button" variant="outline" onClick={() => setIsDeleteProjectDialogOpen(false)}>Cancel</Button><Button type="submit" variant="destructive" disabled={deleteProjectName !== activeProject.name}>Delete project</Button></div>
          </form>
        </div>
      )}

      {uploadProgress && <UploadProgressModal progress={uploadProgress} />}
      {previewAsset && <ImagePreviewModal preview={previewAsset} onClose={() => setPreviewAsset(null)} />}
      {deleteAssetTarget && (
        <ConfirmAssetDeleteModal
          asset={deleteAssetTarget}
          onCancel={() => setDeleteAssetTarget(null)}
          onConfirm={() => {
            const asset = deleteAssetTarget;
            setDeleteAssetTarget(null);
            void removeAsset(asset);
          }}
        />
      )}
      {isAddAccountDialogOpen && authUser && (
        <AddAccountModal
          newAccountForm={newAccountForm}
          onClose={() => setIsAddAccountDialogOpen(false)}
          onCreateAccount={createAccount}
          onNewAccountFormChange={setNewAccountForm}
        />
      )}
      {passwordChangeTarget && (
        <ChangePasswordModal
          target={passwordChangeTarget}
          form={passwordChangeForm}
          onClose={() => setPasswordChangeTarget(null)}
          onFormChange={setPasswordChangeForm}
          onSubmit={changeAccountPassword}
        />
      )}
      <Toaster position="top-right" richColors closeButton />
    </main>
  );
}

function AuthPage({ user, onAuthenticated }: { user: AuthUser | null; onAuthenticated: (user: AuthUser) => void }) {
  const requiresPasswordChange = Boolean(user?.mustChangePassword);
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submitLogin = async () => {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Could not log in");
    onAuthenticated(data.user);
    if (data.user.mustChangePassword) {
      setCurrentPassword(password);
      setPassword("");
      showToast.info("Update the default password before entering the console");
    }
  };

  const submitPasswordChange = async () => {
    if (newPassword !== confirmPassword) throw new Error("New passwords do not match");
    const response = await fetch("/api/auth/password", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Could not update password");
    onAuthenticated(data.user);
    showToast.success("Password updated");
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    try {
      if (requiresPasswordChange) await submitPasswordChange();
      else await submitLogin();
    } catch (error) {
      showToast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="auth-screen">
      <form className="auth-card" onSubmit={onSubmit}>
        <div className="auth-brand-row">
          <div className="brand-mark">UwU</div>
          <div>
            <p>Asset Console</p>
            <span>{requiresPasswordChange ? "First login password update" : "Account login"}</span>
          </div>
        </div>
        <div>
          <h1>{requiresPasswordChange ? "Update password" : "Login"}</h1>
          <p className="auth-copy">
            {requiresPasswordChange ? "The default admin password must be changed before the dashboard opens." : "Use the admin account to manage projects and assets."}
          </p>
        </div>
        {requiresPasswordChange ? (
          <>
            <label>Current password<Input autoFocus type="password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} /></label>
            <label>New password<Input type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)} minLength={8} /></label>
            <label>Confirm password<Input type="password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} minLength={8} /></label>
          </>
        ) : (
          <>
            <label>Username<Input autoFocus value={username} onChange={event => setUsername(event.target.value)} /></label>
            <label>Password<Input type="password" value={password} onChange={event => setPassword(event.target.value)} /></label>
          </>
        )}
        <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Working..." : requiresPasswordChange ? "Update password" : "Login"}</Button>
      </form>
      <Toaster position="top-right" richColors closeButton />
    </main>
  );
}

function DiskStorageLabel({ storageUsage }: { storageUsage: StorageUsage | null }) {
  const label = storageUsage ? `${formatBytes(storageUsage.disk.availableBytes)} / ${formatBytes(storageUsage.disk.totalBytes)}` : "...";
  return (
    <p className="disk-storage-label" title="Available disk storage">
      <HardDrive />
      <span>{label}</span>
    </p>
  );
}

function UploadProgressModal({ progress }: { progress: UploadProgress }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="upload-modal" role="status" aria-live="polite" aria-label="Upload progress">
        <div>
          <h2>{progress.title}</h2>
          <p>{progress.detail}</p>
        </div>
        <div className="upload-progress-track" aria-hidden="true">
          <div className="upload-progress-bar" style={{ width: `${progress.percent}%` }} />
        </div>
        <span>{progress.percent}%</span>
      </div>
    </div>
  );
}

function ImagePreviewModal({ preview, onClose }: { preview: PreviewAsset; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="image-preview-modal" role="dialog" aria-modal="true" aria-label={preview.asset.name} onClick={event => event.stopPropagation()}>
        <div className="image-preview-modal-header">
          <div><h2>{preview.asset.name}</h2><p>{preview.asset.originalName}</p></div>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </div>
        <img src={preview.originalUrl} alt={preview.asset.originalName} />
      </div>
    </div>
  );
}

function ConfirmAssetDeleteModal({ asset, onCancel, onConfirm }: { asset: Asset; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="project-modal compact-modal danger-modal" role="dialog" aria-modal="true" aria-label={`Delete ${asset.name}`}>
        <div>
          <div className="modal-title-row"><TriangleAlert /><h2>Delete asset</h2></div>
          <p>Remove this asset from the project?</p>
          <div className="compact-modal-asset-name">{asset.name}</div>
        </div>
        <div className="modal-actions">
          <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          <Button type="button" variant="destructive" onClick={onConfirm}>Delete asset</Button>
        </div>
      </div>
    </div>
  );
}

function formatAuditTime(value: string) {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function auditDetailsLabel(details: Record<string, unknown>) {
  const entries = Object.entries(details).filter(([, value]) => value !== null && value !== undefined && value !== "");
  if (!entries.length) return "No extra details";
  return entries
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`)
    .join(" · ");
}

function AuditLogTable({ logs, isLoading }: { logs: AuditLog[]; isLoading: boolean }) {
  return (
    <Card className="table-shell">
      <div className="table-toolbar"><div><h2>Audit Logs</h2><p>Project action history with the signed-in actor for each change.</p></div></div>
      <div className="audit-table">
        <div className="audit-row table-head"><span>Time</span><span>Actor</span><span>Action</span><span>Target</span><span>Details</span></div>
        {logs.map(log => (
          <div className="audit-row" key={log.id}>
            <span>{formatAuditTime(log.createdAt)}</span>
            <div><strong>{log.actorUsername}</strong><small>{log.actorRole}</small></div>
            <strong>{log.action}</strong>
            <div><span>{log.targetName ?? log.targetType}</span><small>{log.targetType}</small></div>
            <small>{auditDetailsLabel(log.details)}</small>
          </div>
        ))}
        {!logs.length && <div className="empty-state"><History /><span>{isLoading ? "Loading audit logs..." : "No audit logs for this project yet."}</span></div>}
      </div>
    </Card>
  );
}

function AssetTable({ assets, assetKind, audioUrl, canManage, hasMore, isLoadingMore, onCopy, onDownload, onLoadMore, onUpload, onRemove, previewUrl, onPreview }: { assets: Asset[]; assetKind: AssetKind; audioUrl: (asset: Asset) => string; canManage: boolean; hasMore: boolean; isLoadingMore: boolean; onCopy: (asset: Asset, mode: "id" | "name") => void; onDownload: (asset: Asset) => void; onLoadMore: (kind: AssetKind) => void; onUpload: (files: FileList | null) => void; onRemove: (asset: Asset) => void; previewUrl: (asset: Asset) => string; onPreview: (asset: Asset) => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playingAssetId, setPlayingAssetId] = useState<string | null>(null);
  const isImageTable = assetKind === "Image";
  const isAudioTable = assetKind === "Audio";
  const isVideoTable = assetKind === "Video";

  useEffect(() => {
    const element = loadMoreRef.current;
    if (!element || !hasMore) return;
    const observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting && !isLoadingMore) onLoadMore(assetKind);
    }, { rootMargin: "320px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [assetKind, hasMore, isLoadingMore, onLoadMore]);

  useEffect(() => {
    audioRef.current?.pause();
    setPlayingAssetId(null);
  }, [assetKind]);

  const toggleAudio = async (asset: Asset) => {
    const audio = audioRef.current;
    if (!audio) return;

    if (playingAssetId === asset.id && !audio.paused) {
      audio.pause();
      setPlayingAssetId(null);
      return;
    }

    audio.pause();
    audio.currentTime = 0;
    audio.src = audioUrl(asset);
    setPlayingAssetId(asset.id);
    try {
      await audio.play();
    } catch {
      setPlayingAssetId(null);
    }
  };

  return (
    <Card className="table-shell">
      <div className="table-toolbar"><div><h2>{assetKind} assets</h2><p>Rows are fetched from the SQLite assets table for the selected project.</p></div>{canManage && <div className="table-actions"><input ref={fileInputRef} type="file" multiple className="hidden" accept={assetKind === "Image" ? imageUploadAccept : assetKind === "Video" ? "video/*" : "audio/*"} onChange={event => onUpload(event.currentTarget.files)} /><Button onClick={() => fileInputRef.current?.click()}><Upload />Add asset</Button></div>}</div>
      <div className="data-table">
        {isAudioTable && <audio ref={audioRef} className="hidden" onEnded={() => setPlayingAssetId(null)} />}
        <div className={isImageTable ? "asset-row image-asset-row table-head" : isVideoTable ? "asset-row video-asset-row table-head" : "asset-row table-head"}><span>No.</span><span>Name</span>{isImageTable && <span>Preview</span>}{isVideoTable && <span>Status</span>}<span>Metadata</span><span>Tools</span></div>
        {assets.map((asset, index) => (
          <div className={isImageTable ? "asset-row image-asset-row" : isVideoTable ? "asset-row video-asset-row" : "asset-row"} key={asset.id}>
            <span className="row-no">{assets.length - index}</span>
            <div className={isAudioTable ? "asset-name-cell audio-name-cell" : "asset-name-cell"}>
              {isAudioTable && (
                <Button variant="outline" size="icon-sm" onClick={() => void toggleAudio(asset)} title={playingAssetId === asset.id ? "Pause audio" : "Play audio"} aria-label={playingAssetId === asset.id ? `Pause ${asset.name}` : `Play ${asset.name}`}>
                  {playingAssetId === asset.id ? <Pause /> : <Play />}
                </Button>
              )}
              <div><strong>{asset.name}</strong><small>{asset.originalName}</small></div>
            </div>
            {isImageTable && (
              <button className="image-preview" type="button" onClick={() => onPreview(asset)} title={`Preview ${asset.name}`}>
                <img src={previewUrl(asset)} alt={asset.originalName} loading="lazy" />
              </button>
            )}
            {isVideoTable && <ConversionStatus asset={asset} />}
            <div className="metadata-list">{asset.metadata.map(item => <span key={item}>{item}</span>)}<span>{formatBytes(asset.sizeBytes)}</span><span>{asset.updatedAt.slice(0, 10)}</span></div>
            <div className="toolset">
              <Button variant="outline" size="icon-sm" onClick={() => onCopy(asset, "id")} disabled={isVideoTable && asset.conversionStatus !== "ready"} title="Copy Link By Id" aria-label="Copy Link By Id"><Copy /></Button>
              <Button variant="outline" size="icon-sm" onClick={() => onCopy(asset, "name")} disabled={isVideoTable && asset.conversionStatus !== "ready"} title="Copy Link By Name" aria-label="Copy Link By Name"><Link2 /></Button>
              <Button variant="outline" size="icon-sm" onClick={() => onDownload(asset)} disabled={isVideoTable && asset.conversionStatus !== "ready"} title="Download" aria-label="Download"><Download /></Button>
              {canManage && <Button variant="destructive" size="icon-sm" onClick={() => onRemove(asset)} title="Remove" aria-label="Remove"><Trash2 /></Button>}
            </div>
          </div>
        ))}
        {!assets.length && <div className="empty-state"><Plus /><span>No assets in the database for this tab yet.</span></div>}
        {assets.length > 0 && (
          <div className="asset-load-more" ref={loadMoreRef}>
            {isLoadingMore ? "Loading more assets..." : hasMore ? "Scroll for more assets" : "All newest assets loaded"}
          </div>
        )}
      </div>
    </Card>
  );
}

function ConversionStatus({ asset }: { asset: Asset }) {
  const label =
    asset.conversionStatus === "ready"
      ? "Ready"
      : asset.conversionStatus === "failed"
        ? "Failed"
        : asset.conversionStatus === "queued"
          ? "Queued"
          : "Converting";
  const progress = asset.conversionStatus === "ready" ? 100 : asset.conversionProgress;

  return (
    <div className={`conversion-status is-${asset.conversionStatus}`} title={asset.conversionError || label}>
      <div><strong>{label}</strong><span>{progress}%</span></div>
      <div className="conversion-progress-track" aria-hidden="true"><div style={{ width: `${progress}%` }} /></div>
    </div>
  );
}

function LocalizationTable({ canManage, kind, rows, title, token, onAddRecord, onClearAudio, onCopy, onKeyUpdate, onRemove, onReplaceAudio, onUpdate, onTranslate }: { canManage: boolean; kind: LocalizationKind; rows: LocalizationRow[]; title: string; token: string; onAddRecord: (kind: LocalizationKind) => void; onClearAudio: (rowIndex: number, language: string) => void; onCopy: (value: string, label: string) => void; onKeyUpdate: (kind: LocalizationKind, rowIndex: number, key: string) => void; onRemove: (kind: LocalizationKind, rowIndex: number) => void; onReplaceAudio: (rowIndex: number, language: string, file: File) => void; onUpdate: (kind: LocalizationKind, rowIndex: number, language: string, value: string) => void; onTranslate: (kind: LocalizationKind) => void }) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(() => new Set());
  const audioRef = useRef<HTMLAudioElement>(null);
  const replaceAudioInputRef = useRef<HTMLInputElement>(null);
  const [playingLocalizationKey, setPlayingLocalizationKey] = useState<string | null>(null);
  const [replaceAudioTarget, setReplaceAudioTarget] = useState<{ rowIndex: number; language: string } | null>(null);
  const gridTemplateColumns = "72px 220px minmax(280px, 1fr) 172px";
  const isAudioLocalization = kind === "audioLocalization";

  const audioLocalizationUrl = (assetName: string) => `${location.origin}/assets/name/${encodeURIComponent(assetName)}?token=${encodeURIComponent(token)}`;

  const toggleLocalizationAudio = async (playKey: string, assetName: string) => {
    const audio = audioRef.current;
    const name = assetName.trim();
    if (!audio || !name) return;

    if (playingLocalizationKey === playKey && !audio.paused) {
      audio.pause();
      setPlayingLocalizationKey(null);
      return;
    }

    audio.pause();
    audio.currentTime = 0;
    audio.src = audioLocalizationUrl(name);
    setPlayingLocalizationKey(playKey);
    try {
      await audio.play();
    } catch {
      setPlayingLocalizationKey(null);
    }
  };

  const requestAudioReplacement = (rowIndex: number, language: string) => {
    setReplaceAudioTarget({ rowIndex, language });
    if (replaceAudioInputRef.current) {
      replaceAudioInputRef.current.value = "";
      replaceAudioInputRef.current.click();
    }
  };

  const replaceSelectedAudio = (files: FileList | null) => {
    const file = files?.[0];
    if (!file || !replaceAudioTarget) return;
    onReplaceAudio(replaceAudioTarget.rowIndex, replaceAudioTarget.language, file);
    setReplaceAudioTarget(null);
  };

  const localizedValue = (rowKey: string, rowIndex: number, language: string) => {
    const value = rows[rowIndex]?.values[language] ?? "";
    const playKey = `${rowKey}:${language}`;
    const isPlaying = playingLocalizationKey === playKey;

    return (
      <div className={isAudioLocalization ? "localized-value audio-localized-value" : "localized-value"}>
        <span>{language.toUpperCase()}</span>
        <Input className="localization-value" value={value} readOnly={!canManage} onChange={event => onUpdate(kind, rowIndex, language, event.target.value)} />
        {isAudioLocalization && (
          <div className="audio-value-tools">
            <Button variant="outline" size="icon-sm" disabled={!value.trim()} onClick={() => void toggleLocalizationAudio(playKey, value)} title={isPlaying ? "Pause audio preview" : "Play audio preview"} aria-label={isPlaying ? `Pause ${language.toUpperCase()} audio preview` : `Play ${language.toUpperCase()} audio preview`}>
              {isPlaying ? <Pause /> : <Play />}
            </Button>
            {canManage && <Button variant="outline" size="icon-sm" onClick={() => requestAudioReplacement(rowIndex, language)} title="Replace audio file" aria-label={`Replace ${language.toUpperCase()} audio file`}>
              <Upload />
            </Button>}
            {canManage && <Button variant="outline" size="icon-sm" disabled={value === "default.ogg"} onClick={() => onClearAudio(rowIndex, language)} title="Use default audio" aria-label={`Use default audio for ${language.toUpperCase()}`}>
              <Trash2 />
            </Button>}
          </div>
        )}
      </div>
    );
  };

  return (
    <Card className="table-shell">
      <div className="table-toolbar localization-tools">
        <div><h2>{title}</h2><p>Rows are fetched from the SQLite localization table.</p></div>
        {canManage && <div className="table-actions">
          <Button onClick={() => onAddRecord(kind)}><Plus />Add record</Button>
        </div>}
      </div>
      <div className="localization-table">
        {isAudioLocalization && <audio ref={audioRef} className="hidden" onEnded={() => setPlayingLocalizationKey(null)} />}
        {isAudioLocalization && <input ref={replaceAudioInputRef} type="file" className="hidden" accept="audio/*" onChange={event => replaceSelectedAudio(event.currentTarget.files)} />}
        <div className="localization-grid table-head" style={{ gridTemplateColumns }}><span>No.</span><span>Key</span><span>Value</span><span>Tools</span></div>
        {rows.map((row, rowIndex) => {
          const rowKey = row.id ?? row.key;
          const isExpanded = expandedRows.has(rowKey);
          return (
            <div className="localization-row-group" key={rowKey}>
              <div className="localization-grid" style={{ gridTemplateColumns }}>
                <span className="row-no">{rows.length - rowIndex}</span>
                <Input className="key-input" value={row.key} readOnly={!canManage} onChange={event => onKeyUpdate(kind, rowIndex, event.target.value)} aria-label={`Localization key ${rowIndex + 1}`} />
                {localizedValue(rowKey, rowIndex, "en")}
                <div className="toolset localization-toolset">
                  <Button variant="outline" size="icon-sm" onClick={() => setExpandedRows(current => {
                    const next = new Set(current);
                    if (next.has(rowKey)) next.delete(rowKey);
                    else next.add(rowKey);
                    return next;
                  })} title={isExpanded ? "Hide languages" : "Show languages"} aria-label={isExpanded ? "Hide languages" : "Show languages"}><ChevronDown className={isExpanded ? "rotate-icon" : undefined} /></Button>
                  <Button variant="outline" size="icon-sm" onClick={() => onCopy(`/localization/id/${row.key}?token=${encodeURIComponent(token)}`, `Copied localization id: ${row.key}`)} title="Copy Link By Id" aria-label="Copy Link By Id"><Copy /></Button>
                  <Button variant="outline" size="icon-sm" onClick={() => onCopy(`/localization/name/${row.key.replaceAll(".", "/")}?token=${encodeURIComponent(token)}`, `Copied localization name: ${row.key}`)} title="Copy Link By Name" aria-label="Copy Link By Name"><Link2 /></Button>
                  {canManage && <Button variant="destructive" size="icon-sm" onClick={() => onRemove(kind, rowIndex)} title="Remove" aria-label="Remove"><Trash2 /></Button>}
                </div>
              </div>
              {isExpanded && secondaryLanguages.map(language => (
                <div className="localization-grid localization-secondary-row" style={{ gridTemplateColumns }} key={language}>
                  <span />
                  <span />
                  {localizedValue(rowKey, rowIndex, language)}
                  <span />
                </div>
              ))}
            </div>
          );
        })}
        {!rows.length && <div className="empty-state"><Plus /><span>No localization rows in the database for this tab yet.</span></div>}
      </div>
      {canManage && kind === "textLocalization" && <div className="bottom-actions"><Button onClick={() => onTranslate(kind)}><WandSparkles />AI Translate</Button></div>}
    </Card>
  );
}

function AccountPanel({ currentUser, users, onAddAccount, onChangePassword, onRemoveAccount, onUpdateAccountEnabled }: { currentUser: AuthUser; users: AuthUser[]; onAddAccount: () => void; onChangePassword: (user: AuthUser) => void; onRemoveAccount: (user: AuthUser) => void; onUpdateAccountEnabled: (user: AuthUser, enabled: boolean) => void }) {
  const canManageAccounts = currentUser.role === "admin" || currentUser.role === "manager";
  const canChangePassword = (user: AuthUser) => currentUser.id === user.id || currentUser.role === "admin" || (currentUser.role === "manager" && user.role === "readonly");
  const canRemove = (user: AuthUser) => currentUser.id !== user.id && (currentUser.role === "admin" || user.role === "readonly");
  const canToggle = (user: AuthUser) => currentUser.id !== user.id && (currentUser.role === "admin" || user.role === "readonly");

  return (
    <div className="account-page">
      {canManageAccounts && (
        <Card className="table-shell">
          <div className="table-toolbar"><div><h2>Accounts</h2><p>Manager accounts can update readonly accounts only.</p></div><Button onClick={onAddAccount}><Plus />Add Account</Button></div>
          <div className="account-table">
            <div className="account-table-row table-head"><span>Username</span><span>Role</span><span>Password</span><span>Status</span><span>Tools</span></div>
            {users.map(user => (
              <div className="account-table-row" key={user.id}>
                <strong>{user.username}</strong>
                <span className="account-role">{user.role}</span>
                <Button variant="outline" size="sm" disabled={!canChangePassword(user)} onClick={() => onChangePassword(user)}>Change Password</Button>
                <label className="account-enabled"><input type="checkbox" checked={user.enabled} disabled={!canToggle(user)} onChange={event => void onUpdateAccountEnabled(user, event.currentTarget.checked)} /><span>{user.enabled ? "Enabled" : "Disabled"}</span></label>
                <div className="toolset"><Button variant="destructive" size="sm" disabled={!canRemove(user)} onClick={() => void onRemoveAccount(user)}><Trash2 />Remove</Button></div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function AddAccountModal({ newAccountForm, onClose, onCreateAccount, onNewAccountFormChange }: { newAccountForm: { username: string; password: string; role: Exclude<UserRole, "admin"> }; onClose: () => void; onCreateAccount: () => void; onNewAccountFormChange: Dispatch<SetStateAction<{ username: string; password: string; role: Exclude<UserRole, "admin"> }>> }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <form className="project-modal account-modal" role="dialog" aria-modal="true" aria-label="Add account" onSubmit={event => { event.preventDefault(); void onCreateAccount(); }}>
        <div><h2>Add Account</h2><p>Create a readonly or manager account.</p></div>
        <label>Username<Input autoFocus value={newAccountForm.username} onChange={event => onNewAccountFormChange(current => ({ ...current, username: event.target.value }))} /></label>
        <label>Password<Input type="password" minLength={8} value={newAccountForm.password} onChange={event => onNewAccountFormChange(current => ({ ...current, password: event.target.value }))} /></label>
        <label>Role<select value={newAccountForm.role} onChange={event => onNewAccountFormChange(current => ({ ...current, role: event.target.value as Exclude<UserRole, "admin"> }))}><option value="readonly">Readonly</option><option value="manager">Manager</option></select></label>
        <div className="modal-actions"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit"><Plus />Create account</Button></div>
      </form>
    </div>
  );
}

function ChangePasswordModal({ target, form, onClose, onFormChange, onSubmit }: { target: AuthUser; form: { newPassword: string; confirmPassword: string }; onClose: () => void; onFormChange: Dispatch<SetStateAction<{ newPassword: string; confirmPassword: string }>>; onSubmit: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <form className="project-modal account-modal" role="dialog" aria-modal="true" aria-label={`Change password for ${target.username}`} onSubmit={event => { event.preventDefault(); void onSubmit(); }}>
        <div><h2>Change Password</h2><p>{target.username} · {target.role}</p></div>
        <label>New password<Input autoFocus type="password" minLength={8} value={form.newPassword} onChange={event => onFormChange(current => ({ ...current, newPassword: event.target.value }))} /></label>
        <label>Confirm password<Input type="password" minLength={8} value={form.confirmPassword} onChange={event => onFormChange(current => ({ ...current, confirmPassword: event.target.value }))} /></label>
        <div className="modal-actions"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit">Change Password</Button></div>
      </form>
    </div>
  );
}

function SettingPanel({ canManage, assetToken, gptApiToken, projectName, onCopy, onDeleteProject, onGenerateToken, onGptApiTokenChange }: { canManage: boolean; assetToken: string; gptApiToken: string; projectName: string; onCopy: (value: string, label: string) => void; onDeleteProject: () => void; onGenerateToken: () => void; onGptApiTokenChange: (value: string) => void }) {
  return (
    <Card className="table-shell settings-panel">
      <div className="table-toolbar"><div><h2>Settings</h2><p>Settings are loaded from the SQLite project_settings table.</p></div></div>
      <div className="settings-grid">
        <div className="setting-row"><div><strong>Asset token</strong><span>Required for unauthenticated asset and localization requests.</span></div><Input value={assetToken} readOnly aria-label="Read only asset token" /><div className="setting-actions">{canManage && <Button variant="outline" onClick={onGenerateToken}><WandSparkles />Generate</Button>}<Button variant="outline" onClick={() => onCopy(assetToken, "Copied asset token")}><Copy />Copy</Button></div></div>
        <div className="setting-row"><div><strong>GPT_API_TOKEN</strong><span>Used by AI Translate for localization rows.</span></div><Input value={gptApiToken} readOnly={!canManage} onChange={event => onGptApiTokenChange(event.target.value)} placeholder="gpt_tok_translate..." aria-label="GPT API token" /><Button variant="outline" onClick={() => onCopy(gptApiToken, "Copied GPT_API_TOKEN")}><Copy />Copy</Button></div>
        {canManage && <div className="setting-row danger-setting-row"><div><strong>Delete project</strong><span>Delete {projectName} and all database rows in this project.</span></div><div className="danger-setting-copy">This action requires typing the project name to confirm.</div><Button variant="destructive" onClick={onDeleteProject}><Trash2 />Delete project</Button></div>}
      </div>
    </Card>
  );
}

export default App;
