// "Görevler" card in the company drawer overview (Phase 11): the company's open manual tasks and a
// quick "Görev ekle". The full list (with every other work item) lives on İşler.
import { useCallback, useEffect, useState } from 'react';
import { ListChecks, Plus } from 'lucide-react';
import { errorMessage } from '../../../api/dataApi';
import { tasksApi } from '../../../api/tasksApi';
import { useToast } from '../../../components/ui/Toast';
import { dueBucket } from '../../../domain/businessDay';
import type { Company } from '../../../domain/company';
import type { Task } from '../../../domain/tasks';
import { formatShortDate, formatTime } from '../../../lib/date';
import { useCompanies } from '../../../state/companies/CompaniesProvider';
import { TaskForm } from '../../tasks/TaskForm';
import '../../tasks/tasks.css';

export function TasksCard({ company }: { company: Company }) {
  const { upsertCompanies } = useCompanies();
  const showToast = useToast();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      setTasks((await tasksApi.forCompany(company.id)).tasks);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [company.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const complete = async (t: Task) => {
    try {
      const r = await tasksApi.changeStatus(t.id, 'done');
      if (r.company) upsertCompanies([r.company]);
      showToast({ title: 'Görev tamamlandı', description: t.title });
      void load();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const now = new Date().toISOString();
  return (
    <section className="comm-summary tasks-card" aria-labelledby={`tasks-card-${company.id}`}>
      <div className="comm-summary__head">
        <h3 id={`tasks-card-${company.id}`} className="comm-summary__title">
          Görevler
        </h3>
        <a className="comm-summary__link" href="#/tasks">
          İşler'de aç
        </a>
      </div>
      {error && <p className="sales-hint sales-hint--warn">{error}</p>}
      {tasks && tasks.length === 0 && !adding && <p className="comm-summary__meta">Açık görev yok.</p>}
      {tasks && tasks.length > 0 && (
        <ul className="tasks-card__list">
          {tasks.map((t) => {
            const late = dueBucket(t.dueAt, now) === 'overdue';
            return (
              <li key={t.id} className="tasks-card__item">
                <span>
                  <ListChecks size={14} aria-hidden="true" /> {t.title}
                  {t.dueAt && (
                    <span className={late ? 'tasks-card__due tasks-card__due--late' : 'tasks-card__due'}>
                      {' '}
                      · {formatShortDate(new Date(t.dueAt))}
                      {t.dueHasTime ? ` ${formatTime(new Date(t.dueAt))}` : ''}
                    </span>
                  )}
                </span>
                <button type="button" className="button button--ghost button--sm" onClick={() => void complete(t)}>
                  Tamamla
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {adding ? (
        <TaskForm
          defaultCompanyId={company.id}
          onSaved={() => {
            setAdding(false);
            void load();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button type="button" className="comm-summary__link tasks-card__add" onClick={() => setAdding(true)}>
          <Plus size={14} aria-hidden="true" /> Görev ekle
        </button>
      )}
    </section>
  );
}
