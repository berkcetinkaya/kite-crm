// İşler (Phase 11): every open piece of work in one list. Manual tasks live here; everything else is
// derived from the record that owns it and changed only through that record's rules. Due dates are
// the reminders: overdue / today / upcoming inside KITE OS, no email or notifications.
import { useEffect, useMemo, useState } from 'react';
import { CircleCheck, ListChecks, Plus, RefreshCw } from 'lucide-react';
import { readHashParams } from '../../app/useHashRoute';
import { Drawer } from '../../components/ui/Drawer';
import { EmptyState } from '../../components/ui/EmptyState';
import { useToast } from '../../components/ui/Toast';
import { errorMessage } from '../../api/dataApi';
import { tasksApi } from '../../api/tasksApi';
import { TEAM_MEMBERS } from '../../domain/company';
import { COMPLETED_OLDER_DAYS, COMPLETED_RECENT_DAYS, TASK_PRIORITY_LABELS, type Task } from '../../domain/tasks';
import { inView, WORK_GROUP_LABELS, WORK_GROUPS, WORK_VIEW_LABELS, WORK_VIEWS, type WorkGroup, type WorkView } from '../../domain/work';
import { formatShortDate } from '../../lib/date';
import { foldForSearch } from '../../lib/text';
import { useCompanies } from '../../state/companies/CompaniesProvider';
import { CompanyDrawer } from '../prospects/detail/CompanyDrawer';
import { TaskForm } from './TaskForm';
import { useWork } from './useWork';
import { WorkRow } from './WorkRow';
import './tasks.css';

export const TASKS_ROUTE = '#/tasks';
const PREFS_KEY = 'kite.work.prefs';

function readPrefs(): { view: WorkView; groups: WorkGroup[] } {
  try {
    const p = JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? 'null') as { view?: string; groups?: string[] } | null;
    return { view: (WORK_VIEWS as readonly string[]).includes(p?.view ?? '') ? (p!.view as WorkView) : 'today', groups: (p?.groups ?? []).filter((g): g is WorkGroup => (WORK_GROUPS as readonly string[]).includes(g)) };
  } catch {
    return { view: 'today', groups: [] };
  }
}

