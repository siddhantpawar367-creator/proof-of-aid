import { useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import type { CampaignView, RunTx } from '../chain'
import { isPositiveInt, sameAddress, sha256File } from '../chain'

type Props = {
  account: string
  campaigns: CampaignView[]
  canWrite: boolean
  runTx: RunTx
}

type FileInfo = { name: string; hash: string }

export function NgoPanel({ account, campaigns, canWrite, runTx }: Props) {
  const mine = campaigns.filter((c) => sameAddress(c.owner, account))
  const active = mine.filter((c) => c.status === 'Active')

  // Create campaign form
  const [name, setName] = useState('')
  const [resource, setResource] = useState('')
  const [target, setTarget] = useState('')
  const [location, setLocation] = useState('')

  // Submit record form
  const [campaignId, setCampaignId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [recordLocation, setRecordLocation] = useState('')
  const [uri, setUri] = useState('')
  const [file, setFile] = useState<FileInfo | null>(null)
  const [hashing, setHashing] = useState(false)
  const [fileKey, setFileKey] = useState(0)

  const [formError, setFormError] = useState<string | null>(null)

  // Fall back to the first active campaign until one is chosen.
  const selectedId = active.some((c) => c.id.toString() === campaignId)
    ? campaignId
    : (active[0]?.id.toString() ?? '')

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setFormError('Enter a campaign name.')
    if (!isPositiveInt(target)) return setFormError('Target quantity must be a whole number above zero.')
    setFormError(null)

    const ok = await runTx('Creating campaign', (c) =>
      c.createCampaign(name.trim(), resource.trim(), BigInt(target.trim()), location.trim()),
    )
    if (ok) {
      setName('')
      setResource('')
      setTarget('')
      setLocation('')
    }
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const chosen = e.target.files?.[0]
    if (!chosen) {
      setFile(null)
      return
    }
    setHashing(true)
    try {
      setFile({ name: chosen.name, hash: await sha256File(chosen) })
    } finally {
      setHashing(false)
    }
  }

  async function onSubmitRecord(e: FormEvent) {
    e.preventDefault()
    if (!selectedId) return setFormError('Create an active campaign first.')
    if (!isPositiveInt(quantity)) return setFormError('Quantity must be a whole number above zero.')
    if (!file) return setFormError('Choose the evidence file.')
    setFormError(null)

    const ok = await runTx('Submitting record', (c) =>
      c.submitDistribution(
        BigInt(selectedId),
        BigInt(quantity.trim()),
        recordLocation.trim(),
        file.hash,
        uri.trim(),
      ),
    )
    if (ok) {
      setQuantity('')
      setRecordLocation('')
      setUri('')
      setFile(null)
      setFileKey((k) => k + 1) // clears the file input
    }
  }

  return (
    <section className="card">
      <h2>NGO tools</h2>
      <p className="muted">
        Create campaigns and record aid distributions. Evidence files stay on your computer: only
        their SHA-256 hash is written to the blockchain.
      </p>

      {formError && (
        <div className="notice notice-error" role="alert">
          {formError}
        </div>
      )}

      <h3>Create a campaign</h3>
      <form onSubmit={onCreate} className="form">
        <label>
          Campaign name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Maharashtra Flood Relief" />
        </label>
        <label>
          Resource
          <input value={resource} onChange={(e) => setResource(e.target.value)} placeholder="Food packages" />
        </label>
        <label>
          Target quantity
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            inputMode="numeric"
            placeholder="1000"
          />
        </label>
        <label>
          Location
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Affected villages" />
        </label>
        <button type="submit" disabled={!canWrite}>
          Create campaign
        </button>
      </form>

      <h3>Record a distribution</h3>
      {active.length === 0 ? (
        <p className="muted">You have no active campaigns. Create one above first.</p>
      ) : (
        <form onSubmit={onSubmitRecord} className="form">
          <label>
            Campaign
            <select value={selectedId} onChange={(e) => setCampaignId(e.target.value)}>
              {active.map((c) => (
                <option key={c.id.toString()} value={c.id.toString()}>
                  #{c.id.toString()} {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Quantity distributed
            <input
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              inputMode="numeric"
              placeholder="100"
            />
          </label>
          <label>
            Location
            <input
              value={recordLocation}
              onChange={(e) => setRecordLocation(e.target.value)}
              placeholder="Village A"
            />
          </label>
          <label>
            Evidence file (report or photo)
            <input key={fileKey} type="file" onChange={onFile} />
          </label>
          {hashing && <p className="muted small">Calculating hash…</p>}
          {file && (
            <p className="small">
              <span className="muted">SHA-256 of {file.name}: </span>
              <span className="mono break">{file.hash}</span>
            </p>
          )}
          <label>
            Evidence link (optional)
            <input
              value={uri}
              onChange={(e) => setUri(e.target.value)}
              placeholder="https://… or ipfs://…"
            />
          </label>
          <button type="submit" disabled={!canWrite || hashing}>
            Submit record
          </button>
        </form>
      )}

      {mine.length > 0 && (
        <>
          <h3>Your campaigns</h3>
          <ul className="plain-list">
            {mine.map((c) => (
              <li key={c.id.toString()} className="list-row">
                <span>
                  #{c.id.toString()} {c.name}{' '}
                  <span className={`badge badge-${c.status.toLowerCase()}`}>{c.status}</span>
                </span>
                {c.status === 'Active' && (
                  <button
                    className="button-secondary"
                    disabled={!canWrite}
                    onClick={() => void runTx('Closing campaign', (contract) => contract.closeCampaign(c.id))}
                  >
                    Close
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
