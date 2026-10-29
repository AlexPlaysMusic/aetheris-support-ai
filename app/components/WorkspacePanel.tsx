'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  BookOpenCheck,
  CalendarClock,
  Check,
  ClipboardCheck,
  Database,
  FileText,
  FolderKanban,
  Globe2,
  LockKeyhole,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X
} from 'lucide-react';

type Tab = 'projects' | 'tasks' | 'research' | 'verify' | 'memory' | 'compare' | 'schedule' | 'privacy';
type Project = { id: string; name: string; description: string; files: string[]; instructions: string; decisions: string[] };
type Memory = { id: string; fact: string; source: string };
type ResearchResult = { title: string; url: string; snippet: string };

const tabs: { id: Tab; label: string; icon: typeof FolderKanban }[] = [
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'tasks', label: 'Tasks', icon: ClipboardCheck },
  { id: 'research', label: 'Research', icon: Globe2 },
  { id: 'verify', label: 'Verify', icon: BookOpenCheck },
  { id: 'memory', label: 'Memory', icon: Database },
  { id: 'compare', label: 'Models', icon: Sparkles },
  { id: 'schedule', label: 'Schedule', icon: CalendarClock },
  { id: 'privacy', label: 'Privacy', icon: ShieldCheck }
];

const initialProject: Project = {
  id: 'default',
  name: 'Personal workspace',
  description: 'A private place for chats, files, decisions, and instructions.',
  files: [],
  instructions: '',
  decisions: []
};

function load<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? '');
    return value as T;
  } catch {
    return fallback;
  }
}

