import { randomUUID } from "node:crypto";
import { getDatabase } from "./database";

export type AssetKind = "Image" | "Audio" | "Video";
export type LocalizationKind = "audioLocalization" | "textLocalization";

export type AssetRecord = {
  id: string;
  projectId: string;
  originalName: string;
  name: string;
  kind: AssetKind;
  sizeBytes: number;
  mimeType: string;
  metadata: string[];
  conversionStatus: "queued" | "processing" | "ready" | "failed";
  conversionProgress: number;
  conversionError: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectRecord = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type LocalizationRecord = {
  id: string;
  projectId: string;
  kind: LocalizationKind;
  key: string;
  values: Record<string, string>;
  createdAt: string;
  updatedAt: string;
};

export type ProjectSettingsRecord = {
  projectId: string;
  assetToken: string;
  gptApiToken: string;
  updatedAt: string;
};

export type AuditLogRecord = {
  id: string;
  projectId: string;
  actorId: string | null;
  actorUsername: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string | null;
  targetName: string | null;
  details: Record<string, unknown>;
  createdAt: string;
};

type ProjectRow = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

type AssetRow = {
  id: string;
  project_id: string;
  original_name: string;
  name: string;
  kind: AssetKind;
  size_bytes: number;
  mime_type: string;
  metadata_json: string;
  conversion_status: AssetRecord["conversionStatus"];
  conversion_progress: number;
  conversion_error: string;
  created_at: string;
  updated_at: string;
};

type LocalizationRow = {
  id: string;
  project_id: string;
  kind: LocalizationKind;
  key: string;
  values_json: string;
  created_at: string;
  updated_at: string;
};

type ProjectSettingsRow = {
  project_id: string;
  asset_token: string;
  gpt_api_token: string;
  updated_at: string;
};

type AuditLogRow = {
  id: string;
  project_id: string;
  actor_id: string | null;
  actor_username: string;
  actor_role: string;
  action: string;
  target_type: string;
  target_id: string | null;
  target_name: string | null;
  details_json: string;
  created_at: string;
};

const db = getDatabase();

const insertProject = db.query(`
  INSERT INTO projects (id, name)
  VALUES ($id, $name)
  RETURNING id, name, created_at, updated_at
`);

const listProjectsQuery = db.query(`
  SELECT id, name, created_at, updated_at
  FROM projects
  ORDER BY updated_at DESC, name ASC
`);

const getProjectQuery = db.query(`
  SELECT id, name, created_at, updated_at
  FROM projects
  WHERE id = $id
`);

const deleteProjectQuery = db.query(`
  DELETE FROM projects
  WHERE id = $id
`);

const insertAsset = db.query(`
  INSERT INTO assets (id, project_id, original_name, name, kind, size_bytes, mime_type, metadata_json, conversion_status, conversion_progress, conversion_error)
  VALUES ($id, $projectId, $originalName, $name, $kind, $sizeBytes, $mimeType, $metadataJson, $conversionStatus, $conversionProgress, $conversionError)
  RETURNING id, project_id, original_name, name, kind, size_bytes, mime_type, metadata_json, conversion_status, conversion_progress, conversion_error, created_at, updated_at
`);

const listAssetsQuery = db.query(`
  SELECT id, project_id, original_name, name, kind, size_bytes, mime_type, metadata_json, conversion_status, conversion_progress, conversion_error, created_at, updated_at
  FROM assets
  WHERE project_id = $projectId
    AND ($kind IS NULL OR kind = $kind)
  ORDER BY updated_at DESC, name ASC
  LIMIT $limit OFFSET $offset
`);

const getAssetByIdQuery = db.query(`
  SELECT id, project_id, original_name, name, kind, size_bytes, mime_type, metadata_json, conversion_status, conversion_progress, conversion_error, created_at, updated_at
  FROM assets
  WHERE id = $id
`);

const getAssetByNameQuery = db.query(`
  SELECT id, project_id, original_name, name, kind, size_bytes, mime_type, metadata_json, conversion_status, conversion_progress, conversion_error, created_at, updated_at
  FROM assets
  WHERE name = $name
`);

const deleteAssetQuery = db.query(`
  DELETE FROM assets
  WHERE id = $id
`);

const updateAssetConversionQuery = db.query(`
  UPDATE assets
  SET conversion_status = $status,
      conversion_progress = $progress,
      conversion_error = $error,
      size_bytes = COALESCE($sizeBytes, size_bytes),
      updated_at = datetime('now')
  WHERE id = $id
`);

const updateAssetFileQuery = db.query(`
  UPDATE assets
  SET original_name = $originalName,
      size_bytes = $sizeBytes,
      mime_type = $mimeType,
      metadata_json = $metadataJson,
      conversion_status = $conversionStatus,
      conversion_progress = $conversionProgress,
      conversion_error = $conversionError,
      updated_at = datetime('now')
  WHERE id = $id
  RETURNING id, project_id, original_name, name, kind, size_bytes, mime_type, metadata_json, conversion_status, conversion_progress, conversion_error, created_at, updated_at
`);

const listLocalizationQuery = db.query(`
  SELECT id, project_id, kind, key, values_json, created_at, updated_at
  FROM localization_entries
  WHERE project_id = $projectId
    AND kind = $kind
  ORDER BY updated_at DESC, key ASC
`);

const upsertLocalizationQuery = db.query(`
  INSERT INTO localization_entries (id, project_id, kind, key, values_json)
  VALUES ($id, $projectId, $kind, $key, $valuesJson)
  ON CONFLICT(project_id, kind, key) DO UPDATE SET
    values_json = excluded.values_json,
    updated_at = datetime('now')
  RETURNING id, project_id, kind, key, values_json, created_at, updated_at
`);

const deleteLocalizationQuery = db.query(`
  DELETE FROM localization_entries
  WHERE id = $id
`);

const getLocalizationByIdQuery = db.query(`
  SELECT id, project_id, kind, key, values_json, created_at, updated_at
  FROM localization_entries
  WHERE id = $id
`);

const getSettingsQuery = db.query(`
  SELECT project_id, asset_token, gpt_api_token, updated_at
  FROM project_settings
  WHERE project_id = $projectId
`);

const upsertSettingsQuery = db.query(`
  INSERT INTO project_settings (project_id, asset_token, gpt_api_token)
  VALUES ($projectId, $assetToken, $gptApiToken)
  ON CONFLICT(project_id) DO UPDATE SET
    asset_token = excluded.asset_token,
    gpt_api_token = excluded.gpt_api_token,
    updated_at = datetime('now')
  RETURNING project_id, asset_token, gpt_api_token, updated_at
`);

const insertAuditLogQuery = db.query(`
  INSERT INTO audit_logs (id, project_id, actor_id, actor_username, actor_role, action, target_type, target_id, target_name, details_json)
  VALUES ($id, $projectId, $actorId, $actorUsername, $actorRole, $action, $targetType, $targetId, $targetName, $detailsJson)
  RETURNING id, project_id, actor_id, actor_username, actor_role, action, target_type, target_id, target_name, details_json, created_at
`);

const listAuditLogsQuery = db.query(`
  SELECT id, project_id, actor_id, actor_username, actor_role, action, target_type, target_id, target_name, details_json, created_at
  FROM audit_logs
  WHERE project_id = $projectId
  ORDER BY created_at DESC, id DESC
  LIMIT $limit OFFSET $offset
`);

export function createProject(name: string) {
  const project = mapProject(
    insertProject.get({
      id: `prj-${randomUUID()}`,
      name,
    }) as ProjectRow,
  );
  upsertProjectSettings(project.id, `asset_tok_${randomUUID().replaceAll("-", "").slice(0, 24)}`, "");
  return project;
}

export function listProjects() {
  return (listProjectsQuery.all() as ProjectRow[]).map(mapProject);
}

export function getProject(id: string) {
  const row = getProjectQuery.get({ id }) as ProjectRow | null;
  return row ? mapProject(row) : null;
}

export function createAsset(input: {
  projectId: string;
  originalName: string;
  name: string;
  kind: AssetKind;
  sizeBytes?: number;
  mimeType?: string;
  metadata?: string[];
  conversionStatus?: AssetRecord["conversionStatus"];
  conversionProgress?: number;
  conversionError?: string;
}) {
  return mapAsset(
    insertAsset.get({
      id: `${input.kind.toLowerCase()}-${randomUUID()}`,
      projectId: input.projectId,
      originalName: input.originalName,
      name: input.name,
      kind: input.kind,
      sizeBytes: input.sizeBytes ?? 0,
      mimeType: input.mimeType ?? "",
      metadataJson: JSON.stringify(input.metadata ?? []),
      conversionStatus: input.conversionStatus ?? "ready",
      conversionProgress: input.conversionProgress ?? 100,
      conversionError: input.conversionError ?? "",
    }) as AssetRow,
  );
}

export function listAssets(projectId: string, kind?: AssetKind, options?: { limit?: number; offset?: number }) {
  return (listAssetsQuery.all({ projectId, kind: kind ?? null, limit: options?.limit ?? -1, offset: options?.offset ?? 0 }) as AssetRow[]).map(mapAsset);
}

export function getAssetById(id: string) {
  const row = getAssetByIdQuery.get({ id }) as AssetRow | null;
  return row ? mapAsset(row) : null;
}

export function getAssetByName(name: string) {
  const row = getAssetByNameQuery.get({ name }) as AssetRow | null;
  return row ? mapAsset(row) : null;
}

export function deleteAsset(id: string) {
  return deleteAssetQuery.run({ id }).changes > 0;
}

export function deleteProject(id: string) {
  return deleteProjectQuery.run({ id }).changes > 0;
}

export function updateAssetConversion(id: string, status: AssetRecord["conversionStatus"], progress: number, error = "", sizeBytes?: number) {
  return updateAssetConversionQuery.run({
    id,
    status,
    progress: Math.max(0, Math.min(100, Math.round(progress))),
    error,
    sizeBytes: sizeBytes ?? null,
  }).changes > 0;
}

export function updateAssetFile(input: {
  id: string;
  originalName: string;
  sizeBytes: number;
  mimeType: string;
  metadata?: string[];
  conversionStatus?: AssetRecord["conversionStatus"];
  conversionProgress?: number;
  conversionError?: string;
}) {
  const row = updateAssetFileQuery.get({
    id: input.id,
    originalName: input.originalName,
    sizeBytes: input.sizeBytes,
    mimeType: input.mimeType,
    metadataJson: JSON.stringify(input.metadata ?? []),
    conversionStatus: input.conversionStatus ?? "ready",
    conversionProgress: input.conversionProgress ?? 100,
    conversionError: input.conversionError ?? "",
  }) as AssetRow | null;
  return row ? mapAsset(row) : null;
}

export function listLocalization(projectId: string, kind: LocalizationKind) {
  return (listLocalizationQuery.all({ projectId, kind }) as LocalizationRow[]).map(mapLocalization);
}

export function upsertLocalization(input: {
  id?: string;
  projectId: string;
  kind: LocalizationKind;
  key: string;
  values: Record<string, string>;
}) {
  return mapLocalization(
    upsertLocalizationQuery.get({
      id: input.id ?? `loc-${randomUUID()}`,
      projectId: input.projectId,
      kind: input.kind,
      key: input.key,
      valuesJson: JSON.stringify(input.values),
    }) as LocalizationRow,
  );
}

export function deleteLocalization(id: string) {
  return deleteLocalizationQuery.run({ id }).changes > 0;
}

export function getLocalizationById(id: string) {
  const row = getLocalizationByIdQuery.get({ id }) as LocalizationRow | null;
  return row ? mapLocalization(row) : null;
}

export function getProjectSettings(projectId: string) {
  const row = getSettingsQuery.get({ projectId }) as ProjectSettingsRow | null;
  return row ? mapProjectSettings(row) : upsertProjectSettings(projectId, `asset_tok_${randomUUID().replaceAll("-", "").slice(0, 24)}`, "");
}

export function upsertProjectSettings(projectId: string, assetToken: string, gptApiToken: string) {
  return mapProjectSettings(upsertSettingsQuery.get({ projectId, assetToken, gptApiToken }) as ProjectSettingsRow);
}

export function recordAuditLog(input: {
  projectId: string;
  actorId?: string | null;
  actorUsername: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  targetName?: string | null;
  details?: Record<string, unknown>;
}) {
  return mapAuditLog(
    insertAuditLogQuery.get({
      id: `aud-${randomUUID()}`,
      projectId: input.projectId,
      actorId: input.actorId ?? null,
      actorUsername: input.actorUsername,
      actorRole: input.actorRole,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      targetName: input.targetName ?? null,
      detailsJson: JSON.stringify(input.details ?? {}),
    }) as AuditLogRow,
  );
}

export function listAuditLogs(projectId: string, options?: { limit?: number; offset?: number }) {
  return (listAuditLogsQuery.all({ projectId, limit: options?.limit ?? 100, offset: options?.offset ?? 0 }) as AuditLogRow[]).map(mapAuditLog);
}

function mapProject(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAsset(row: AssetRow): AssetRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    originalName: row.original_name,
    name: row.name,
    kind: row.kind,
    sizeBytes: row.size_bytes,
    mimeType: row.mime_type,
    metadata: JSON.parse(row.metadata_json) as string[],
    conversionStatus: row.conversion_status,
    conversionProgress: row.conversion_progress,
    conversionError: row.conversion_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapLocalization(row: LocalizationRow): LocalizationRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    key: row.key,
    values: JSON.parse(row.values_json) as Record<string, string>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProjectSettings(row: ProjectSettingsRow): ProjectSettingsRecord {
  return {
    projectId: row.project_id,
    assetToken: row.asset_token,
    gptApiToken: row.gpt_api_token,
    updatedAt: row.updated_at,
  };
}

function mapAuditLog(row: AuditLogRow): AuditLogRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    actorId: row.actor_id,
    actorUsername: row.actor_username,
    actorRole: row.actor_role,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    targetName: row.target_name,
    details: JSON.parse(row.details_json) as Record<string, unknown>,
    createdAt: row.created_at,
  };
}
