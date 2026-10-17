import type { CampaignView } from '../chain'
import { formatNumber, formatTime, percent, shorten } from '../chain'
import { RecordRow } from './RecordRow'

function CampaignCard({ campaign }: { campaign: CampaignView }) {
  const verifiedPct = percent(campaign.verifiedQuantity, campaign.reportedQuantity)

  return (
    <article className="card">
      <div className="campaign-head">
        <div>
          <h3>{campaign.name}</h3>
          <p className="muted small">
            {campaign.resourceType || 'Resource not set'} · {campaign.location || 'Location not set'}
          </p>
        </div>
        <span className={`badge badge-${campaign.status.toLowerCase()}`}>{campaign.status}</span>
      </div>

      <p className="muted small">
        Campaign #{campaign.id.toString()} by <span className="mono">{shorten(campaign.owner)}</span>{' '}
        · created {formatTime(campaign.createdAt)} · target {formatNumber(campaign.targetQuantity)}
      </p>

      <dl className="stats stats-4">
        <div>
          <dt>Reported by NGO</dt>
          <dd>{formatNumber(campaign.reportedQuantity)}</dd>
        </div>
        <div>
          <dt>Verified</dt>
          <dd>{formatNumber(campaign.verifiedQuantity)}</dd>
        </div>
        <div>
          <dt>Rejected</dt>
          <dd>{formatNumber(campaign.rejectedQuantity)}</dd>
        </div>
        <div>
          <dt>Pending records</dt>
          <dd>{campaign.pendingCount.toString()}</dd>
        </div>
      </dl>

      <div
        className="bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={verifiedPct}
        aria-label="Verified share of reported quantity"
      >
        <div className="bar-fill" style={{ width: `${verifiedPct}%` }} />
      </div>
      <p className="muted small">
        {verifiedPct}% of the reported quantity is verified ({campaign.approvedCount.toString()}{' '}
        approved, {campaign.rejectedCount.toString()} rejected, {campaign.pendingCount.toString()}{' '}
        pending records)
      </p>

      <details>
        <summary>Distribution records ({campaign.records.length})</summary>
        {campaign.records.length === 0 ? (
          <p className="muted">No records submitted yet.</p>
        ) : (
          <div className="records">
            {[...campaign.records].reverse().map((record) => (
              <RecordRow key={record.id.toString()} record={record} />
            ))}
          </div>
        )}
      </details>
    </article>
  )
}

export function CampaignList({ campaigns }: { campaigns: CampaignView[] | null }) {
  if (campaigns === null) return <p className="muted">Loading campaigns from Sepolia…</p>
  if (campaigns.length === 0) return <p className="muted">No campaigns have been created yet.</p>

  return (
    <>
      {campaigns.map((campaign) => (
        <CampaignCard key={campaign.id.toString()} campaign={campaign} />
      ))}
    </>
  )
}