export default function WorkspacePanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('projects');
  const [projects, setProjects] = useState<Project[]>(() => {
    const saved = load<Project[]>('aetheris-projects-v1', []);
    return saved.length > 0 ? saved : [initialProject];
  });
  const [activeProject, setActiveProject] = useState('default');
  const [memories, setMemories] = useState<Memory[]>(() => load('aetheris-memory-v1', []));
  const [newProject, setNewProject] = useState('');
  const [memoryDraft, setMemoryDraft] = useState('');
  const [researchQuery, setResearchQuery] = useState('');
  const [researchResults, setResearchResults] = useState<ResearchResult[]>([]);
  const [researchDate, setResearchDate] = useState<string | null>(null);
  const [claim, setClaim] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [verification, setVerification] = useState<Record<string, string> | null>(null);
  const [task, setTask] = useState('');
  const [plan, setPlan] = useState<string[]>([]);
  const [approved, setApproved] = useState(false);
  const [schedule, setSchedule] = useState('');
  const [notice, setNotice] = useState('');

  const project = useMemo(
    () => projects.find((item) => item.id === activeProject) ?? projects[0],
    [activeProject, projects]
  );

  useEffect(() => localStorage.setItem('aetheris-projects-v1', JSON.stringify(projects)), [projects]);
  useEffect(() => localStorage.setItem('aetheris-memory-v1', JSON.stringify(memories)), [memories]);

  const addProject = () => {
    const name = newProject.trim();
    if (!name) return;
    const item: Project = { ...initialProject, id: crypto.randomUUID(), name };
    setProjects((items) => [...items, item]);
    setActiveProject(item.id);
    setNewProject('');
  };

  const updateProject = (patch: Partial<Project>) =>
    setProjects((items) => items.map((item) => (item.id === project.id ? { ...item, ...patch } : item)));

  const createPlan = () => {
    if (!task.trim()) return;
    setPlan([
      'Clarify the desired outcome and constraints',
      'Gather relevant project files and current sources',
      'Make the smallest safe change or recommendation',
      'Run checks and report evidence, gaps, and next steps'
    ]);
    setApproved(false);
  };

  const runResearch = async () => {
    setNotice('');
    const response = await fetch('/api/research', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: researchQuery })
    });
    const data = (await response.json()) as { results?: ResearchResult[]; retrievedAt?: string; error?: string };
    if (!response.ok) {
      setNotice(data.error ?? 'Research failed.');
      return;
    }
    setResearchResults(data.results ?? []);
    setResearchDate(data.retrievedAt ?? new Date().toISOString());
  };

  const runVerification = async () => {
    const response = await fetch('/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claim, sourceUrl })
    });
    const data = (await response.json()) as Record<string, string>;
    setVerification(response.ok ? data : { status: 'error', explanation: data.error ?? 'Verification failed.' });
  };

  const addFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const names = Array.from(event.target.files ?? []).map((file) => file.name);
    if (names.length) updateProject({ files: [...new Set([...project.files, ...names])] });
    event.target.value = '';
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm">
      <div className="flex max-h-[92dvh] w-full max-w-5xl overflow-hidden rounded-2xl border border-white/10 bg-[#0C0D16] shadow-2xl">
        <aside className="hidden w-52 shrink-0 border-r border-white/10 bg-[#0d1421] p-3 sm:block">
          <div className="mb-4 flex items-center gap-2 px-2 text-sm font-semibold text-white"><Sparkles size={16} className="text-cyan-300" /> Workspace</div>
          <div className="space-y-1">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" onClick={() => setTab(id)} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] ${tab === id ? 'bg-cyan-400/15 text-cyan-200' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}>
                <Icon size={15} /> {label}
              </button>
            ))}
          </div>
          <p className="mt-6 px-2 text-[11px] leading-5 text-slate-500">Files and memories stay in this browser until you connect a synced project backend.</p>
        </aside>
        <section className="min-w-0 flex-1 overflow-y-auto">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-[#0C0D16]/95 px-4 py-3 backdrop-blur">
            <div><p className="text-sm font-semibold text-white">{tabs.find((item) => item.id === tab)?.label}</p><p className="text-[11px] text-slate-500">Control what Aetheris knows, checks, and can do.</p></div>
            <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Close workspace"><X size={18} /></button>
          </div>
          <div className="border-b border-white/10 p-3 sm:hidden"><select value={tab} onChange={(event) => setTab(event.target.value as Tab)} className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white">{tabs.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>
          <div className="space-y-4 p-4">
            {tab === 'projects' && <div className="space-y-4">
              <div className="flex gap-2"><input value={newProject} onChange={(event) => setNewProject(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && addProject()} placeholder="New project name" className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500" /><button type="button" onClick={addProject} className="rounded-lg bg-cyan-400 px-3 py-2 text-sm font-semibold text-slate-950"><Plus size={16} /></button></div>
              <div className="grid gap-3 md:grid-cols-[190px_1fr]"><div className="space-y-1">{projects.map((item) => <button key={item.id} type="button" onClick={() => setActiveProject(item.id)} className={`w-full rounded-lg px-3 py-2 text-left text-sm ${item.id === project.id ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5'}`}>{item.name}</button>)}</div><div className="rounded-xl border border-white/10 bg-white/[0.03] p-4"><input value={project.name} onChange={(event) => updateProject({ name: event.target.value })} className="w-full bg-transparent text-lg font-semibold text-white outline-none" /><textarea value={project.description} onChange={(event) => updateProject({ description: event.target.value })} placeholder="What belongs in this project?" className="mt-2 h-16 w-full resize-none bg-transparent text-sm text-slate-300 outline-none" /><label className="mt-3 flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-white/15 px-3 py-2 text-sm text-slate-300 hover:border-cyan-300/40"><Upload size={15} /> Add project files<input type="file" multiple className="hidden" onChange={addFiles} /></label>{project.files.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{project.files.map((file) => <span key={file} className="flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-xs text-slate-300"><FileText size={12} />{file}</span>)}</div>}<label className="mt-4 block text-xs font-medium text-slate-400">Project instructions<textarea value={project.instructions} onChange={(event) => updateProject({ instructions: event.target.value })} placeholder="Always use TypeScript. Cite sources. ..." className="mt-1 h-20 w-full rounded-lg border border-white/10 bg-black/10 p-2 text-sm text-white outline-none" /></label></div></div>
            </div>}
            {tab === 'tasks' && <div className="space-y-3"><p className="text-sm text-slate-300">Turn a request into an approved, observable task.</p><textarea value={task} onChange={(event) => setTask(event.target.value)} placeholder="Describe the multi-step outcome..." className="h-24 w-full rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white outline-none" /><button type="button" onClick={createPlan} className="rounded-lg bg-cyan-400 px-3 py-2 text-sm font-semibold text-slate-950">Create plan</button>{plan.length > 0 && <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4"><ol className="space-y-3">{plan.map((step, index) => <li key={step} className="flex gap-3 text-sm text-slate-200"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cyan-400/15 text-xs text-cyan-200">{index + 1}</span>{step}</li>)}</ol><button type="button" onClick={() => setApproved(true)} disabled={approved} className="mt-4 rounded-lg bg-emerald-400 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60">{approved ? 'Plan approved' : 'Approve plan'}</button>{approved && <p className="mt-2 text-xs text-emerald-300">Execution checkpoint recorded. Run the task in chat to apply it.</p>}</div>}</div>}
            {tab === 'research' && <div className="space-y-3"><div className="flex gap-2"><input value={researchQuery} onChange={(event) => setResearchQuery(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void runResearch()} placeholder="What should I research right now?" className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500" /><button type="button" onClick={() => void runResearch()} className="rounded-lg bg-cyan-400 px-3 py-2 text-sm font-semibold text-slate-950"><Search size={16} /></button></div>{researchDate && <p className="text-xs text-slate-500">Retrieved {new Date(researchDate).toLocaleString()}</p>}{researchResults.map((result) => <a key={result.url} href={result.url} target="_blank" rel="noreferrer" className="block rounded-xl border border-white/10 bg-white/[0.03] p-3 hover:border-cyan-300/40"><p className="text-sm font-medium text-cyan-200">{result.title}</p><p className="mt-1 text-xs leading-5 text-slate-300">{result.snippet}</p><p className="mt-2 truncate text-[11px] text-slate-500">{result.url}</p></a>)}{notice && <p className="text-sm text-amber-300">{notice}</p>}</div>}
            {tab === 'verify' && <div className="space-y-3"><p className="text-sm text-slate-300">Check an important claim against a specific source. This flags gaps; it does not replace judgment.</p><textarea value={claim} onChange={(event) => setClaim(event.target.value)} placeholder="Claim to check..." className="h-20 w-full rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white outline-none" /><input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="Source URL (optional)" className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none" /><button type="button" onClick={() => void runVerification()} className="rounded-lg bg-cyan-400 px-3 py-2 text-sm font-semibold text-slate-950">Check claim</button>{verification && <div className="rounded-xl border border-cyan-300/20 bg-cyan-400/[0.06] p-4"><p className="font-semibold text-white">{verification.status}</p><p className="mt-1 text-sm text-slate-300">{verification.explanation}</p><p className="mt-2 text-xs text-slate-500">Confidence: {verification.confidence ?? 'low'}</p></div>}</div>}
            {tab === 'memory' && <div className="space-y-3"><p className="text-sm text-slate-300">Inspect and correct facts Aetheris should remember. Each item records its source.</p><div className="flex gap-2"><input value={memoryDraft} onChange={(event) => setMemoryDraft(event.target.value)} placeholder="A fact or preference..." className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white" /><button type="button" onClick={() => { if (memoryDraft.trim()) { setMemories((items) => [...items, { id: crypto.randomUUID(), fact: memoryDraft.trim(), source: 'Added by you' }]); setMemoryDraft(''); } }} className="rounded-lg bg-cyan-400 px-3 py-2 text-sm font-semibold text-slate-950"><Plus size={16} /></button></div>{memories.map((item) => <div key={item.id} className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3"><div className="min-w-0 flex-1"><p className="text-sm text-white">{item.fact}</p><p className="mt-1 text-xs text-slate-500">Source: {item.source}</p></div><button type="button" onClick={() => setMemories((items) => items.filter((memory) => memory.id !== item.id))} className="text-slate-500 hover:text-red-300" aria-label="Delete memory"><Trash2 size={15} /></button></div>)}</div>}
            {tab === 'compare' && <div className="space-y-3"><p className="text-sm text-slate-300">Choose independent perspectives when the answer matters. Availability follows your configured provider and membership.</p>{['Aetheris Basic · fast answer', 'Aetheris Asteroid · balanced answer', 'Aetheris Pro · deep answer'].map((model) => <div key={model} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] p-3"><span className="text-sm text-white">{model}</span><span className="text-xs text-emerald-300">Available in chat</span></div>)}<div className="rounded-xl border border-dashed border-white/15 p-4 text-sm text-slate-400">Independent critique: ask “Critique the answer above and identify unsupported assumptions.”</div></div>}
            {tab === 'schedule' && <div className="space-y-3"><p className="text-sm text-slate-300">Create a reminder or recurring project check. Scheduled execution is opt-in.</p><input value={schedule} onChange={(event) => setSchedule(event.target.value)} placeholder="e.g. Every Monday at 9am: summarize project changes" className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white" /><button type="button" onClick={() => setNotice(schedule.trim() ? 'Schedule saved locally. Connect a job runner to execute it.' : 'Describe the schedule first.')} className="rounded-lg bg-cyan-400 px-3 py-2 text-sm font-semibold text-slate-950">Save schedule</button>{notice && <p className="text-xs text-amber-300">{notice}</p>}</div>}
            {tab === 'privacy' && <div className="space-y-3">{[['Project files', 'Stored locally in this browser'], ['Long-term memory', `${memories.length} editable items`], ['Live web research', 'Only runs when you press Research'], ['Tool actions', 'Require an explicit approval checkpoint'], ['Voice and images', 'Handled by the selected model and browser permissions']].map(([name, value]) => <div key={name} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3"><LockKeyhole size={16} className="text-cyan-300" /><div><p className="text-sm text-white">{name}</p><p className="text-xs text-slate-400">{value}</p></div><Check size={16} className="ml-auto text-emerald-300" /></div>)}<button type="button" onClick={() => { localStorage.removeItem('aetheris-memory-v1'); setMemories([]); setNotice('Memory deleted from this browser.'); }} className="rounded-lg border border-red-300/20 px-3 py-2 text-sm text-red-200 hover:bg-red-400/10">Delete all remembered facts</button>{notice && <p className="text-xs text-emerald-300">{notice}</p>}</div>}
          </div>
        </section>
      </div>
    </div>
  );
}
