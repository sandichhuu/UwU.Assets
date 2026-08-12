import { createAsset, createProject, listAssets, listLocalization, listProjects, upsertLocalization } from "./assets";

export function ensureSeedData() {
  const [existingProject] = listProjects();
  const project = existingProject ?? createProject("Aurora Launch");
  ensureProjectSampleData(project.id);

  return project;
}

export function ensureProjectSampleData(projectId: string) {
  if (listAssets(projectId, "Image").length === 0) {
    createAsset({
      projectId,
      originalName: "example.webp",
      name: sampleAssetName(projectId, "webp"),
      kind: "Image",
      sizeBytes: 3_200_000,
      mimeType: "image/webp",
      metadata: ["default", "example.webp", "1920 x 1080", "webp", "lossless"],
    });
  }

  if (listAssets(projectId, "Audio").length === 0) {
    createAsset({
      projectId,
      originalName: "example.ogg",
      name: sampleAssetName(projectId, "ogg"),
      kind: "Audio",
      sizeBytes: 1_800_000,
      mimeType: "audio/ogg",
      metadata: ["default", "example.ogg", "48 kHz", "ogg", "stereo"],
    });
  }

  if (listAssets(projectId, "Video").length === 0) {
    createAsset({
      projectId,
      originalName: "example.webm",
      name: sampleAssetName(projectId, "webm"),
      kind: "Video",
      sizeBytes: 18_400_000,
      mimeType: "video/webm",
      metadata: ["default", "example.webm", "1080p", "webm", "audio track detected"],
    });
  }

  if (listLocalization(projectId, "textLocalization").length === 0) {
    upsertLocalization({
      projectId,
      kind: "textLocalization",
      key: "home.play",
      values: { en: "Play now", vi: "Choi ngay", ja: "Play now (JA)" },
    });
  }

  if (listLocalization(projectId, "audioLocalization").length === 0) {
    upsertLocalization({
      projectId,
      kind: "audioLocalization",
      key: "home.play",
      values: { en: "default.ogg", vi: "default.ogg" },
    });
  }
}

function sampleAssetName(projectId: string, extension: string) {
  return `example.${projectId}.${extension}`;
}
