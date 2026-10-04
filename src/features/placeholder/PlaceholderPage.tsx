import { Construction } from 'lucide-react';

export function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="page">
      <div className="placeholder">
        <Construction size={28} aria-hidden="true" />
        <h1>{title}</h1>
        <p>Bu modül sonraki fazlarda eklenecek.</p>
        <a className="button button--secondary" href="#/home">
          Ana Sayfaya dön
        </a>
      </div>
    </div>
  );
}
