import {
  ChevronDown,
  Copy,
  Download,
  FileAudio,
  FileImage,
  FileVideo,
  FolderPlus,
  Globe2,
  Link2,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  Trash2,
  TriangleAlert,
  Upload,
  WandSparkles,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import "./index.css";

type AssetKind = "Image" | "Audio" | "Video";
type LocalizationKind = "audioLocalization" | "textLocalization";
type Tab = AssetKind | "Audio Localization" | "Text Localization" | "Settings";

type Asset = {
  id: string;
  originalName: string;
  name: string;
  kind: AssetKind;
  sizeBytes: number;
  mimeType: string;
  metadata: string[];
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

const tabs: Tab[] = ["Image", "Audio", "Video", "Audio Localization", "Text Localization", "Settings"];
const languages = ["en", "vi", "ja", "ko", "th", "zh"];
const primaryLanguage = "en";
const secondaryLanguages = languages.filter(language => language !== primaryLanguage);
const emptyAssets = (): Record<AssetKind, Asset[]> => ({ Image: [], Audio: [], Video: [] });

function emptyProject(id: string, name: string): Project {
  return { id, name, assets: emptyAssets(), audioLocalization: [], textLocalization: [] };
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function isAssetTab(tab: Tab): tab is AssetKind {
  return tab === "Image" || tab === "Audio" || tab === "Video";
}

function mapProjectPayload(data: any): Project {
  const mapAsset = (asset: any): Asset => ({
    id: asset.id,
    originalName: asset.originalName,
    name: asset.name,
    kind: asset.kind,
    sizeBytes: asset.sizeBytes,
    mimeType: asset.mimeType,
    metadata: asset.metadata ?? [],
    updatedAt: asset.updatedAt,
  });

  const mapLocalization = (row: any): LocalizationRow => ({
    id: row.id,
    key: row.key,
    values: row.values ?? {},
  });

  return {
    id: data.project.id,
    name: data.project.name,
    assets: {
      Image: (data.assets.Image ?? []).map(mapAsset),
      Audio: (data.assets.Audio ?? []).map(mapAsset),
      Video: (data.assets.Video ?? []).map(mapAsset),
    },
    audioLocalization: (data.audioLocalization ?? []).map(mapLocalization),
    textLocalization: (data.textLocalization ?? []).map(mapLocalization),
  };
}

function uploadName(fileName: string, kind: AssetKind) {
  const extension = kind === "Image" ? "webp" : kind === "Video" ? "webm" : "ogg";
  const base = fileName.replace(/\.[^/.]+$/, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  const hash = crypto.randomUUID().replaceAll("-", "").slice(0, 8);
  return `${base}.${hash}.${extension}`;
}

export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("Image");
  const [token, setToken] = useState("");
  const [gptApiToken, setGptApiToken] = useState("");
  const [toast, setToast] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isProjectDialogOpen, setIsProjectDialogOpen] = useState(false);
  const [isDeleteProjectDialogOpen, setIsDeleteProjectDialogOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [deleteProjectName, setDeleteProjectName] = useState("");

  const activeProject = projects.find(project => project.id === activeProjectId) ?? projects[0];
  const activeLocalizationKind: LocalizationKind | null =
    activeTab === "Audio Localization" ? "audioLocalization" : activeTab === "Text Localization" ? "textLocalization" : null;
  const tabAssetCount = activeLocalizationKind
    ? activeProject?.[activeLocalizationKind].length ?? 0
    : activeTab === "Settings"
      ? 2
      : isAssetTab(activeTab)
        ? activeProject?.assets[activeTab].length ?? 0
        : 0;
  const totalAssets = useMemo(
    () => projects.reduce((sum, project) => sum + project.assets.Image.length + project.assets.Audio.length + project.assets.Video.length, 0),
    [projects],
  );

  const loadProject = async (projectId: string) => {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`);
    if (!response.ok) throw new Error("Could not load project from database");
    const data = await response.json();
    const project = mapProjectPayload(data);
    setProjects(current => current.map(item => (item.id === project.id ? project : item)));
    setToken(data.settings.assetToken);
    setGptApiToken(data.settings.gptApiToken);
    return project;
  };

  const loadProjects = async () => {
    const response = await fetch("/api/projects");
    if (!response.ok) throw new Error("Could not load projects from database");
    const data = (await response.json()) as { projects: Array<{ id: string; name: string }> };
    const shells = data.projects.map(project => emptyProject(project.id, project.name));
    setProjects(shells);
    if (shells[0]) {
      setActiveProjectId(shells[0].id);
      await loadProject(shells[0].id);
      setToast("");
    } else {
      setActiveProjectId("");
    }
  };

  useEffect(() => {
    loadProjects().catch(error => setToast(String(error)));
  }, []);

  useEffect(() => {
    if (activeProjectId) loadProject(activeProjectId).catch(error => setToast(String(error)));
  }, [activeProjectId]);

  const assetUrl = (asset: Asset, mode: "id" | "name") => {
    const key = mode === "id" ? asset.id : asset.name;
    const params = new URLSearchParams({ token });
    if (asset.kind === "Image") {
      params.set("width", "{width}");
      params.set("height", "{height}");
    }
    return `/assets/${mode}/${key}?${params.toString()}`;
  };

  const copyToClipboard = async (value: string, label: string) => {
    await navigator.clipboard?.writeText(value);
    setToast(label);
  };

  const addProject = async () => {
    const name = newProjectName.trim();
    if (!name) return setToast("Project name is required");
    const response = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    const data = await response.json();
    const project = emptyProject(data.project.id, data.project.name);
    setProjects(current => [project, ...current]);
    setActiveProjectId(project.id);
    setActiveTab("Image");
    setIsProjectDialogOpen(false);
    setToast(`Created ${project.name} in database`);
  };

  const deleteActiveProject = async () => {
    if (!activeProject) return;
    if (deleteProjectName !== activeProject.name) return setToast("Project name does not match");
    await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}`, { method: "DELETE" });
    const remaining = projects.filter(project => project.id !== activeProject.id);
    setProjects(remaining);
    setActiveProjectId(remaining[0]?.id ?? "");
    setIsDeleteProjectDialogOpen(false);
    setToast(remaining.length ? `Deleted ${activeProject.name} from database` : "No projects found in SQLite database");
  };

  const addUploadedFiles = async (files: FileList | null, uploadKind?: AssetKind) => {
    const kind = uploadKind ?? (isAssetTab(activeTab) ? activeTab : null);
    if (!files?.length || !activeProject || !kind) return;
    await Promise.all(
      Array.from(files).map(file =>
        fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/assets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            originalName: file.name,
            name: uploadName(file.name, kind),
            kind,
            sizeBytes: file.size,
            mimeType: file.type,
            metadata: [
              kind === "Image" ? "converted to webp" : kind === "Video" ? "converted to webm" : "converted to ogg",
              file.type || "unknown mime",
            ],
          }),
        }),
      ),
    );
    await loadProject(activeProject.id);
    setToast(`Saved ${files.length} ${kind.toLowerCase()} asset(s) to database`);
  };

  const removeAsset = async (asset: Asset) => {
    if (!activeProject) return;
    await fetch(`/api/assets/${encodeURIComponent(asset.id)}`, { method: "DELETE" });
    await loadProject(activeProject.id);
    setToast(`Removed ${asset.name} from database`);
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
    setToast("Removed localization row from database");
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
    setToast("Added localization record to database");
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
    setToast("Saved AI translations to database");
  };

  const saveSettings = async (nextToken: string, nextGptApiToken: string) => {
    if (!activeProject) return;
    await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetToken: nextToken, gptApiToken: nextGptApiToken }),
    });
  };

  const generateToken = () => {
    const nextToken = `asset_tok_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`;
    setToken(nextToken);
    void saveSettings(nextToken, gptApiToken);
    setToast("Generated and saved a new asset token");
  };

  const updateGptApiToken = (value: string) => {
    setGptApiToken(value);
    void saveSettings(token, value);
  };

  if (!activeProject) {
    return (
      <main className="asset-app">
        <aside className="project-rail">
          <div className="brand-block">
            <div className="brand-mark">UwU</div>
            <div>
              <p>Asset Console</p>
              <p className="text-xs text-slate-300">database-backed</p>
            </div>
          </div>
          <Button className="project-create" onClick={() => { setNewProjectName(""); setIsProjectDialogOpen(true); }}>
            <FolderPlus /> Project
          </Button>
        </aside>

        <section className="workspace empty-workspace">
          <Card className="database-empty-state">
            <FolderPlus />
            <div>
              <h1>No projects yet</h1>
              <p>The SQLite database is connected, but it does not have any project rows to display.</p>
            </div>
            <Button onClick={() => { setNewProjectName(""); setIsProjectDialogOpen(true); }}>
              <FolderPlus /> Create project
            </Button>
          </Card>
          <div className="status-bar"><span>{toast}</span></div>
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
            <p className="text-xs text-slate-300">database-backed</p>
          </div>
        </div>
        <Button className="project-create" onClick={() => { setNewProjectName(""); setIsProjectDialogOpen(true); }}>
          <FolderPlus /> Project
        </Button>
        <div className="project-list">
          {projects.map(project => (
            <button className={project.id === activeProject.id ? "project-item is-active" : "project-item"} key={project.id} onClick={() => setActiveProjectId(project.id)}>
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
        <header className="topbar"><div className="title-cluster"><div><span className="eyebrow">Project</span><h1>{activeProject.name}</h1></div></div></header>
        <section className="metric-row" aria-label="Project summary">
          <Card><strong>{totalAssets}</strong><span>Total assets</span></Card>
          <Card><strong>{tabAssetCount}</strong><span>Rows in view</span></Card>
          <Card><strong>{languages.length}</strong><span>Localization languages</span></Card>
          <Card><strong>SQLite</strong><span>Data source</span></Card>
        </section>
        <nav className="tabbar" aria-label="Asset tabs">
          {tabs.map(tab => {
            const Icon = tab === "Image" ? FileImage : tab === "Audio" ? FileAudio : tab === "Video" ? FileVideo : tab === "Settings" ? Settings : Globe2;
            return <button className={activeTab === tab ? "tab is-active" : "tab"} key={tab} onClick={() => setActiveTab(tab)}><Icon />{tab}</button>;
          })}
        </nav>

        {activeTab === "Settings" ? (
          <SettingPanel assetToken={token} gptApiToken={gptApiToken} projectName={activeProject.name} onCopy={copyToClipboard} onDeleteProject={() => { setDeleteProjectName(""); setIsDeleteProjectDialogOpen(true); }} onGenerateToken={generateToken} onGptApiTokenChange={updateGptApiToken} />
        ) : activeLocalizationKind ? (
          <LocalizationTable kind={activeLocalizationKind} rows={activeProject[activeLocalizationKind]} title={activeTab} token={token} onAddRecord={addLocalizationRecord} onCopy={copyToClipboard} onKeyUpdate={updateLocalizationKey} onRemove={removeLocalization} onUpdate={updateLocalization} onTranslate={aiTranslate} />
        ) : (
          <AssetTable assets={isAssetTab(activeTab) ? activeProject.assets[activeTab] : []} assetKind={isAssetTab(activeTab) ? activeTab : "Image"} onCopy={(asset, mode) => copyToClipboard(assetUrl(asset, mode), `Copied link by ${mode}: ${asset.name}`)} onDownload={asset => { location.href = assetUrl(asset, "name"); }} onUpload={addUploadedFiles} onRemove={removeAsset} />
        )}
        <div className="status-bar"><span>{toast}</span><span>All visible projects, assets, localization rows, and settings are loaded from SQLite.</span></div>
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
    </main>
  );
}

function AssetTable({ assets, assetKind, onCopy, onDownload, onUpload, onRemove }: { assets: Asset[]; assetKind: AssetKind; onCopy: (asset: Asset, mode: "id" | "name") => void; onDownload: (asset: Asset) => void; onUpload: (files: FileList | null) => void; onRemove: (asset: Asset) => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  return (
    <Card className="table-shell">
      <div className="table-toolbar"><div><h2>{assetKind} assets</h2><p>Rows are fetched from the SQLite assets table for the selected project.</p></div><div className="table-actions"><input ref={fileInputRef} type="file" multiple className="hidden" accept={assetKind === "Image" ? "image/*" : assetKind === "Video" ? "video/*" : "audio/*"} onChange={event => onUpload(event.currentTarget.files)} /><Button onClick={() => fileInputRef.current?.click()}><Upload />Add asset</Button></div></div>
      <div className="data-table">
        <div className="asset-row table-head"><span>No.</span><span>Name</span><span>Metadata</span><span>Tools</span></div>
        {assets.map((asset, index) => (
          <div className="asset-row" key={asset.id}>
            <span className="row-no">{assets.length - index}</span>
            <div><strong>{asset.name}</strong><small>{asset.originalName}</small></div>
            <div className="metadata-list">{asset.metadata.map(item => <span key={item}>{item}</span>)}<span>{formatBytes(asset.sizeBytes)}</span><span>{asset.updatedAt.slice(0, 10)}</span></div>
            <div className="toolset">
              <Button variant="outline" size="icon-sm" onClick={() => onCopy(asset, "id")} title="Copy Link By Id" aria-label="Copy Link By Id"><Copy /></Button>
              <Button variant="outline" size="icon-sm" onClick={() => onCopy(asset, "name")} title="Copy Link By Name" aria-label="Copy Link By Name"><Link2 /></Button>
              <Button variant="outline" size="icon-sm" onClick={() => onDownload(asset)} title="Download" aria-label="Download"><Download /></Button>
              <Button variant="destructive" size="icon-sm" onClick={() => onRemove(asset)} title="Remove" aria-label="Remove"><Trash2 /></Button>
            </div>
          </div>
        ))}
        {!assets.length && <div className="empty-state"><Plus /><span>No assets in the database for this tab yet.</span></div>}
      </div>
    </Card>
  );
}

function LocalizationTable({ kind, rows, title, token, onAddRecord, onCopy, onKeyUpdate, onRemove, onUpdate, onTranslate }: { kind: LocalizationKind; rows: LocalizationRow[]; title: string; token: string; onAddRecord: (kind: LocalizationKind) => void; onCopy: (value: string, label: string) => void; onKeyUpdate: (kind: LocalizationKind, rowIndex: number, key: string) => void; onRemove: (kind: LocalizationKind, rowIndex: number) => void; onUpdate: (kind: LocalizationKind, rowIndex: number, language: string, value: string) => void; onTranslate: (kind: LocalizationKind) => void }) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(() => new Set());
  const gridTemplateColumns = "72px 220px minmax(280px, 1fr) 172px";
  return (
    <Card className="table-shell">
      <div className="table-toolbar localization-tools">
        <div><h2>{title}</h2><p>Rows are fetched from the SQLite localization table.</p></div>
        <div className="table-actions">
          <Button onClick={() => onAddRecord(kind)}><Plus />Add record</Button>
        </div>
      </div>
      <div className="localization-table">
        <div className="localization-grid table-head" style={{ gridTemplateColumns }}><span>No.</span><span>Key</span><span>Value</span><span>Tools</span></div>
        {rows.map((row, rowIndex) => {
          const rowKey = row.id ?? row.key;
          const isExpanded = expandedRows.has(rowKey);
          return (
            <div className="localization-row-group" key={rowKey}>
              <div className="localization-grid" style={{ gridTemplateColumns }}>
                <span className="row-no">{rows.length - rowIndex}</span>
                <Input className="key-input" value={row.key} onChange={event => onKeyUpdate(kind, rowIndex, event.target.value)} aria-label={`Localization key ${rowIndex + 1}`} />
                <div className="localized-value"><span>EN</span><Input className="localization-value" value={row.values.en ?? ""} onChange={event => onUpdate(kind, rowIndex, "en", event.target.value)} /></div>
                <div className="toolset localization-toolset">
                  <Button variant="outline" size="icon-sm" onClick={() => setExpandedRows(current => {
                    const next = new Set(current);
                    if (next.has(rowKey)) next.delete(rowKey);
                    else next.add(rowKey);
                    return next;
                  })} title={isExpanded ? "Hide languages" : "Show languages"} aria-label={isExpanded ? "Hide languages" : "Show languages"}><ChevronDown className={isExpanded ? "rotate-icon" : undefined} /></Button>
                  <Button variant="outline" size="icon-sm" onClick={() => onCopy(`/localization/id/${row.key}?token=${encodeURIComponent(token)}`, `Copied localization id: ${row.key}`)} title="Copy Link By Id" aria-label="Copy Link By Id"><Copy /></Button>
                  <Button variant="outline" size="icon-sm" onClick={() => onCopy(`/localization/name/${row.key.replaceAll(".", "/")}?token=${encodeURIComponent(token)}`, `Copied localization name: ${row.key}`)} title="Copy Link By Name" aria-label="Copy Link By Name"><Link2 /></Button>
                  <Button variant="destructive" size="icon-sm" onClick={() => onRemove(kind, rowIndex)} title="Remove" aria-label="Remove"><Trash2 /></Button>
                </div>
              </div>
              {isExpanded && secondaryLanguages.map(language => (
                <div className="localization-grid localization-secondary-row" style={{ gridTemplateColumns }} key={language}>
                  <span />
                  <span />
                  <div className="localized-value"><span>{language.toUpperCase()}</span><Input className="localization-value" value={row.values[language] ?? ""} onChange={event => onUpdate(kind, rowIndex, language, event.target.value)} /></div>
                  <span />
                </div>
              ))}
            </div>
          );
        })}
        {!rows.length && <div className="empty-state"><Plus /><span>No localization rows in the database for this tab yet.</span></div>}
      </div>
      {kind === "textLocalization" && <div className="bottom-actions"><Button onClick={() => onTranslate(kind)}><WandSparkles />AI Translate</Button></div>}
    </Card>
  );
}

function SettingPanel({ assetToken, gptApiToken, projectName, onCopy, onDeleteProject, onGenerateToken, onGptApiTokenChange }: { assetToken: string; gptApiToken: string; projectName: string; onCopy: (value: string, label: string) => void; onDeleteProject: () => void; onGenerateToken: () => void; onGptApiTokenChange: (value: string) => void }) {
  return (
    <Card className="table-shell settings-panel">
      <div className="table-toolbar"><div><h2>Settings</h2><p>Settings are loaded from the SQLite project_settings table.</p></div></div>
      <div className="settings-grid">
        <div className="setting-row"><div><strong>Asset token</strong><span>Required for every asset and localization request.</span></div><Input value={assetToken} readOnly aria-label="Read only asset token" /><div className="setting-actions"><Button variant="outline" onClick={onGenerateToken}><WandSparkles />Generate</Button><Button variant="outline" onClick={() => onCopy(assetToken, "Copied asset token")}><Copy />Copy</Button></div></div>
        <div className="setting-row"><div><strong>GPT_API_TOKEN</strong><span>Used by AI Translate for localization rows.</span></div><Input value={gptApiToken} onChange={event => onGptApiTokenChange(event.target.value)} placeholder="gpt_tok_translate..." aria-label="GPT API token" /><Button variant="outline" onClick={() => onCopy(gptApiToken, "Copied GPT_API_TOKEN")}><Copy />Copy</Button></div>
        <div className="setting-row danger-setting-row"><div><strong>Delete project</strong><span>Delete {projectName} and all database rows in this project.</span></div><div className="danger-setting-copy">This action requires typing the project name to confirm.</div><Button variant="destructive" onClick={onDeleteProject}><Trash2 />Delete project</Button></div>
      </div>
    </Card>
  );
}

export default App;
