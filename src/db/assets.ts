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
  INSERT INTO assets (id, project_id, original_name, name, kind, size_bytes, mime_type, metadata_json)
  VALUES ($id, $projectId, $originalName, $name, $kind, $sizeBytes, $mimeType, $metadataJson)
  RETURNING id, project_id, original_name, name, kind, size_bytes, mime_type, metadata_json, created_at, updated_at
`);

const listAssetsQuery = db.query(`
  SELECT id, project_id, original_name, name, kind, size_bytes, mime_type, metadata_json, created_at, updated_at
  FROM assets
  WHERE project_id = $projectId
    AND ($kind IS NULL OR kind = $kind)
  ORDER BY updated_at DESC, name ASC
`);

const deleteAssetQuery = db.query(`
  DELETE FROM assets
  WHERE id = $id
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
    }) as AssetRow,
  );
}

export function listAssets(projectId: string, kind?: AssetKind) {
  return (listAssetsQuery.all({ projectId, kind: kind ?? null }) as AssetRow[]).map(mapAsset);
}

export function deleteAsset(id: string) {
  return deleteAssetQuery.run({ id }).changes > 0;
}

export function deleteProject(id: string) {
  return deleteProjectQuery.run({ id }).changes > 0;
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

export function getProjectSettings(projectId: string) {
  const row = getSettingsQuery.get({ projectId }) as ProjectSettingsRow | null;
  return row ? mapProjectSettings(row) : upsertProjectSettings(projectId, `asset_tok_${randomUUID().replaceAll("-", "").slice(0, 24)}`, "");
}

export function upsertProjectSettings(projectId: string, assetToken: string, gptApiToken: string) {
  return mapProjectSettings(upsertSettingsQuery.get({ projectId, assetToken, gptApiToken }) as ProjectSettingsRow);
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
