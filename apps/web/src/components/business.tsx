import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { formatBytes } from '../lib/format.js';
import type { Citation } from '../features/schemas.js';

export function MetricCard({
  label,
  value,
  note,
  to,
}: {
  label: string;
  value: string | number;
  note?: string;
  to?: string;
}) {
  const body = (
    <>
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      {note ? <span className="note">{note}</span> : null}
    </>
  );

  return to ? (
    <Link className="card metric" to={to}>
      {body}
    </Link>
  ) : (
    <div className="card metric">{body}</div>
  );
}

export function StorageMetric({ bytes }: { bytes: number }) {
  return <MetricCard label="对象存储" value={formatBytes(bytes)} note="仅统计当前版本" />;
}

export function CitationText({
  text,
  citations,
  onSelect,
}: {
  text: string;
  citations: Citation[];
  onSelect?: (ordinal: number) => void;
}) {
  const byOrdinal = new Map(citations.map((citation) => [citation.ordinal, citation]));
  const parts = text.split(/(\[\d{1,2}\])/g);

  return (
    <span className="answer">
      {parts.map((part, index) => {
        const match = /^\[(\d{1,2})\]$/.exec(part);
        if (!match) {
          return <Fragment key={index}>{part}</Fragment>;
        }

        const ordinal = Number(match[1]);
        const citation = byOrdinal.get(ordinal);
        const invalid = citation ? !(citation.valid ?? citation.isValid ?? true) : false;

        return (
          <button
            key={index}
            type="button"
            className={`cite ${invalid ? 'invalid' : ''}`}
            aria-label={`引用 ${ordinal}${invalid ? '（不可验证）' : ''}`}
            onClick={() => onSelect?.(ordinal)}
          >
            {ordinal}
          </button>
        );
      })}
    </span>
  );
}

export function DegradedNote({ degraded }: { degraded: string[] }) {
  if (degraded.length === 0) {
    return null;
  }
  return <p className="tiny muted">降级：{degraded.join('、')}</p>;
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p className="sub">{subtitle}</p> : null}
      </div>
      {actions ? <div className="row">{actions}</div> : null}
    </div>
  );
}
