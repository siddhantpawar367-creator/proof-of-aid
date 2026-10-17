import type { DistRecord } from '../chain'
import { evidenceLink, formatNumber, formatTime, shorten } from '../chain'
import { EvidenceCheck } from './EvidenceCheck'

export function RecordRow({ record }: { record: DistRecord }) {
  const link = evidenceLink(record.evidenceURI)

  return (
    <article className="record">
      <div className="record-head">
        <strong>Record #{record.id.toString()}</strong>
        <span className={`badge badge-${record.status.toLowerCase()}`}>{record.status}</span>
      </div>

      <dl className="record-details">
        <div>
          <dt>Quantity reported</dt>
          <dd>{formatNumber(record.quantity)}</dd>
        </div>
        <div>
          <dt>Location</dt>
          <dd>{record.location || '—'}</dd>
        </div>
        <div>
          <dt>Submitted by</dt>
          <dd className="mono">{shorten(record.submitter)}</dd>
        </div>
        <div>
          <dt>Submitted</dt>
          <dd>{formatTime(record.submittedAt)}</dd>
        </div>
        {record.status !== 'Pending' && (
          <>
            <div>
              <dt>Decided by</dt>
              <dd className="mono">{shorten(record.verifier)}</dd>
            </div>
            <div>
              <dt>Decided</dt>
              <dd>{formatTime(record.verifiedAt)}</dd>
            </div>
          </>
        )}
      </dl>

      <p className="small">
        <span className="muted">Evidence hash (SHA-256): </span>
        <span className="mono break">{record.evidenceHash}</span>
      </p>

      {record.evidenceURI && (
        <p className="small">
          <span className="muted">Evidence link: </span>
          {link ? (
            <a href={link} target="_blank" rel="noreferrer noopener">
              {record.evidenceURI}
            </a>
          ) : (
            <span className="break">{record.evidenceURI}</span>
          )}
        </p>
      )}

      <EvidenceCheck expectedHash={record.evidenceHash} />
    </article>
  )
}
