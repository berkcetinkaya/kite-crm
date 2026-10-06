// Follow up settings (Phase 7). Operational configuration stored in SQLite. There is deliberately no
// automatic sending option: a due follow up only appears in Mail & Takip for Berk's attention.
import { useEffect, useState } from 'react';
import { CalendarClock, Loader2, Save } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { useToast } from '../../components/ui/Toast';
import { errorMessage } from '../../api/dataApi';
import { MAX_DELAY_DAYS, MAX_FOLLOW_UP_STEPS, MIN_DELAY_DAYS, stepLabel, type FollowUpSettings } from '../../domain/followUp';
import { useFollowUps } from '../../state/followUps/FollowUpsProvider';

export function FollowUpSettingsCard() {
  const { overview, saveSettings, loadError } = useFollowUps();
  const showToast = useToast();
  const stored = overview?.settings ?? null;
  const [form, setForm] = useState<FollowUpSettings | null>(stored);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (stored && !form) setForm(stored);
  }, [stored, form]);

  if (!form || !stored) {
    return (
      <section className="card fu-settings" aria-labelledby="fu-settings-title">
        <header className="card__header">
          <h2 id="fu-settings-title" className="card__title">
            <CalendarClock size={16} aria-hidden="true" /> Takip Mailleri
          </h2>
        </header>
        <div className="card__body">{loadError ? <p className="settings-alert settings-alert--error">{loadError}</p> : <p className="text-subtle">Yükleniyor…</p>}</div>
      </section>
    );
  }

  const dirty = JSON.stringify(form) !== JSON.stringify(stored);
  const delaysValid = form.delays.every((d) => Number.isInteger(d) && d >= MIN_DELAY_DAYS && d <= MAX_DELAY_DAYS);
  const pausedBySettings = overview?.sequences.filter((s) => s.status === 'paused' && s.pauseReason === 'settings_disabled').length ?? 0;

  const onSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveSettings(form);
      const turnedOff = stored.enabled && !form.enabled;
      showToast({
        title: 'Takip ayarları kaydedildi',
        description: turnedOff ? 'Aktif takipler duraklatıldı; her birini Mail & Takip’ten sürdürebilirsin.' : 'Yeni takip planları bu ayarlarla oluşturulur.',
      });
    } catch (e) {
      setError(errorMessage(e));
    }
    setSaving(false);
  };

  const setDelay = (i: number, value: string) => {
    const n = Number(value);
    const delays = [...form.delays] as FollowUpSettings['delays'];
    delays[i] = Number.isFinite(n) ? Math.round(n) : 0;
    setForm({ ...form, delays });
  };

  return (
    <section className="card fu-settings" aria-labelledby="fu-settings-title">
      <header className="card__header">
        <div className="card__heading">
          <h2 id="fu-settings-title" className="card__title">
            <CalendarClock size={16} aria-hidden="true" /> Takip Mailleri
          </h2>
          <p className="card__subtitle">Gönderilen ilk temas maillerine yanıt gelmezse takip zamanını belirler. Takipler asla otomatik gönderilmez.</p>
        </div>
        <div className="card__action">
          <Badge tone={stored.enabled ? 'success' : 'neutral'} dot>
            {stored.enabled ? 'Aktif' : 'Kapalı'}
          </Badge>
        </div>
      </header>
      <div className="card__body fu-settings__body">
        <label className="fu-settings__toggle">
          <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
          <span>
            <strong>Takip Sistemi Aktif</strong>
            <span className="fu-settings__hint">Açıkken başarılı her ilk temas maili için otomatik bir takip planı oluşturulur. Kapatınca mevcut planlar silinmez, duraklatılır.</span>
          </span>
        </label>

        <label className="field fu-settings__count">
          <span className="field__label">En fazla takip sayısı</span>
          <select className="input" value={form.maxSteps} onChange={(e) => setForm({ ...form, maxSteps: Number(e.target.value) })}>
            {Array.from({ length: MAX_FOLLOW_UP_STEPS }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n} takip
              </option>
            ))}
          </select>
        </label>

        <div className="fu-settings__delays">
          {form.delays.map((d, i) => (
            <label key={i} className={i < form.maxSteps ? 'field' : 'field fu-settings__unused'}>
              <span className="field__label">{stepLabel(i + 1)}</span>
              <span className="fu-settings__days">
                <input className="input" type="number" min={MIN_DELAY_DAYS} max={MAX_DELAY_DAYS} step={1} value={d} disabled={i >= form.maxSteps} onChange={(e) => setDelay(i, e.target.value)} aria-label={`${stepLabel(i + 1)} gün`} />
                <span>gün</span>
              </span>
            </label>
          ))}
        </div>
        <p className="fu-settings__hint">
          Süreler bir önceki mailin başarıyla gönderildiği andan itibaren sayılır (1. takip ilk mailden, 2. takip 1. takipten sonra). Değişiklikler yeni planlara uygulanır; mevcut planlar kendi tarihlerini korur.
        </p>
        {!delaysValid && <p className="settings-alert settings-alert--error">Her süre {MIN_DELAY_DAYS} ile {MAX_DELAY_DAYS} gün arasında bir tam sayı olmalı.</p>}
        {pausedBySettings > 0 && stored.enabled && <p className="settings-alert" role="status">Takip sistemi kapalıyken duraklatılan {pausedBySettings} plan var. Her birini Mail & Takip’te “Takibi Sürdür” ile devam ettirebilirsin.</p>}
        {error && (
          <p className="settings-alert settings-alert--error" role="alert">
            {error}
          </p>
        )}
        <div className="gmail-card__actions">
          <button type="button" className="button button--primary" onClick={() => void onSave()} disabled={saving || !dirty || !delaysValid}>
            {saving ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
            Kaydet
          </button>
          {dirty && (
            <button type="button" className="button button--ghost" onClick={() => setForm(stored)} disabled={saving}>
              Vazgeç
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
