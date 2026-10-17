import type { CampaignView, RunTx } from '../chain'
import { sameAddress } from '../chain'
import { RecordRow } from './RecordRow'

type Props = {
  account: string
  campaigns: CampaignView[]
  canWrite: boolean
  runTx: RunTx
}

export function VerifierPanel({ account, campaigns, canWrite, runTx }: Props) {
  const pending = campaigns.flatMap((campaign) =>
    campaign.records
      .filter((record) => record.status === 'Pending')
      .map((record) => ({ campaign, record })),
  )

  return (
    <section className="card">
      <h2>Verifier tools</h2>
      <p className="muted">
        Review the evidence, then approve or reject each record. Approving means you accepted the
        evidence; it is not proof that the delivery physically happened.
      </p>

      {pending.length === 0 ? (
        <p className="muted">No records are waiting for verification.</p>
      ) : (
        <div className="records">
          {pending.map(({ campaign, record }) => {
            const own = sameAddress(record.submitter, account)
            return (
              <div key={record.id.toString()}>
                <p className="muted small">
                  Campaign #{campaign.id.toString()} · {campaign.name}
                </p>
                <RecordRow record={record} />
                {own ? (
                  <p className="notice">
                    You submitted this record, so a different verifier has to decide it.
                  </p>
                ) : (
                  <div className="actions">
                    <button
                      disabled={!canWrite}
                      onClick={() =>
                        void runTx(`Approving record #${record.id}`, (c) => c.verifyRecord(record.id, true))
                      }
                    >
                      Approve
                    </button>
                    <button
                      className="button-danger"
                      disabled={!canWrite}
                      onClick={() =>
                        void runTx(`Rejecting record #${record.id}`, (c) => c.verifyRecord(record.id, false))
                      }
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