export function TasksPage() {
  const { data, loading, error, completedDays, setCompletedDays, reload } = useWork();
  const { companies, upsertCompanies } = useCompanies();
  const showToast = useToast();
  const [view, setView] = useState<WorkView>(() => readPrefs().view);
  const [groups, setGroups] = useState<WorkGroup[]>(() => readPrefs().groups);
  const [owner, setOwner] = useState('');
  const [query, setQuery] = useState('');
  const [form, setForm] = useState<{ taskId: string | null } | null>(null);
  const [companyOpen, setCompanyOpen] = useState<string | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify({ view, groups }));
    } catch {
      /* storage unavailable: keep the choice for this visit only */
    }
  }, [view, groups]);

  // Deep links: "#/tasks?task=<id>" opens a task, "#/tasks?view=today" selects a view.
  useEffect(() => {
    const read = () => {
      const p = readHashParams();
      const t = p.get('task');
      const v = p.get('view');
      if (t) setForm({ taskId: t });
      if (v && (WORK_VIEWS as readonly string[]).includes(v)) setView(v as WorkView);
      if (t || v) window.history.replaceState(null, '', TASKS_ROUTE);
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);

  const items = data?.items ?? [];
  const owners = TEAM_MEMBERS.length > 1 ? [...new Set(items.map((i) => i.owner).filter((o): o is string => !!o))] : [];
  const q = foldForSearch(query.trim());
  const filtered = useMemo(
    () =>
      view === 'completed'
        ? []
        : items.filter(
            (i) =>
              inView(i, view) &&
              (groups.length === 0 || groups.includes(i.group)) &&
              (!owner || i.owner === owner) &&
              (!q || foldForSearch(`${i.title} ${i.description} ${i.companyName ?? ''}`).includes(q)),
          ),
    [items, view, groups, owner, q],
  );
  const count = (v: WorkView) => (v === 'completed' ? (data?.completed.length ?? 0) : items.filter((i) => inView(i, v)).length);
  const allTasks = [...(data?.tasks ?? []), ...(data?.completed ?? [])];
  const editing = form?.taskId ? allTasks.find((t) => t.id === form.taskId) : undefined;
  const nameOf = (id: string | null) => (id ? companies.find((c) => c.id === id)?.name : undefined);

  const reopen = async (t: Task) => {
    try {
      const r = await tasksApi.changeStatus(t.id, 'open');
      if (r.company) upsertCompanies([r.company]);
      showToast({ title: 'Görev yeniden açıldı', description: t.title });
      void reload();
    } catch (e) {
      showToast({ title: 'Görev açılamadı', description: errorMessage(e) });
    }
  };

  return (
    <div className="page tasks-page">
      <header className="page-header">
        <div>
          <h1 className="page-header__title">İşler</h1>
          <p className="page-header__subtitle">Görevler, sonraki adımlar, görüşmeler, takipler, onboarding, erişimler ve teklifler tek listede. Son tarih KITE içinde hatırlatmadır; bildirim gönderilmez.</p>
        </div>
        <div className="tasks-page__tools">
          <button type="button" className="button button--ghost button--sm" onClick={() => void reload()} disabled={loading} aria-label="Listeyi yenile">
            <RefreshCw size={14} aria-hidden="true" className={loading ? 'spin' : undefined} /> Yenile
          </button>
          <button type="button" className="button button--primary" onClick={() => setForm({ taskId: null })}>
            <Plus size={16} aria-hidden="true" /> Yeni Görev
          </button>
        </div>
      </header>

      {error && (
        <p className="research-alert research-alert--error page-alert" role="alert">
          İşler yüklenemedi: {error}
        </p>
      )}

      <section className="card" aria-label="İş listesi">
        <div className="proposal-filters" role="tablist" aria-label="Görünüm">
          {WORK_VIEWS.map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? 'proposal-filter proposal-filter--active' : 'proposal-filter'} onClick={() => setView(v)}>
              {WORK_VIEW_LABELS[v]} <span className="pipeline-group__count">{data ? count(v) : '…'}</span>
            </button>
          ))}
        </div>
        {view !== 'completed' && (
          <div className="work-filters">
            <div className="chip-row" role="group" aria-label="Kaynak">
              {WORK_GROUPS.map((g) => {
                const on = groups.includes(g);
                return (
                  <button key={g} type="button" aria-pressed={on} className={on ? 'filter-chip filter-chip--on' : 'filter-chip'} onClick={() => setGroups((list) => (on ? list.filter((x) => x !== g) : [...list, g]))}>
                    {WORK_GROUP_LABELS[g]}
                  </button>
                );
              })}
            </div>
            {owners.length > 1 && (
              <select className="input input--sm" aria-label="Sorumlu" value={owner} onChange={(e) => setOwner(e.target.value)}>
                <option value="">Tüm sorumlular</option>
                {owners.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            )}
            <input className="input input--sm work-filters__search" type="search" aria-label="Ara" placeholder="Ara: başlık, şirket…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        )}
        <div className="card__body card__body--flush">
          {!data ? (
            !error && <p className="dash-empty">İşler yükleniyor…</p>
          ) : view === 'completed' ? (
            <CompletedList tasks={data.completed} days={completedDays} nameOf={nameOf} onOpen={(id) => setForm({ taskId: id })} onReopen={(t) => void reopen(t)} onOlder={() => setCompletedDays(completedDays === COMPLETED_RECENT_DAYS ? COMPLETED_OLDER_DAYS : COMPLETED_RECENT_DAYS)} />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={view === 'today' || view === 'overdue' ? CircleCheck : ListChecks}
              title={items.length === 0 ? 'Açık iş yok' : 'Bu görünümde iş yok'}
              description={view === 'today' ? 'Bugün yapılacak veya gecikmiş iş yok.' : groups.length || q ? 'Filtreleri değiştir.' : '“Yeni Görev” ile hatırlatma ekleyebilirsin.'}
            />
          ) : (
            <ul className="work-list">
              {filtered.map((w) => (
                <WorkRow key={w.key} item={w} onOpenCompany={setCompanyOpen} onEditTask={(id) => setForm({ taskId: id })} onChanged={() => void reload()} />
              ))}
            </ul>
          )}
        </div>
      </section>

      <Drawer open={form !== null} onClose={() => setForm(null)} title={form?.taskId ? 'Görevi düzenle' : 'Yeni Görev'}>
        {form && (form.taskId === null || editing) ? (
          <TaskForm
            key={form.taskId ?? 'new'}
            task={editing}
            onSaved={() => {
              setForm(null);
              void reload();
            }}
            onCancel={() => setForm(null)}
          />
        ) : (
          form && <p className="sales-hint">{data ? 'Görev bulunamadı (iptal edilmiş veya 90 günden eski olabilir).' : 'Yükleniyor…'}</p>
        )}
      </Drawer>

      <CompanyDrawer
        companyId={companyOpen}
        onClose={() => {
          setCompanyOpen(null);
          void reload();
        }}
      />
    </div>
  );
}

function CompletedList({ tasks, days, nameOf, onOpen, onReopen, onOlder }: { tasks: Task[]; days: number; nameOf: (id: string | null) => string | undefined; onOpen: (id: string) => void; onReopen: (t: Task) => void; onOlder: () => void }) {
  return (
    <>
      {tasks.length === 0 ? (
        <p className="dash-empty">Son {days} günde tamamlanan görev yok.</p>
      ) : (
        <ul className="work-list">
          {tasks.map((t) => (
            <li key={t.id} className="work-row work-row--done">
              <div className="work-row__body">
                <div className="work-row__main">
                  <p className="work-row__title">
                    <button type="button" className="link-cell" onClick={() => onOpen(t.id)}>
                      {t.title}
                    </button>
                  </p>
                  <p className="work-row__meta">
                    {nameOf(t.companyId) ?? <span className="text-subtle">Şirketsiz</span>} · tamamlandı {formatShortDate(new Date(t.closedAt!))}
                    {t.priority === 'high' ? ` · ${TASK_PRIORITY_LABELS.high}` : ''}
                  </p>
                </div>
                <div className="work-row__actions">
                  <button type="button" className="button button--ghost button--sm" onClick={() => onReopen(t)}>
                    Yeniden aç
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="dash-more" onClick={onOlder}>
        {days === COMPLETED_RECENT_DAYS ? `Daha eski (son ${COMPLETED_OLDER_DAYS} gün)` : `Yalnızca son ${COMPLETED_RECENT_DAYS} gün`}
      </button>
    </>
  );
}
